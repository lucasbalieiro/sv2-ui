import type { LogContainerRole, LogOutputStream } from './types.js';

// Docker uses an 8-byte framing header for non-TTY stdout/stderr multiplexing.
// Reference: https://docs.docker.com/reference/api/engine/version/v1.45/#tag/Container/operation/ContainerAttach
export const DOCKER_LOG_HEADER_SIZE = 8;

// Cap for how much text one container may contribute to a log download. With
// json-file rotation in place this never engages; for containers created
// before the rotation config existed it stops the export once the budget is
// spent instead of materializing unbounded history.
export const CONTAINER_LOG_EXPORT_MAX_BYTES = 64 * 1024 * 1024;

// The export budget only counts lines already handed to the writer, so the
// two buffers that wait for a delimiter need their own bounds: a container
// that logs a very long line without a newline (or a corrupt frame header
// claiming a huge payload) would otherwise grow the heap until the cap could
// ever apply. Real log lines are far below this.
const MAX_PARTIAL_LINE_BYTES = 1024 * 1024;
const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;

export type DockerLogChunk = {
  stream: LogOutputStream;
  payload: string;
};

export type ContainerLogExportStats = {
  bytes: number;
  truncated: boolean;
};

// One line of exportable output. Lines stay structured all the way from the
// demuxer to the writer: the download interleaves containers by timestamp, so
// the timestamp has to survive until the merged stream decides which line goes
// next. Formatting happens once, at the point of writing.
export type MergedLogLine =
  | {
      // Container output, carrying the documented
      // `timestamp [container] [stream] message` shape.
      kind: 'log';
      container: LogContainerRole;
      stream: LogOutputStream;
      timestamp: string | null;
      message: string;
    }
  | {
      // Text this export wrote itself: a truncated read, or a container that
      // could not be read. Emitted verbatim and unadorned, so it can never be
      // mistaken for something the container said, and joined into the merged
      // stream where that container left off rather than appended at the end.
      kind: 'marker';
      container: LogContainerRole;
      message: string;
    };

// The download route formats lines straight into the HTTP response, so the
// helper needs the writer's backpressure signal plus the two lifecycle hooks
// that bound the docker stream: resume when the writer drains, stop when the
// consumer goes away (e.g. the browser aborts the download). Each container
// gets its own sink so one container's backlog cannot stall another's.
export type ContainerLogLineSink = {
  write: (line: MergedLogLine) => boolean;
  onDrain: (resume: () => void) => void;
  onClose: (stop: () => void) => void;
};

// Dockerode prefixes lines with an RFC 3339 timestamp when `timestamps: true`
// is enabled, so we split it from the log message. The formatted line keeps
// the exact shape the previous client-side download builder produced:
// `timestamp [container] [stream] message`.
//
// The `s` flag matters: `.` excludes line terminators, so a message holding a
// carriage return (or U+2028/U+2029) would fail the match entirely and export
// as an untagged line with the timestamp glued into the message text.
const DOCKER_LOG_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\S+?)\s(.*)$/s;

// Container log text is controlled by the mining workload and is written
// verbatim into the exported file, which an operator may display in a
// terminal: OSC-52 can overwrite the clipboard, CSI/C1 sequences can clear
// or repaint the screen, and a mid-line carriage return can rewrite the
// start of the line. Strip terminal-executable control characters while
// keeping printable text: an escape sequence's printable parameters remain
// as inert text (no introducer byte, nothing to act on), and tab survives
// to preserve column alignment.
// eslint-disable-next-line no-control-regex
const TERMINAL_CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// Renders a structured line as the text that reaches the file. Shared by the
// per-container byte budget and the merged writer so the cap counts exactly
// what is written.
export function formatMergedLogLine(line: MergedLogLine): string {
  if (line.kind === 'marker') {
    return line.message;
  }

  const parts: string[] = [];
  if (line.timestamp) {
    parts.push(line.timestamp);
  }
  parts.push(`[${line.container}]`, `[${line.stream}]`, line.message);
  // Sanitize the joined line, not just the message: the loose timestamp
  // capture would otherwise let a container-crafted prefix carry controls.
  return parts.join(' ').replace(TERMINAL_CONTROL_CHARS_RE, '');
}

// What the download route provides: the response's own backpressure signal
// plus the two events that bound a streaming export. The merged writer drains
// lines into this, one already-formatted line at a time.
export type ExportTextSink = {
  write: (text: string) => boolean;
  onDrain: (resume: () => void) => void;
  onClose: (stop: () => void) => void;
};

// Incremental counterpart of demuxDockerLogBuffer in docker.ts: the same
// frame protocol, but frames can be split at arbitrary byte boundaries
// across stream chunks, so the demuxer keeps a remainder until the frame
// completes.
export function createDockerLogDemuxer(
  emit: (chunk: DockerLogChunk) => void
): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0);

  return (chunk: Buffer): void => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    while (pending.length >= DOCKER_LOG_HEADER_SIZE) {
      const payloadLength = pending.readUInt32BE(4);
      if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
        // Believed only as far as it is plausible: a header claiming more than
        // any real log write would otherwise buffer towards a size the export
        // budget can never stop.
        pending = Buffer.alloc(0);
        throw new Error(
          `Refusing a docker log frame of ${payloadLength} bytes (limit ${MAX_FRAME_PAYLOAD_BYTES})`
        );
      }

      const frameEnd = DOCKER_LOG_HEADER_SIZE + payloadLength;
      if (pending.length < frameEnd) {
        break;
      }

      emit({
        stream: pending.readUInt8(0) === 2 ? 'stderr' : 'stdout',
        payload: pending.subarray(DOCKER_LOG_HEADER_SIZE, frameEnd).toString('utf-8'),
      });
      pending = pending.subarray(frameEnd);
    }
  };
}

export function createLogLineFormatter(
  container: LogContainerRole,
  emitLine: (line: MergedLogLine) => void
): { consume: (chunk: DockerLogChunk) => void; flush: () => void } {
  let partial = '';
  let partialStream: LogOutputStream = 'stdout';

  const toLine = (raw: string, stream: LogOutputStream): MergedLogLine => {
    const match = raw.match(DOCKER_LOG_TIMESTAMP_RE);
    return {
      kind: 'log',
      container,
      stream,
      timestamp: match ? match[1] : null,
      message: match ? match[2] : raw,
    };
  };

  const emitCompleted = (raw: string, stream: LogOutputStream): void => {
    const line = raw.replace(/\r$/, '');
    if (line.length > 0) {
      emitLine(toLine(line, stream));
    }
  };

  // Emit whatever is buffered once it can no longer be a whole line: without
  // a newline in sight it would otherwise keep growing until the container
  // emitted one, long past the export budget.
  function flushOversizedPartial(): void {
    if (Buffer.byteLength(partial, 'utf8') <= MAX_PARTIAL_LINE_BYTES) {
      return;
    }

    // Cut on a character boundary: a dangling surrogate would reach the file
    // as a replacement character.
    let cut = partial.slice(0, MAX_PARTIAL_LINE_BYTES);
    if (/[\uD800-\uDBFF]$/.test(cut)) {
      cut = cut.slice(0, -1);
    }

    emitLine(toLine(`${cut} [line truncated]`, partialStream));
    partial = '';
  }

  return {
    consume(chunk: DockerLogChunk): void {
      // A frame boundary mid-line must not glue stderr remnants onto a
      // stdout line: flush the pending partial under its own stream tag.
      if (partial.length > 0 && chunk.stream !== partialStream) {
        flushOversizedPartial();
        emitCompleted(partial, partialStream);
        partial = '';
      }
      partialStream = chunk.stream;

      const text = partial + chunk.payload;
      const lines = text.split('\n');
      partial = lines.pop() ?? '';
      for (const raw of lines) {
        emitCompleted(raw, chunk.stream);
      }
      flushOversizedPartial();
    },
    flush(): void {
      if (partial.length > 0) {
        emitCompleted(partial, partialStream);
        partial = '';
      }
    },
  };
}
