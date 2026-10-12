import type { LogContainerRole, LogOutputStream, LogSourceKind, LogStreamId, DiagnosticSeverity, ContainerLogLine, DiagnosticEvidence, LogDiagnostic, LogStreamDefinition, LogDiagnosticsResponse, ContainerLogsResponse } from '@sv2-ui/shared';

export type { LogContainerRole, LogOutputStream, LogSourceKind, LogStreamId, DiagnosticSeverity, ContainerLogLine, DiagnosticEvidence, LogDiagnostic, LogStreamDefinition, LogDiagnosticsResponse, ContainerLogsResponse };

export interface LogParser {
  code: string;
  // Each parser is expected to represent one diagnostic scenario
  // (for example, one concrete log-derived user-facing error). It receives
  // the collated log lines for the logical stream and can emit one or many
  // matching diagnostics for that scenario.
  match: (lines: ContainerLogLine[]) => LogDiagnostic | LogDiagnostic[] | null;
  // What the auto-start reconciler may do on its own while this scenario is
  // diagnosed on a stopped stack. See AutoRetryPolicy.
  autoRetry: AutoRetryPolicy;
}

/**
 * How auto-start treats a stopped stack whose logs contain this diagnostic.
 *
 * The RestartPolicy of the mining containers is `no` (PR #96): a container
 * that fails stays stopped so its logs remain readable and the diagnostic
 * banner stays steady. The auto-start reconciler would otherwise recreate
 * those containers on every tick, wiping the evidence and blinking the
 * banner. These policies decide, per scenario, whether a restart is safe
 * or whether the stack must wait for the user.
 */
export type AutoRetryPolicy =
  // Fatal and user-actionable (bad credentials, wrong setup choice). The
  // fix is a config change, and every config-change path restarts the
  // stack itself, so auto-start must not restart around the user.
  | 'never'
  // The failure may clear without a config change: Bitcoin Core coming
  // back, NTP syncing the clock, or a downstream miner connecting to the
  // Translator. Auto-start may restart; a stack that stops again quickly
  // then hits the reconciler's crash-loop backoff.
  | 'retry';
