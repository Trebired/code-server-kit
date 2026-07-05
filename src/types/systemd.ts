import type { ResultLike } from "@trebired/result";
import type {
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerSystemdScope,
} from "./core.js";
import type { CodeServerLaunchPlan } from "./launch.js";
import type { CodeServerStartupDiagnostics } from "./diagnostics.js";

type CodeServerSystemdOptions = {
  extraProperties?: string[];
  scope?: CodeServerSystemdScope;
  unitName?: string;
};

type CodeServerSystemdLaunchOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  extraProperties?: string[];
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  plan: CodeServerLaunchPlan;
  scope: CodeServerSystemdScope;
  sessionKey?: string;
  unitName?: string;
};

type CodeServerSystemdLaunchCommand = {
  args: string[];
  command: string;
  scope: CodeServerSystemdScope;
  unitName: string;
};

type CodeServerSystemdLaunchResult = CodeServerSystemdLaunchCommand & {
  output: string;
  backendResult?: ResultLike<{
    scope: CodeServerSystemdScope;
    unitName: string;
  }>;
};

type CodeServerSystemdStatus = {
  activeState: string | null;
  execMainPid: number | null;
  failed: boolean;
  loadState: string | null;
  notFound: boolean;
  raw: Record<string, string>;
  reusable: boolean;
  result: string | null;
  scope: CodeServerSystemdScope;
  stateLabel: "failed" | "not_found" | "ready" | "stale";
  subState: string | null;
  unitName: string;
  backendResult?: ResultLike<{
    reusable: boolean;
    stateLabel: "failed" | "not_found" | "ready" | "stale";
  }>;
};

type CodeServerSystemdJournalOptions = {
  lines?: number;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  scope: CodeServerSystemdScope;
  unitName: string;
};

type CodeServerSystemdStopOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  resetFailed?: boolean;
  scope: CodeServerSystemdScope;
  unitName: string;
};

type CodeServerSystemdFailure = {
  diagnostics: CodeServerStartupDiagnostics;
  summary: string;
  backendResult?: ResultLike<null, {
    summary: string;
  }>;
};

export type {
  CodeServerSystemdFailure,
  CodeServerSystemdJournalOptions,
  CodeServerSystemdLaunchCommand,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdLaunchResult,
  CodeServerSystemdOptions,
  CodeServerSystemdStatus,
  CodeServerSystemdStopOptions,
};
