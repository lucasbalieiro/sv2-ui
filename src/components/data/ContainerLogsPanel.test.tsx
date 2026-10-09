import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContainerLogsPanel, LOG_DOWNLOAD_PATH } from './ContainerLogsPanel';

test('log downloads request the streamed, byte-capped export endpoint', () => {
  // The export must not request unbounded container history through
  // /api/logs/raw (CWE-400); the dedicated route streams formatted text
  // with a server-side cap instead.
  assert.equal(LOG_DOWNLOAD_PATH, '/api/logs/download');
  assert.doesNotMatch(LOG_DOWNLOAD_PATH, /tail=all/);
});

test('the rendered download link streams the export to disk', () => {
  // A fetch/blob download buffers the whole export in the JS heap and needs a
  // client timeout that a large body on a slow link can outrun. Asserted on the
  // rendered anchor rather than on the source, so this survives moving the href
  // into a variable and still fails if the link stops being a plain link.
  const html = renderToStaticMarkup(
    <ContainerLogsPanel
      lines={[{ container: 'translator', stream: 'stdout', timestamp: null, message: 'up', raw: 'up' }]}
      isLoading={false}
      isJdMode={false}
    />
  );

  assert.match(html, /<a[^>]*href="\/api\/logs\/download"/);
  // The download attribute is what keeps it a file save instead of a
  // navigation the app router might try to handle.
  assert.match(html, /<a[^>]*\sdownload/);
  // Nothing in the panel fetches the export into memory any more.
  assert.doesNotMatch(html, /\/api\/logs\/raw/);
});
