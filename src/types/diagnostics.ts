import type {
  CodeServerDiagnosticCategory,
  CodeServerLaunchStrategy,
  CodeServerLifecyclePhase,
  CodeServerWatchdogMode,
} from "./core.js";
import type { CodeServerBrowserDiagnosticEvent } from "./browser.js";
import type { CodeServerProcessHandle, CodeServerReadyCheckpoint } from "./launch.js";
import type { CodeServerPreparationStatus } from "./preparation.js";

type CodeServerSanitizerOptions = {
  pathPrefixes?: string[];
  values?: string[];
  replacer ? (value: string) : string;
};

type CodeServerSanitizedDiagnostics = {
  details: Record<string, unknown>;
  summary: string;
};

type CodeServerStartupDiagnostics = {
  browserEvents?: CodeServerBrowserDiagnosticEvent[];
  category: CodeServerDiagnosticCategory;
  checkpoints?: CodeServerReadyCheckpoint[];
  code: string;
  details: Record<string, unknown>;
  hints: string[];
  journalSummary?: string;
  launchStrategy: CodeServerLaunchStrategy | null;
  phase: CodeServerLifecyclePhase;
  retryable: boolean;
  sanitized?: CodeServerSanitizedDiagnostics;
  stderrTail?: string;
  stdoutTail?: string;
  summary: string;
  watchdogMode?: CodeServerWatchdogMode;
};

type CollectCodeServerStartupDiagnosticsOptions = {
  browserEvents?: CodeServerBrowserDiagnosticEvent[];
  category?: CodeServerDiagnosticCategory;
  checkpoints?: CodeServerReadyCheckpoint[];
  error?: unknown;
  hints?: string[];
  journal?: string;
  launchStrategy?: CodeServerLaunchStrategy | null;
  phase?: CodeServerLifecyclePhase;
  preparationStatus?: CodeServerPreparationStatus | null;
  process?: Pick<CodeServerProcessHandle, "getStderr"|"getStdout">|null;
  retryable?: boolean;
  sanitizer?: CodeServerSanitizerOptions;
  watchdogMode?: CodeServerWatchdogMode;
};

type NormalizedCodeServerStartupFailure = CodeServerStartupDiagnostics& {
  isCodeServerKitError: boolean;
  name: string;
};

export type {
  CodeServerSanitizedDiagnostics,
  CodeServerSanitizerOptions,
  CodeServerStartupDiagnostics,
  CollectCodeServerStartupDiagnosticsOptions,
  NormalizedCodeServerStartupFailure,
};
