import type {
  CodeServerDependencyKind,
  CodeServerEntryKind,
  CodeServerInstallArtifactKind,
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerPathAccessMode,
  CodeServerPreparationState,
  CodeServerReadinessState,
  CodeServerReadonlyPolicyMode,
  CodeServerRepairOutcome,
  CodeServerWatchdogMode,
} from "./core.js";
import type { CodeServerStartupDiagnostics } from "./diagnostics.js";

type CodeServerPreparationIssue = {
  code: string;
  details: Record<string, unknown>;
  message: string;
};

type CodeServerRuntimeDependencyIssue = CodeServerPreparationIssue & {
  dependency: string;
  fatal: boolean;
};

type CodeServerInstallArtifactCheck = {
  kind: CodeServerInstallArtifactKind;
  label: string;
  path: string;
  present: boolean;
  runtimeCritical: boolean;
};

type CodeServerDependencyCheck = {
  dependency: string;
  details: Record<string, unknown>;
  fatal: boolean;
  kind: CodeServerDependencyKind;
  message: string;
  present: boolean;
};

type CodeServerReadinessStatus = {
  artifacts: CodeServerInstallArtifactCheck[];
  checkedAt: string;
  dependencies: CodeServerDependencyCheck[];
  entryPoint: string | null;
  issues: CodeServerPreparationIssue[];
  launchable: boolean;
  missingCriticalArtifacts: string[];
  packageRoot: string;
  postinstallScriptPath: string | null;
  state: CodeServerReadinessState;
  supportRoot: string | null;
  watchdogMode: CodeServerWatchdogMode;
};

type CodeServerPreparationStatus = {
  artifacts: CodeServerInstallArtifactCheck[];
  checkedAt: string;
  issues: CodeServerPreparationIssue[];
  launchable: boolean;
  packageRoot: string;
  postinstallScriptPath: string | null;
  readiness: CodeServerReadinessStatus;
  state: CodeServerPreparationState;
  supportRoot: string | null;
  watchdogIssue: CodeServerRuntimeDependencyIssue | null;
  watchdogMode: CodeServerWatchdogMode;
};

type CodeServerRepairAction = {
  changed: boolean;
  command: string;
  details: Record<string, unknown>;
  label: string;
  output: string;
  succeeded: boolean;
};

type CodeServerPreparationResult = {
  actions: CodeServerRepairAction[];
  changed: boolean;
  command: string | null;
  output: string | null;
  outcome: CodeServerRepairOutcome;
  status: CodeServerPreparationStatus;
};

type CodeServerPreparationOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  resolveFrom?: string;
  strictWatchdog?: boolean;
};

type CodeServerInstallValidationResult = {
  diagnostic: CodeServerStartupDiagnostics | null;
  ok: boolean;
  status: CodeServerReadinessStatus;
};

type CodeServerRepairOptions = CodeServerPreparationOptions & {
  preferPackageManagerCommand?: boolean;
};

type CodeServerRepairResult = {
  actions: CodeServerRepairAction[];
  changed: boolean;
  diagnostic: CodeServerStartupDiagnostics | null;
  outcome: CodeServerRepairOutcome;
  statusAfter: CodeServerReadinessStatus;
  statusBefore: CodeServerReadinessStatus;
};

type CodeServerEnsureLaunchableOptions = CodeServerRepairOptions & {
  attemptRepair?: boolean;
};

type CodeServerEnsureLaunchableResult = {
  diagnostic: CodeServerStartupDiagnostics | null;
  repaired: CodeServerRepairResult | null;
  status: CodeServerReadinessStatus;
};

type CodeServerPackageManagerHints = {
  installCommand: string;
  packageManager: "npm" | "unknown";
};

type CodeServerPathBinding = {
  access: CodeServerPathAccessMode;
  hostPath: string;
  mountPath: string;
  reason: string;
};

type CodeServerTranslatedPath = {
  hostPath: string;
  visiblePath: string;
};

type CodeServerReadonlyPolicyOptions = {
  browserGuards?: {
    blockDragAndDrop?: boolean;
    blockUpload?: boolean;
    blockedSelectors?: string[];
    blockedUiLabels?: string[];
    readonlyMessage?: string;
    showBanner?: boolean;
  };
  blockedCommandIds?: string[];
  blockedCommandPrefixes?: string[];
  blockedCommandSubstrings?: string[];
  blockedShortcuts?: string[];
  enabled?: boolean;
  mode?: CodeServerReadonlyPolicyMode;
  settingsPatch?: Record<string, unknown>;
};

type CodeServerReadonlyPolicy = {
  browserGuards: {
    blockDragAndDrop: boolean;
    blockUpload: boolean;
    blockedSelectors: string[];
    blockedUiLabels: string[];
    readonlyMessage: string;
    showBanner: boolean;
  };
  blockedCommandIds: string[];
  blockedCommandPrefixes: string[];
  blockedCommandSubstrings: string[];
  blockedShortcuts: string[];
  enabled: boolean;
  mode: CodeServerReadonlyPolicyMode;
  settingsPatch: Record<string, unknown>;
};

type CodeServerReadonlyInput =
  | boolean
  | CodeServerReadonlyPolicy
  | CodeServerReadonlyPolicyOptions;

type CodeServerSandboxPlan = {
  bindings: CodeServerPathBinding[];
  collisionSafeName: string | null;
  ephemeralStateRoot: string | null;
  readablePaths: string[];
  readonly: CodeServerReadonlyPolicy;
  sessionRoot: string | null;
  supportMountTargets: string[];
  writablePaths: string[];
};

type CodeServerInstallation = {
  defaultCwd: string;
  defaultEnv: NodeJS.ProcessEnv;
  entryArgs: string[];
  entryCommand: string;
  entryKind: CodeServerEntryKind;
  entryPoint: string;
  entryRelativePath: string;
  packageJsonPath: string;
  packageManagerHints: CodeServerPackageManagerHints;
  packageRoot: string;
  preparationStatus: CodeServerPreparationStatus;
  readinessStatus: CodeServerReadinessStatus;
  recommendedReadablePaths: string[];
  supportBindings: CodeServerPathBinding[];
  supportRoot: string | null;
  version?: string;
};

type ResolveCodeServerInstallationOptions = {
  resolveFrom?: string;
  strictWatchdog?: boolean;
};

export type {
  CodeServerDependencyCheck,
  CodeServerEnsureLaunchableOptions,
  CodeServerEnsureLaunchableResult,
  CodeServerInstallArtifactCheck,
  CodeServerInstallation,
  CodeServerInstallValidationResult,
  CodeServerPackageManagerHints,
  CodeServerPathBinding,
  CodeServerPreparationIssue,
  CodeServerPreparationOptions,
  CodeServerPreparationResult,
  CodeServerPreparationStatus,
  CodeServerReadinessStatus,
  CodeServerReadonlyInput,
  CodeServerReadonlyPolicy,
  CodeServerReadonlyPolicyOptions,
  CodeServerRepairAction,
  CodeServerRepairOptions,
  CodeServerRepairResult,
  CodeServerRuntimeDependencyIssue,
  CodeServerSandboxPlan,
  CodeServerTranslatedPath,
  ResolveCodeServerInstallationOptions,
};
