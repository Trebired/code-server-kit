import type {
  CodeServerProfileItem,
  CodeServerProfilePersistPolicy,
  CodeServerProfileRestorePolicy,
  CodeServerProfileSignatureMode,
} from "./core.js";
import type { CodeServerReadonlyInput, CodeServerReadonlyPolicy } from "./preparation.js";

type CodeServerProfilePathMap = Record<CodeServerProfileItem, string>;
type CodeServerProfileEntryKind = "directory" | "file";

type CodeServerProfileSyncEntry = {
  item: CodeServerProfileItem;
  kind: CodeServerProfileEntryKind;
  relativePath: string;
  sourcePath: string;
  targetPath: string;
};

type CreateCodeServerProfileSyncPlanOptions = {
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  sourceDir: string;
  targetDir: string;
};

type CodeServerProfileSyncPlan = {
  entries: CodeServerProfileSyncEntry[];
  items: CodeServerProfileItem[];
  sourceDir: string;
  targetDir: string;
};

type CodeServerProfileSkipReason = "missing_source" | "unreadable_source";

type CodeServerProfileSyncResult = {
  changed: boolean;
  copied: CodeServerProfileSyncEntry[];
  skipped: Array<{
    entry: CodeServerProfileSyncEntry;
    reason: CodeServerProfileSkipReason;
  }>;
};

type SyncCodeServerProfileOptions = CreateCodeServerProfileSyncPlanOptions& {
  skipMissing?: boolean;
  skipUnreadable?: boolean;
};

type CodeServerProfileSnapshotEntry = {
  item: CodeServerProfileItem;
  present: boolean;
  signature: string | null;
};

type CodeServerProfileSnapshot = {
  entries: CodeServerProfileSnapshotEntry[];
  rootDir: string;
  signature: string;
};

type ReadCodeServerProfileSnapshotOptions = {
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  rootDir: string;
  snapshotExtensions?: boolean;
};

type ReadCodeServerProfileSignatureOptions = ReadCodeServerProfileSnapshotOptions;

type PersistCodeServerProfileIfChangedOptions = SyncCodeServerProfileOptions& {
  signatureMode?: CodeServerProfileSignatureMode;
  snapshotExtensions?: boolean;
};

type PersistCodeServerProfileIfChangedResult = CodeServerProfileSyncResult& {
  nextSignature: string;
  previousSignature: string | null;
};

type CodeServerProfileLifecycleOptions = {
  debounceMs?: number;
  includeExtensionState?: boolean;
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  persistPolicy?: CodeServerProfilePersistPolicy;
  persistTo?: string;
  restoreFrom?: string;
  restorePolicy?: CodeServerProfileRestorePolicy;
  settingsPatch?: Record<string, unknown>;
  signatureMode?: CodeServerProfileSignatureMode;
  skipMissing?: boolean;
  skipUnreadable?: boolean;
  snapshotExtensions?: boolean;
};

type CodeServerProfilePolicyOptions = CodeServerProfileLifecycleOptions& {
  readonly?: CodeServerReadonlyInput;
};

type CodeServerProfileRestoreResult = {
  restored: boolean;
  runtimeDir: string;
  settingsPatched: boolean;
  skipped: boolean;
  snapshot: CodeServerProfileSnapshot;
  sync: CodeServerProfileSyncResult | null;
};

type CodeServerProfilePersistResult = PersistCodeServerProfileIfChangedResult& {
  persisted: boolean;
  runtimeDir: string;
};

type CodeServerProfilePrepareResult = {
  persistTarget: string | null;
  readonlyDefaultsApplied: boolean;
  restore: CodeServerProfileRestoreResult;
  runtimeDir: string;
};

type CodeServerProfilePolicy = {
  describe(): {
    debounceMs: number;
    hasSettingsPatch: boolean;
    includeExtensionState: boolean;
    items: CodeServerProfileItem[];
    pathMap: CodeServerProfilePathMap;
    persistPolicy: CodeServerProfilePersistPolicy;
    persistTo: string | null;
    readonly: CodeServerReadonlyPolicy;
    restoreFrom: string | null;
    restorePolicy: CodeServerProfileRestorePolicy;
    signatureMode: CodeServerProfileSignatureMode;
    snapshotExtensions: boolean;
  };
  persistRuntimeProfile(runtimeDir: string): Promise<CodeServerProfilePersistResult>;
  prepareRuntimeProfile(runtimeDir: string): Promise<CodeServerProfilePrepareResult>;
  readRuntimeSnapshot(runtimeDir: string): Promise<CodeServerProfileSnapshot>;
  restoreRuntimeProfile(runtimeDir: string): Promise<CodeServerProfileRestoreResult>;
  schedulePersistRuntimeProfile(runtimeDir: string): Promise<CodeServerProfilePersistResult|null>;
};

export type {
  CodeServerProfileEntryKind,
  CodeServerProfileLifecycleOptions,
  CodeServerProfilePathMap,
  CodeServerProfilePersistResult,
  CodeServerProfilePolicy,
  CodeServerProfilePolicyOptions,
  CodeServerProfilePrepareResult,
  CodeServerProfileRestoreResult,
  CodeServerProfileSkipReason,
  CodeServerProfileSnapshot,
  CodeServerProfileSnapshotEntry,
  CodeServerProfileSyncEntry,
  CodeServerProfileSyncPlan,
  CodeServerProfileSyncResult,
  CreateCodeServerProfileSyncPlanOptions,
  PersistCodeServerProfileIfChangedOptions,
  PersistCodeServerProfileIfChangedResult,
  ReadCodeServerProfileSignatureOptions,
  ReadCodeServerProfileSnapshotOptions,
  SyncCodeServerProfileOptions,
};
