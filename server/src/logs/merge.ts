import {
  formatMergedLogLine,
  type ContainerLogLineSink,
  type ExportTextSink,
  type MergedLogLine,
} from './export.js';
import type { LogContainerRole } from './types.js';

// How many lines one container may run ahead of the writer before its docker
// stream is paused, and how far it must fall back before it is resumed. A
// container cannot fill memory while the writer is slow, because the read
// stops at the high-water mark instead of the queue growing without bound.
const QUEUE_HIGH_WATER_LINES = 2000;
const QUEUE_LOW_WATER_LINES = 500;

type ContainerQueue = {
  container: LogContainerRole;
  lines: MergedLogLine[];
  // Timestamp of the most recent line already written for this container.
  // The daemon timestamps every line it sends when `timestamps: true` is set,
  // but a line can still arrive unparseable (a multi-line payload's
  // continuation, say). Such a line has no position of its own, so it is
  // ordered against this instead of jumping to the front of the export or
  // being pushed past lines that came after it.
  lastMs: number | null;
  // Lines already written for this container, which is what tells a failed
  // read apart from a container that produced nothing at all.
  written: number;
  paused: boolean;
  resume: (() => void) | null;
  done: boolean;
};

export type MergedLogWriter = {
  // The sink one container's read writes into.
  sinkFor: (container: LogContainerRole) => ContainerLogLineSink;
  // That container's history is complete.
  finish: (container: LogContainerRole) => void;
  // That container's read failed. Writes a marker into the merged stream at
  // the point the container reached, then ends it.
  fail: (container: LogContainerRole, reason: string) => void;
  // Resolves once every container has finished and everything queued has been
  // written, or the client went away.
  completed: () => Promise<void>;
};

/**
 * Interleave several containers' log streams by timestamp while streaming.
 *
 * The daemon already returns each container's history in time order, so this
 * merges the streams instead of replaying them one after another: exporting
 * the translator's whole history and then the JDC's loses the relative order
 * of a handshake across the two, which is the thing worth reading. A
 * container that has not finished and has nothing queued holds the others
 * back until it shows: its history may start earlier, and writing what has
 * already arrived would land one container's batch before the other's. The
 * cost is bounded by each container's queue — heads are held for ordering,
 * not the whole export.
 *
 * Each container reads independently and concurrently. Its queue is bounded,
 * so one container producing far faster than the writer consumes only ever
 * costs a pause on its own stream: the other containers keep draining into
 * the response.
 */
export function createMergedLogWriter(
  sink: ExportTextSink,
  containers: readonly LogContainerRole[]
): MergedLogWriter {
  const queues = new Map<LogContainerRole, ContainerQueue>();
  for (const container of containers) {
    queues.set(container, {
      container,
      lines: [],
      lastMs: null,
      written: 0,
      paused: false,
      resume: null,
      done: false,
    });
  }

  // The response can close before, during or after the reads; the stops are
  // collected rather than fired immediately so a read that registers later
  // still learns the client is gone.
  let closed = false;
  const stops: Array<() => void> = [];
  let onLine: (() => void) | null = null;
  let onDrain: (() => void) | null = null;

  function wake(): void {
    const resume = onLine;
    onLine = null;
    resume?.();
  }

  function wakeDrain(): void {
    const resume = onDrain;
    onDrain = null;
    resume?.();
  }

  sink.onClose(() => {
    closed = true;
    wake();
    wakeDrain();
    while (stops.length > 0) {
      stops.pop()?.();
    }
  });
  sink.onDrain(() => wakeDrain());

  function enqueue(container: LogContainerRole, line: MergedLogLine): boolean {
    const queue = queues.get(container);
    if (queue === undefined || closed || queue.done) {
      return true;
    }

    queue.lines.push(line);
    wake();

    if (queue.lines.length < QUEUE_HIGH_WATER_LINES) {
      return true;
    }

    // Report backpressure so the caller pauses this container's stream. The
    // other containers are unaffected and keep feeding the writer.
    queue.paused = true;
    return false;
  }

  function release(queue: ContainerQueue): void {
    if (!queue.paused || queue.lines.length > QUEUE_LOW_WATER_LINES) {
      return;
    }

    queue.paused = false;
    const resume = queue.resume;
    queue.resume = null;
    resume?.();
  }

  function lineMs(line: MergedLogLine, fallback: number | null): number {
    if (line.kind === 'log' && line.timestamp !== null) {
      const ms = Date.parse(line.timestamp);
      if (Number.isFinite(ms)) {
        return ms;
      }
    }
    return fallback ?? Number.NEGATIVE_INFINITY;
  }

  // Lowest timestamp among the queue heads wins. Equal timestamps break by
  // container name, the same tiebreak readCollatedLogLines uses, so the
  // download reads in the order the live panel showed those lines.
  function nextQueue(): ContainerQueue | null {
    let best: ContainerQueue | null = null;
    let bestMs = Number.POSITIVE_INFINITY;

    for (const queue of queues.values()) {
      const head = queue.lines[0];
      if (head === undefined) {
        // A container that isn't finished and has nothing queued may still have
        // an earlier line on its way. Wait for it rather than writing a later
        // line from another container first.
        if (!queue.done) {
          return null;
        }
        continue;
      }

      const ms = lineMs(head, queue.lastMs);
      if (best === null || ms < bestMs || (ms === bestMs && queue.container < best.container)) {
        best = queue;
        bestMs = ms;
      }
    }

    return best;
  }

  function allDrained(): boolean {
    for (const queue of queues.values()) {
      if (!queue.done || queue.lines.length > 0) {
        return false;
      }
    }
    return true;
  }

  async function drain(): Promise<void> {
    while (!closed) {
      const queue = nextQueue();
      if (queue === null) {
        if (allDrained()) {
          return;
        }

        await new Promise<void>((resolve) => {
          onLine = resolve;
        });
        continue;
      }

      const line = queue.lines.shift() as MergedLogLine;
      if (line.kind === 'log' && line.timestamp !== null) {
        const ms = Date.parse(line.timestamp);
        if (Number.isFinite(ms)) {
          queue.lastMs = ms;
        }
      }
      queue.written += 1;

      // Released before the write: the queue is what keeps the merged stream
      // moving, and it is bounded, so letting it refill while the writer is
      // busy cannot grow memory.
      release(queue);

      if (sink.write(formatMergedLogLine(line) + '\n')) {
        continue;
      }

      await new Promise<void>((resolve) => {
        onDrain = resolve;
      });
    }
  }

  function finish(container: LogContainerRole): void {
    const queue = queues.get(container);
    if (queue === undefined) {
      return;
    }

    queue.done = true;
    // Nothing more can arrive, so a paused read has no reason to resume.
    queue.paused = false;
    queue.resume = null;
    wake();
  }

  function fail(container: LogContainerRole, reason: string): void {
    const queue = queues.get(container);
    if (queue === undefined) {
      return;
    }

    // The marker inherits this container's last timestamp, so it lands where
    // the read stopped instead of after every other container's output. A read
    // that already wrote lines, or still holds queued ones, is reported as
    // interrupted: the file holds part of that container's history, and
    // claiming otherwise would misrepresent a partial export as an empty one.
    enqueue(container, {
      kind: 'marker',
      container,
      message:
        queue.written > 0 || queue.lines.length > 0
          ? `[log export for ${container} interrupted: ${reason}]`
          : `[no logs exported for ${container}: ${reason}]`,
    });
    finish(container);
  }

  const drained = drain();

  return {
    sinkFor(container: LogContainerRole): ContainerLogLineSink {
      return {
        write: (line) => enqueue(container, line),
        onDrain: (resume) => {
          const queue = queues.get(container);
          if (queue === undefined) {
            return;
          }

          queue.resume = resume;
          // A container whose queue filled before it registered this hook
          // would otherwise stay paused forever.
          if (queue.paused) {
            release(queue);
          }
        },
        onClose: (stop) => {
          if (closed) {
            stop();
            return;
          }
          stops.push(stop);
        },
      };
    },

    finish,
    fail,
    completed: () => drained,
  };
}
