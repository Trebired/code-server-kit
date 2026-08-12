import type {
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerLaunchStrategy,
  CodeServerLifecyclePhase,
  CodeServerReadinessTarget,
  CodeServerSessionHealth,
  CodeServerSessionState,
  CodeServerSystemdScope,
  CodeServerWatchdogMode,
} from "./core.js";
import type { CodeServerBrowserDiagnosticsSummary, CodeServerSessionBrowserOptions } from "./browser.js";
import type {
  CodeServerSanitizedDiagnostics,
  CodeServerSanitizerOptions,
  NormalizedCodeServerStartupFailure,
} from "./diagnostics.js";
import type {
  CodeServerInstallation,
  CodeServerPreparationStatus,
  CodeServerReadonlyInput,
} from "./preparation.js";
import type {
  CodeServerLaunchPlan,
  CodeServerReadyFailureProbe,
  CodeServerReadyResult,
  CreateCodeServerLaunchPlanOptions,
} from "./launch.js";
import type { CodeServerProfileLifecycleOptions, CodeServerProfilePolicy } from "./profile.js";
import type { CodeServerSystemdOptions } from "./systemd.js";

type CodeServerSessionBackendCheckpoint = {
  details: Record<string, unknown>;
  phase: CodeServerLifecyclePhase | "session";
  summary: string;
  timestamp: string;
};

type CodeServerSessionDiagnosticsSnapshot = {
  activeState?: string | null;
  backendCheckpoints?: CodeServerSessionBackendCheckpoint[];
  browserEvents?: import("./browser.js").CodeServerBrowserDiagnosticEvent[];
  correlationId?: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
  journalTail?: string;
  normalizedFailure?: NormalizedCodeServerStartupFailure | null;
  pid?: number | null;
  readyElapsedMs?: number | null;
  stderrTail?: string;
  stdoutTail?: string;
  subState?: string | null;
  summary?: Record<string, unknown>;
  updatedAt: string;
  unitName?: string | null;
};

type CodeServerSessionDiagnostics = {
  backendCheckpoints?: CodeServerSessionBackendCheckpoint[];
  browserEvents?: import("./browser.js").CodeServerBrowserDiagnosticEvent[];
  correlationId?: string;
  diagnosticsPath: string;
  journalTail?: string;
  normalizedFailure?: NormalizedCodeServerStartupFailure | null;
  readyElapsedMs?: number | null;
  recordPath: string;
  sanitized?: CodeServerSanitizedDiagnostics | null;
  stderrTail?: string;
  stdoutTail?: string;
  summary: Record<string, unknown>;
  updatedAt: string;
};

type CodeServerSessionFailure = {
  code: string;
  details: Record<string, unknown>;
  hints?: string[];
  message: string;
  name: string;
  phase?: CodeServerLifecyclePhase;
  retryable?: boolean;
};

type CodeServerSessionRecord = {
  bindAddr: string;
  browserSummary?: CodeServerBrowserDiagnosticsSummary | null;
  correlationId?: string | null;
  diagnostics: CodeServerSessionDiagnosticsSnapshot | null;
  extensionsDir: string;
  failure?: CodeServerSessionFailure | null;
  health: CodeServerSessionHealth;
  lastStartSummary?: string | null;
  launchStrategy: CodeServerLaunchStrategy;
  metadata?: Record<string, unknown>|null;
  pid: number | null;
  port: number;
  preparation: CodeServerPreparationStatus | null;
  readyAt: string | null;
  readinessTarget?: CodeServerReadinessTarget | null;
  sanitizedDiagnostics?: CodeServerSanitizedDiagnostics | null;
  sessionKey: string;
  specHash: string;
  startedAt: string | null;
  state: CodeServerSessionState;
  stoppedAt: string | null;
  systemdScope: CodeServerSystemdScope | null;
  trustedOrigins: string[];
  unitName: string | null;
  updatedAt: string;
  userDataDir: string;
  watchdogMode: CodeServerWatchdogMode;
  workspacePath: string | null;
};

type CodeServerSessionStatus = {
  bindAddr: string;
  browserSummary?: CodeServerBrowserDiagnosticsSummary | null;
  correlationId?: string | null;
  diagnostics: CodeServerSessionDiagnostics | null;
  extensionsDir: string;
  failure: CodeServerSessionFailure | null;
  health: CodeServerSessionHealth;
  lastStartSummary: string | null;
  launchStrategy: CodeServerLaunchStrategy;
  metadata?: Record<string, unknown>|null;
  pid: number | null;
  port: number;
  preparation: CodeServerPreparationStatus | null;
  ready: boolean;
  readyAt: string | null;
  readinessTarget?: CodeServerReadinessTarget | null;
  sanitizedDiagnostics: CodeServerSanitizedDiagnostics | null;
  sessionKey: string;
  specHash: string;
  startedAt: string | null;
  state: CodeServerSessionState;
  stoppedAt: string | null;
  systemdScope: CodeServerSystemdScope | null;
  unitName: string | null;
  updatedAt: string;
  userDataDir: string;
  watchdogMode: CodeServerWatchdogMode;
  workspacePath: string | null;
};

type CodeServerSessionStartResult = {
  created: boolean;
  diagnostics: CodeServerSessionDiagnostics | null;
  handle: import("./launch.js").CodeServerProcessHandle | null;
  launchPlan: CodeServerLaunchPlan;
  launchStrategy: CodeServerLaunchStrategy;
  readiness: CodeServerReadyResult | null;
  reused: boolean;
  status: CodeServerSessionStatus;
};

type CodeServerSessionStopResult = {
  diagnostics: CodeServerSessionDiagnostics | null;
  signal?: NodeJS.Signals | number;
  status: CodeServerSessionStatus;
  stopped: boolean;
};

type CodeServerSessionRestartResult = {
  start: CodeServerSessionStartResult;
  stop: CodeServerSessionStopResult;
};

type CodeServerSessionManagerOptions = {
  browser?: CodeServerSessionBrowserOptions;
  installation?: CodeServerInstallation;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  profile?: CodeServerProfileLifecycleOptions | CodeServerProfilePolicy;
  readonly?: CodeServerReadonlyInput;
  resolveFrom?: string;
};

type CodeServerSessionRequest = CreateCodeServerLaunchPlanOptions& {
  failureProbe?: CodeServerReadyFailureProbe;
  launchStrategy?: CodeServerLaunchStrategy;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  metadata?: Record<string, unknown>;
  profile?: CodeServerProfileLifecycleOptions | CodeServerProfilePolicy;
  readinessRetryIntervalMs?: number;
  readinessTimeoutMs?: number;
  sanitizer?: CodeServerSanitizerOptions;
  sessionKey: string;
  stateRoot: string;
  systemd?: CodeServerSystemdOptions;
  websocketUrl?: string;
};

type CodeServerSessionManager = {
  getStatus(
    options: Pick<CodeServerSessionRequest,
    "logger" | "loggerAdapter" | "sanitizer" | "sessionKey" | "stateRoot">
  ): Promise<CodeServerSessionStatus|null>;
  readDiagnostics(options: Pick<CodeServerSessionRequest, "sanitizer"|"sessionKey"|"stateRoot">): Promise<CodeServerSessionDiagnostics|null>;
  restart(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult>;
  start(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult>;
  stop(options: Pick<CodeServerSessionRequest, "logger"|"loggerAdapter"|"profile"|"sanitizer"|"sessionKey"|"stateRoot">& {
      signal?: NodeJS.Signals | number;
  }): Promise<CodeServerSessionStopResult|null>;
};

export type {
  CodeServerSessionBackendCheckpoint,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionFailure,
  CodeServerSessionManager,
  CodeServerSessionManagerOptions,
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionRestartResult,
  CodeServerSessionStartResult,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
};
