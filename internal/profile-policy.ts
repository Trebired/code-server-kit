import fs from "node:fs";
import path from "node:path";

import { createReadonlyBrowserPolicy } from "./readonly.js";
import {
  DEFAULT_CODE_SERVER_PROFILE_ITEMS,
  persistCodeServerProfileIfChanged,
  readCodeServerProfileSignature,
  readCodeServerProfileSnapshot,
  resolveCodeServerProfilePathMap,
  syncCodeServerProfile,
} from "./profile.js";
import type {
  CodeServerProfileItem,
  CodeServerProfilePersistResult,
  CodeServerProfilePolicy,
  CodeServerProfilePolicyOptions,
  CodeServerProfilePrepareResult,
  CodeServerProfileRestoreResult,
} from "./types.js";

const DEFAULT_PROFILE_DEBOUNCE_MS = 0;
const EXTENSION_STATE_ITEM: CodeServerProfileItem = "globalStorage";

function createCodeServerProfilePolicy(
  options: CodeServerProfilePolicyOptions = {},
): CodeServerProfilePolicy {
  const normalized = normalizeProfilePolicyOptions(options);
  const inflightPersist = new Map<string, Promise<CodeServerProfilePersistResult | null>>();
  const scheduledPersist = new Map<string, Promise<CodeServerProfilePersistResult | null>>();
  const inflightPrepare = new Map<string, Promise<CodeServerProfilePrepareResult>>();

  return {
    describe() {
      return {
        debounceMs: normalized.debounceMs,
        hasSettingsPatch: Object.keys(normalized.settingsPatch).length > 0,
        includeExtensionState: normalized.includeExtensionState,
        items: [...normalized.items],
        pathMap: {
          ...normalized.pathMap,
        },
        persistPolicy: normalized.persistPolicy,
        persistTo: normalized.persistTo,
        readonly: normalized.readonly,
        restoreFrom: normalized.restoreFrom,
        restorePolicy: normalized.restorePolicy,
        signatureMode: normalized.signatureMode,
        snapshotExtensions: normalized.snapshotExtensions,
      };
    },
    async persistRuntimeProfile(runtimeDir) {
      const key = path.resolve(runtimeDir);
      const existing = inflightPersist.get(key);
      if (existing) {
        return await existing;
      }

      const promise = persistRuntimeProfileInternal(key, normalized);
      inflightPersist.set(key, promise);

      try {
        return await promise;
      } finally {
        inflightPersist.delete(key);
      }
    },
    async prepareRuntimeProfile(runtimeDir) {
      const key = path.resolve(runtimeDir);
      const existing = inflightPrepare.get(key);
      if (existing) {
        return await existing;
      }

      const promise = prepareRuntimeProfileInternal(key, normalized);
      inflightPrepare.set(key, promise);

      try {
        return await promise;
      } finally {
        inflightPrepare.delete(key);
      }
    },
    async readRuntimeSnapshot(runtimeDir) {
      return await readCodeServerProfileSnapshot({
        items: normalized.items,
        pathMap: normalized.pathMap,
        rootDir: path.resolve(runtimeDir),
        snapshotExtensions: normalized.snapshotExtensions,
      });
    },
    async restoreRuntimeProfile(runtimeDir) {
      return await restoreRuntimeProfileInternal(path.resolve(runtimeDir), normalized);
    },
    async schedulePersistRuntimeProfile(runtimeDir) {
      const key = path.resolve(runtimeDir);
      const existing = scheduledPersist.get(key);
      if (existing) {
        return await existing;
      }

      const promise = schedulePersistRuntimeProfileInternal(key, normalized, async () => {
        scheduledPersist.delete(key);
        return await this.persistRuntimeProfile(key);
      });
      scheduledPersist.set(key, promise);
      return await promise;
    },
  };
}

async function prepareRuntimeProfileInternal(
  runtimeDir: string,
  policy: ReturnType<typeof normalizeProfilePolicyOptions>,
): Promise<CodeServerProfilePrepareResult> {
  const restore = await restoreRuntimeProfileInternal(runtimeDir, policy);

  return {
    persistTarget: policy.persistTo,
    readonlyDefaultsApplied: policy.readonly.enabled,
    restore,
    runtimeDir,
  };
}

async function restoreRuntimeProfileInternal(
  runtimeDir: string,
  policy: ReturnType<typeof normalizeProfilePolicyOptions>,
): Promise<CodeServerProfileRestoreResult> {
  await fs.promises.mkdir(runtimeDir, { recursive: true });

  let sync = null;
  let restored = false;
  let skipped = false;
  if (policy.restoreFrom) {
    const shouldRestore = await shouldRestoreProfile(runtimeDir, policy);
    if (shouldRestore) {
      sync = await syncCodeServerProfile({
        items: policy.items,
        pathMap: policy.pathMap,
        skipMissing: policy.skipMissing,
        skipUnreadable: policy.skipUnreadable,
        sourceDir: policy.restoreFrom,
        targetDir: runtimeDir,
      });
      restored = sync.changed || sync.copied.length > 0;
    } else {
      skipped = true;
    }
  } else {
    skipped = true;
  }

  const settingsPatched = await applySettingsPatch(runtimeDir, policy.settingsPatch);
  const snapshot = await readCodeServerProfileSnapshot({
    items: policy.items,
    pathMap: policy.pathMap,
    rootDir: runtimeDir,
    snapshotExtensions: policy.snapshotExtensions,
  });

  return {
    restored,
    runtimeDir,
    settingsPatched,
    skipped,
    snapshot,
    sync,
  };
}

async function persistRuntimeProfileInternal(
  runtimeDir: string,
  policy: ReturnType<typeof normalizeProfilePolicyOptions>,
): Promise<CodeServerProfilePersistResult | null> {
  if (!policy.persistTo) {
    return null;
  }

  if (policy.persistPolicy === "always") {
    const sync = await syncCodeServerProfile({
      items: policy.items,
      pathMap: policy.pathMap,
      skipMissing: policy.skipMissing,
      skipUnreadable: policy.skipUnreadable,
      sourceDir: runtimeDir,
      targetDir: policy.persistTo,
    });
    const nextSignature = await safeReadSignature(runtimeDir, policy);
    const previousSignature = await safeReadSignature(policy.persistTo, policy);
    return {
      ...sync,
      nextSignature,
      persisted: sync.changed || sync.copied.length > 0,
      previousSignature,
      runtimeDir,
    };
  }

  const result = await persistCodeServerProfileIfChanged({
    items: policy.items,
    pathMap: policy.pathMap,
    signatureMode: policy.signatureMode,
    skipMissing: policy.skipMissing,
    skipUnreadable: policy.skipUnreadable,
    snapshotExtensions: policy.snapshotExtensions,
    sourceDir: runtimeDir,
    targetDir: policy.persistTo,
  });
  return {
    ...result,
    persisted: result.changed,
    runtimeDir,
  };
}

async function schedulePersistRuntimeProfileInternal(
  runtimeDir: string,
  policy: ReturnType<typeof normalizeProfilePolicyOptions>,
  persist: () => Promise<CodeServerProfilePersistResult | null>,
): Promise<CodeServerProfilePersistResult | null> {
  if (policy.debounceMs <= 0) {
    return await persist();
  }

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void persist().then(resolve, reject);
    }, policy.debounceMs);

    timer.unref?.();
  });
}

async function shouldRestoreProfile(
  runtimeDir: string,
  policy: ReturnType<typeof normalizeProfilePolicyOptions>,
): Promise<boolean> {
  if (policy.restorePolicy === "always") {
    return true;
  }

  const snapshot = await readCodeServerProfileSnapshot({
    items: policy.items,
    pathMap: policy.pathMap,
    rootDir: runtimeDir,
    snapshotExtensions: policy.snapshotExtensions,
  });
  return !snapshot.entries.some((entry) => entry.present);
}

async function applySettingsPatch(runtimeDir: string, patch: Record<string, unknown>): Promise<boolean> {
  if (Object.keys(patch).length === 0) {
    return false;
  }

  const settingsPath = path.join(runtimeDir, "User", "settings.json");
  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  let current: Record<string, unknown> = {};

  try {
    current = JSON.parse(await fs.promises.readFile(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
  }

  const next = {
    ...current,
    ...patch,
  };

  if (JSON.stringify(current) === JSON.stringify(next)) {
    return false;
  }

  await fs.promises.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return true;
}

function normalizeProfilePolicyOptions(options: CodeServerProfilePolicyOptions) {
  const readonly = createReadonlyBrowserPolicy(options.readonly);
  const items = normalizeProfileItems(options.items, options.includeExtensionState ?? false);
  const pathMap = resolveCodeServerProfilePathMap(options.pathMap);
  const settingsPatch = {
    ...(readonly.enabled ? readonly.settingsPatch : {}),
    ...(options.settingsPatch ?? {}),
  };

  return {
    debounceMs: normalizeDebounce(options.debounceMs),
    includeExtensionState: options.includeExtensionState ?? false,
    items,
    pathMap,
    persistPolicy: options.persistPolicy ?? "if-changed",
    persistTo: options.persistTo ? path.resolve(options.persistTo) : null,
    readonly,
    restoreFrom: options.restoreFrom ? path.resolve(options.restoreFrom) : null,
    restorePolicy: options.restorePolicy ?? "if-missing-or-empty",
    settingsPatch,
    signatureMode: options.signatureMode ?? "content-hash",
    skipMissing: options.skipMissing ?? true,
    skipUnreadable: options.skipUnreadable ?? true,
    snapshotExtensions: options.snapshotExtensions ?? false,
  };
}

function normalizeProfileItems(
  items: CodeServerProfileItem[] | undefined,
  includeExtensionState: boolean,
): CodeServerProfileItem[] {
  const normalized: CodeServerProfileItem[] = [];
  for (const item of items ?? DEFAULT_CODE_SERVER_PROFILE_ITEMS) {
    if (!normalized.includes(item)) {
      normalized.push(item);
    }
  }

  if (includeExtensionState && !normalized.includes(EXTENSION_STATE_ITEM)) {
    normalized.push(EXTENSION_STATE_ITEM);
  }

  return normalized;
}

async function safeReadSignature(
  rootDir: string,
  policy: ReturnType<typeof normalizeProfilePolicyOptions>,
): Promise<string> {
  try {
    return await readCodeServerProfileSignature({
      items: policy.items,
      pathMap: policy.pathMap,
      rootDir,
      snapshotExtensions: policy.snapshotExtensions,
    });
  } catch {
    return "";
  }
}

function normalizeDebounce(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null || value < 0) {
    return DEFAULT_PROFILE_DEBOUNCE_MS;
  }
  return Math.floor(value);
}

export { createCodeServerProfilePolicy };
