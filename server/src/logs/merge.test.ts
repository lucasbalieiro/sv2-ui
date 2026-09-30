import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LogContainerRole } from './types.js';
import type { ExportTextSink, MergedLogLine } from './export.js';
import { createMergedLogWriter } from './merge.js';

const TS = '2026-01-01T00:00:00.000000000Z';

// Mirrors what the formatter does, so these tests assert on the text that
// reaches the file rather than on the writer's internals.
function logLine(container: LogContainerRole, payload: string): MergedLogLine {
  const match = payload.match(/^(\d{4}-\d{2}-\d{2}T\S+?)\s(.*)$/);
  return {
    kind: 'log',
    container,
    stream: 'stdout',
    timestamp: match ? match[1] : null,
    message: match ? match[2] : payload,
  };
}

function createTestSink(blockedWrites = 0) {
  const chunks: string[] = [];
  let remainingBlocks = blockedWrites;
  // The route registers these once and the response fires them repeatedly, so
  // they are modelled as listeners that stay attached rather than as a single
  // callback slot.
  const drains: Array<() => void> = [];
  const stops: Array<() => void> = [];

  const sink: ExportTextSink = {
    write: (text) => {
      chunks.push(text);
      if (remainingBlocks > 0) {
        remainingBlocks -= 1;
        return false;
      }
      return true;
    },
    onDrain: (resume) => {
      drains.push(resume);
    },
    onClose: (stop) => {
      stops.push(stop);
    },
  };

  return {
    chunks,
    sink,
    release: () => {
      for (const resume of drains) {
        resume();
      }
    },
    close: () => {
      while (stops.length > 0) {
        stops.pop()?.();
      }
    },
  };
}

function tick(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test('interleaves containers by timestamp instead of exporting one after another', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  // Each container is already in time order, as the daemon delivers it. The
  // translator's history is much the longer of the two, which is exactly the
  // case where exporting one container in full before the other loses the
  // order of a handshake across them.
  writer
    .sinkFor('translator')
    .write(logLine('translator', `${TS} t1`));
  writer.sinkFor('translator').write(logLine('translator', '2026-01-01T00:00:03.000000000Z t3'));
  writer.sinkFor('translator').write(logLine('translator', '2026-01-01T00:00:05.000000000Z t5'));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:02.000000000Z j2'));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:04.000000000Z j4'));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:06.000000000Z j6'));
  writer.finish('translator');
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    `${TS} [translator] [stdout] t1\n`,
    '2026-01-01T00:00:02.000000000Z [jdc] [stdout] j2\n',
    '2026-01-01T00:00:03.000000000Z [translator] [stdout] t3\n',
    '2026-01-01T00:00:04.000000000Z [jdc] [stdout] j4\n',
    '2026-01-01T00:00:05.000000000Z [translator] [stdout] t5\n',
    '2026-01-01T00:00:06.000000000Z [jdc] [stdout] j6\n',
  ]);
});

test('interleaves even when one container delivers its whole batch first', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  // The shape of a real download: one docker stream starts delivering before
  // the other has produced anything. Queueing everything synchronously (as
  // the test above does) hides this, so the batches are separated by a tick.
  writer.sinkFor('translator').write(logLine('translator', '2026-01-01T00:00:01.000000000Z t1'));
  writer.sinkFor('translator').write(logLine('translator', '2026-01-01T00:00:03.000000000Z t3'));
  writer.sinkFor('translator').write(logLine('translator', '2026-01-01T00:00:05.000000000Z t5'));
  await tick();

  // The JDC's history may start earlier than the translator's latest line,
  // so writing what has arrived so far would put the translator's whole
  // batch ahead of the JDC's — the sequential export all over again.
  assert.deepEqual(chunks, []);

  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:02.000000000Z j2'));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:04.000000000Z j4'));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:06.000000000Z j6'));
  writer.finish('translator');
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    '2026-01-01T00:00:01.000000000Z [translator] [stdout] t1\n',
    '2026-01-01T00:00:02.000000000Z [jdc] [stdout] j2\n',
    '2026-01-01T00:00:03.000000000Z [translator] [stdout] t3\n',
    '2026-01-01T00:00:04.000000000Z [jdc] [stdout] j4\n',
    '2026-01-01T00:00:05.000000000Z [translator] [stdout] t5\n',
    '2026-01-01T00:00:06.000000000Z [jdc] [stdout] j6\n',
  ]);
});

test('breaks equal timestamps by container name, as the live panel collates them', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  writer.sinkFor('translator').write(logLine('translator', `${TS} from translator`));
  writer.sinkFor('jdc').write(logLine('jdc', `${TS} from jdc`));
  writer.finish('translator');
  writer.finish('jdc');

  await writer.completed();

  // sortLines in logs/diagnostics.ts breaks a timestamp tie the same way, so
  // the download reads in the order the panel showed those lines.
  assert.deepEqual(chunks, [
    `${TS} [jdc] [stdout] from jdc\n`,
    `${TS} [translator] [stdout] from translator\n`,
  ]);
});

test('a line the daemon sent without a timestamp keeps its container position', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  // Written first, but held back: the JDC has not produced anything yet, and
  // its history may start earlier, so nothing of the translator's is written
  // until it shows.
  writer.sinkFor('translator').write(logLine('translator', '2026-01-01T00:00:01.000000000Z first'));
  await tick();
  assert.deepEqual(chunks, []);

  // A continuation carrying no timestamp of its own, and a JDC line that
  // predates the translator's held-back line. Both queues now have data, so
  // the JDC's 0.5s line lands first, then the translator's 1.0s line, and the
  // continuation follows in its own container's order — ordered against the
  // translator's last-written timestamp rather than sorting to the front of
  // the export as a line with no time at all.
  writer.sinkFor('translator').write(logLine('translator', 'a continuation line'));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:00.500000000Z midway'));
  writer.finish('translator');
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    '2026-01-01T00:00:00.500000000Z [jdc] [stdout] midway\n',
    '2026-01-01T00:00:01.000000000Z [translator] [stdout] first\n',
    '[translator] [stdout] a continuation line\n',
  ]);
});

test('bounds a container queue behind a slow writer and resumes the read', async () => {
  // A writer that never accepts a line, so only the queue bound can stop the
  // producer.
  const { sink, release } = createTestSink(Number.MAX_SAFE_INTEGER);
  const writer = createMergedLogWriter(sink, ['translator']);
  const target = writer.sinkFor('translator');

  let resumed = 0;
  target.onDrain(() => {
    resumed += 1;
  });

  let accepted = 0;
  for (let i = 0; i < 5000; i += 1) {
    if (!target.write(logLine('translator', `${TS} line ${i}`))) {
      break;
    }
    accepted += 1;
  }

  // One short of the 2000-line high-water mark. Past that the read is told to
  // pause rather than buffering an unbounded backlog while the writer lags.
  assert.equal(accepted, 1999);
  assert.equal(resumed, 0);

  // Draining the writer lets the merged stream advance; once the queue falls
  // under the low-water mark the container's read is resumed.
  for (let i = 0; i < 2100 && resumed === 0; i += 1) {
    release();
    await tick();
  }

  assert.equal(resumed, 1);
});

test('reports a failed read as interrupted when it had already written lines', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  // Both containers have something queued, so the merge can order them and the
  // translator's line is written before its read fails.
  writer.sinkFor('translator').write(logLine('translator', `${TS} one`));
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:02.000000000Z two'));
  await tick();
  writer.fail('translator', 'log read failed');
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    `${TS} [translator] [stdout] one\n`,
    // The marker inherits the translator's last timestamp, so it lands where
    // the read stopped rather than after the JDC's later line.
    '[log export for translator interrupted: log read failed]\n',
    '2026-01-01T00:00:02.000000000Z [jdc] [stdout] two\n',
  ]);
});

test('reports a failed read as interrupted while its lines are still queued', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  // The JDC has nothing to offer yet, so the translator's line is held back
  // and nothing has reached the file when its read fails. Those queued lines
  // are still written, so this is a partial export rather than an empty one.
  writer.sinkFor('translator').write(logLine('translator', `${TS} one`));
  await tick();
  writer.fail('translator', 'log read failed');
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:02.000000000Z two'));
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    `${TS} [translator] [stdout] one\n`,
    '[log export for translator interrupted: log read failed]\n',
    '2026-01-01T00:00:02.000000000Z [jdc] [stdout] two\n',
  ]);
});

test('reports a failed read as empty only when the container produced nothing', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  writer.fail('translator', 'container is not running');
  writer.sinkFor('jdc').write(logLine('jdc', `${TS} still here`));
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    '[no logs exported for translator: container is not running]\n',
    `${TS} [jdc] [stdout] still here\n`,
  ]);
});

test('a truncated container stops contributing without ending the export', async () => {
  const { chunks, sink } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator', 'jdc']);

  writer.sinkFor('translator').write(logLine('translator', `${TS} kept`));
  await tick();
  // What streamContainerLogText writes when it hits its byte cap.
  writer.sinkFor('translator').write({
    kind: 'marker',
    container: 'translator',
    message: '[log export for translator truncated at 100 bytes]',
  });
  writer.finish('translator');
  writer.sinkFor('jdc').write(logLine('jdc', '2026-01-01T00:00:01.000000000Z after'));
  writer.finish('jdc');

  await writer.completed();

  assert.deepEqual(chunks, [
    `${TS} [translator] [stdout] kept\n`,
    // Ordering the marker like any other line puts it at the translator's last
    // timestamp, so it lands before the JDC line that came after it rather
    // than being appended to the end of the file.
    '[log export for translator truncated at 100 bytes]\n',
    '2026-01-01T00:00:01.000000000Z [jdc] [stdout] after\n',
  ]);
});

test('stops writing once the client goes away', async () => {
  const { chunks, sink, close } = createTestSink();
  const writer = createMergedLogWriter(sink, ['translator']);

  writer.sinkFor('translator').write(logLine('translator', `${TS} one`));
  await tick();
  assert.equal(chunks.length, 1);

  close();
  // A read that reports in after the client left must not resurrect the export.
  writer.sinkFor('translator').write(logLine('translator', `${TS} two`));
  writer.finish('translator');

  await writer.completed();

  assert.equal(chunks.length, 1);
});
