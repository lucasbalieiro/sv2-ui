import type {
  AutoRetryPolicy,
  ContainerLogLine,
  DiagnosticEvidence,
  DiagnosticSeverity,
  LogDiagnostic,
  LogParser,
} from './types.js';

const UNKNOWN_USER_REGEX =
  /OpenMiningChannelError\(request_id: \d+, error_code: unknown-user\)/;

const JDC_BITCOIN_CORE_DISCONNECTED_REGEX =
  /Failed to (create BitcoinCoreToSv2|get response):.*(CannotConnectToUnixSocket|CapnpError\(Error \{ kind: Disconnected|Disconnected: Peer disconnected)/;

const JDC_BITCOIN_CORE_IBD_HINT_REGEX =
  /Is the Bitcoin node undergoing IBD\?/;

const JDC_BITCOIN_CORE_IBD_CONTEXT_REGEX =
  /(Waiting for initial template and prevhash from Template Provider|Is the Bitcoin node undergoing IBD\?)/;

const JDC_BITCOIN_CORE_IBD_RECOVERY_REGEX =
  /Required template data received, ready to accept connections/;

const JDC_BITCOIN_CORE_UNSUPPORTED_MINING_INTERFACE_REGEX =
  /(Old mining interface \(@[^)]+\) not supported\. Please update your client!|Failed to create BitcoinCoreToSv2:.*CapnpError\(Error \{ kind: Unimplemented,.*interfaceName = capnp\/init\.capnp:Init)/;

const INVALID_CERTIFICATE_REGEX =
  /(InvalidCertificate|Invalid Certificate).*SignatureNoiseMessage \{ version: \d+, valid_from: (\d+), not_valid_after: (\d+),/;

export function unknownUserParser(lines: ContainerLogLine[]): LogDiagnostic | null {
  const matches = lines.filter(
    ({ container, message }) =>
      container === 'translator' && UNKNOWN_USER_REGEX.test(message)
  );

  if (matches.length === 0) {
    return null;
  }

  const evidence: DiagnosticEvidence[] = matches.map(
    ({ container, stream, timestamp, raw }) => ({
      container,
      stream,
      timestamp,
      line: raw,
    })
  );

  return {
    code: 'unknown-user',
    severity: 'warning' as DiagnosticSeverity,
    title: 'Invalid Braiins username',
    message: 'The Braiins username is not recognized by the pool.',
    recommendation:
      'Verify the Braiins username in your settings matches the pool account exactly, ' +
      'then start mining again.',
    streamId: 'mining-services',
    containers: ['translator'],
    detectedAt: matches[0].timestamp,
    evidence,
  };
}

export function jdcBitcoinCoreDisconnectedParser(
  lines: ContainerLogLine[]
): LogDiagnostic | null {
  const matches = lines.filter(
    ({ container, message }) =>
      container === 'jdc' && JDC_BITCOIN_CORE_DISCONNECTED_REGEX.test(message)
  );

  if (matches.length === 0) {
    return null;
  }

  const evidence: DiagnosticEvidence[] = matches.map(
    ({ container, stream, timestamp, raw }) => ({
      container,
      stream,
      timestamp,
      line: raw,
    })
  );

  return {
    code: 'jdc-bitcoin-core-disconnected',
    severity: 'error' as DiagnosticSeverity,
    title: 'Bitcoin Core stopped running',
    message: 'We lost connection with your Bitcoin Core node.',
    recommendation:
      "Make sure your Bitcoin Core node is up and running on the same computer where you're running the sv2-ui app.",
    streamId: 'mining-services',
    containers: ['jdc'],
    detectedAt: matches[0].timestamp,
    evidence,
  };
}

export function jdcBitcoinCoreInitialBlockDownloadParser(
  lines: ContainerLogLine[]
): LogDiagnostic | null {
  let latestIbdHintIndex = -1;
  let latestRecoveryIndex = -1;

  lines.forEach(({ container, message }, index) => {
    if (container !== 'jdc') {
      return;
    }

    if (JDC_BITCOIN_CORE_IBD_HINT_REGEX.test(message)) {
      latestIbdHintIndex = index;
    }

    if (JDC_BITCOIN_CORE_IBD_RECOVERY_REGEX.test(message)) {
      latestRecoveryIndex = index;
    }
  });

  if (latestIbdHintIndex === -1 || latestRecoveryIndex > latestIbdHintIndex) {
    return null;
  }

  const ibdMatches = lines.filter(
    ({ container, message }, index) =>
      index > latestRecoveryIndex &&
      container === 'jdc' &&
      JDC_BITCOIN_CORE_IBD_HINT_REGEX.test(message)
  );

  if (ibdMatches.length === 0) {
    return null;
  }

  const matches = lines.filter(
    ({ container, message }, index) =>
      index > latestRecoveryIndex &&
      container === 'jdc' && JDC_BITCOIN_CORE_IBD_CONTEXT_REGEX.test(message)
  );

  const evidence: DiagnosticEvidence[] = matches.map(
    ({ container, stream, timestamp, raw }) => ({
      container,
      stream,
      timestamp,
      line: raw,
    })
  );

  return {
    code: 'jdc-bitcoin-core-initial-block-download',
    severity: 'error' as DiagnosticSeverity,
    title: 'Bitcoin Core is still syncing',
    message:
      'Your Bitcoin Core node is in initial block download, so it cannot provide block templates yet.',
    recommendation:
      'Wait until Bitcoin Core finishes syncing; this warning will clear once JDC receives template data.',
    streamId: 'mining-services',
    containers: ['jdc'],
    detectedAt: ibdMatches[0].timestamp,
    evidence,
  };
}

export function jdcBitcoinCoreUnsupportedMiningInterfaceParser(
  lines: ContainerLogLine[]
): LogDiagnostic | null {
  const matches = lines.filter(
    ({ container, message }) =>
      container === 'jdc' && JDC_BITCOIN_CORE_UNSUPPORTED_MINING_INTERFACE_REGEX.test(message)
  );

  if (matches.length === 0) {
    return null;
  }

  const evidence: DiagnosticEvidence[] = matches.map(
    ({ container, stream, timestamp, raw }) => ({
      container,
      stream,
      timestamp,
      line: raw,
    })
  );

  return {
    code: 'jdc-bitcoin-core-unsupported-mining-interface',
    severity: 'error' as DiagnosticSeverity,
    title: 'Bitcoin Core version does not match',
    message:
      'The Bitcoin Core version selected in setup does not match the node that is running.',
    recommendation:
      'Open setup and select your actual Bitcoin Core version.',
    streamId: 'mining-services',
    containers: ['jdc'],
    detectedAt: matches[0].timestamp,
    evidence,
  };
}

function invalidCertificateParser(lines: ContainerLogLine[]): LogDiagnostic | null {
  const matches = lines.filter(
    ({ container, message }) =>
      (container === 'translator' || container === 'jdc') &&
      INVALID_CERTIFICATE_REGEX.test(message)
  );

  if (matches.length === 0) {
    return null;
  }

  const evidence: DiagnosticEvidence[] = matches.map(
    ({ container, stream, timestamp, raw }) => ({
      container,
      stream,
      timestamp,
      line: raw,
    })
  );

  return {
    code: 'invalid-certificate',
    severity: 'error' as DiagnosticSeverity,
    title: 'Invalid Server Certificate',
    message:
      'We were unable to stablish communication with the pool.',
    recommendation: 'Check that your system clock is set correctly and synchronized with an NTP server.',
    streamId: 'mining-services',
    containers: ['translator', 'jdc'],
    detectedAt: matches[0].timestamp,
    evidence,
  };
}

// Central registry for scenario-specific parsers. New log-derived diagnostics
// should be added here without changing the collection pipeline.
//
// autoRetry encodes what the auto-start reconciler may do while the scenario
// is diagnosed on a stopped stack (see AutoRetryPolicy):
// - unknown-user / unsupported-mining-interface: fatal and fixed only via a
//   config change, which restarts the stack itself. Never auto-restart.
// - jdc-bitcoin-core-disconnected: fatal, but the JD start path already gates
//   on a Bitcoin Core socket probe, so restarting once the probe passes is
//   safe ('probe').
// - invalid-certificate: caused by clock skew that NTP may fix on its own, so
//   retry, but slowly.
// - initial-block-download: JDC stays up while syncing so this normally never
//   reaches the reconciler; 'slow' is a defensive default.
export const logParsers: LogParser[] = [
  { code: 'unknown-user', match: unknownUserParser, autoRetry: 'never' },
  {
    code: 'jdc-bitcoin-core-disconnected',
    match: jdcBitcoinCoreDisconnectedParser,
    autoRetry: 'retry',
  },
  {
    code: 'jdc-bitcoin-core-initial-block-download',
    match: jdcBitcoinCoreInitialBlockDownloadParser,
    autoRetry: 'retry',
  },
  {
    code: 'jdc-bitcoin-core-unsupported-mining-interface',
    match: jdcBitcoinCoreUnsupportedMiningInterfaceParser,
    autoRetry: 'never',
  },
  { code: 'invalid-certificate', match: invalidCertificateParser, autoRetry: 'retry' },
];

/**
 * The auto-start policy for a diagnostic code, or null when the code is not
 * in the registry (a diagnostic produced by a parser registered under a
 * different code). Callers must treat null as 'never': an unknown scenario
 * is by definition one we cannot justify auto-restarting around.
 */
export function getAutoRetryPolicy(code: string): AutoRetryPolicy | null {
  return logParsers.find((parser) => parser.code === code)?.autoRetry ?? null;
}

function toDiagnosticsArray(
  diagnostic: LogDiagnostic | LogDiagnostic[] | null
): LogDiagnostic[] {
  if (!diagnostic) {
    return [];
  }

  return Array.isArray(diagnostic) ? diagnostic : [diagnostic];
}

function getDiagnosticKey(diagnostic: LogDiagnostic): string {
  return [
    diagnostic.code,
    diagnostic.streamId,
    diagnostic.severity,
    diagnostic.title,
    diagnostic.message,
    diagnostic.recommendation,
    [...diagnostic.containers].sort().join(','),
  ].join('::');
}

function getLatestTimestamp(
  left: string | null,
  right: string | null
): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function mergeDiagnostics(
  current: LogDiagnostic,
  incoming: LogDiagnostic
): LogDiagnostic {
  const evidence = [...current.evidence, ...incoming.evidence].filter(
    (item, index, items) =>
      items.findIndex((candidate) =>
        candidate.container === item.container &&
        candidate.stream === item.stream &&
        candidate.timestamp === item.timestamp &&
        candidate.line === item.line
      ) === index
  );

  return {
    ...current,
    containers: [...new Set([...current.containers, ...incoming.containers])],
    detectedAt: getLatestTimestamp(current.detectedAt, incoming.detectedAt),
    evidence,
  };
}

function deduplicateDiagnostics(diagnostics: LogDiagnostic[]): LogDiagnostic[] {
  const deduplicated = new Map<string, LogDiagnostic>();

  diagnostics.forEach((diagnostic) => {
    const key = getDiagnosticKey(diagnostic);
    const existing = deduplicated.get(key);

    deduplicated.set(
      key,
      existing ? mergeDiagnostics(existing, diagnostic) : diagnostic
    );
  });

  return [...deduplicated.values()];
}

// Parsers operate on the collated logical stream and can return one or many
// diagnostics each. We deduplicate equivalent diagnostics here so retry loops
// or repeated log emissions do not surface as duplicated user-facing errors.
export function collectDiagnostics(
  lines: ContainerLogLine[],
  parsers: LogParser[] = logParsers
): LogDiagnostic[] {
  const diagnostics = parsers.flatMap((parser) => toDiagnosticsArray(parser.match(lines)));

  return deduplicateDiagnostics(diagnostics);
}
