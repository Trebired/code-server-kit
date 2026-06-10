import fs from "node:fs";
import path from "node:path";

import type {
  CodeServerProfileItem,
  CodeServerProfilePathMap,
  CodeServerProfileSyncEntry,
  CodeServerProfileSyncPlan,
  CodeServerProfileSyncResult,
  CreateCodeServerProfileSyncPlanOptions,
  SyncCodeServerProfileOptions,
} from "./types.js";

const DEFAULT_CODE_SERVER_PROFILE_PATHS: CodeServerProfilePathMap = {
  "extensions": "extensions",
  "extensions.json": "User/extensions.json",
  "keybindings.json": "User/keybindings.json",
  "settings.json": "User/settings.json",
  "snippets": "User/snippets",
};

const DEFAULT_CODE_SERVER_PROFILE_ITEMS: CodeServerProfileItem[] = [
  "settings.json",
  "extensions.json",
  "keybindings.json",
  "snippets",
  "extensions",
];

function createCodeServerProfileSyncPlan(options: CreateCodeServerProfileSyncPlanOptions): CodeServerProfileSyncPlan {
  const sourceDir = path.resolve(options.sourceDir);
  const targetDir = path.resolve(options.targetDir);
  const items = normalizeProfileItems(options.items);
  const pathMap = resolveProfilePathMap(options.pathMap);

  return {
    entries: items.map((item) => createProfileSyncEntry(item, sourceDir, targetDir, pathMap[item])),
    items,
    sourceDir,
    targetDir,
  };
}

async function syncCodeServerProfile(options: SyncCodeServerProfileOptions): Promise<CodeServerProfileSyncResult> {
  const plan = createCodeServerProfileSyncPlan(options);
  const copied: CodeServerProfileSyncEntry[] = [];
  const skipped: CodeServerProfileSyncResult["skipped"] = [];
  const skipMissing = options.skipMissing ?? true;
  const skipUnreadable = options.skipUnreadable ?? true;

  for (const entry of plan.entries) {
    try {
      await fs.promises.mkdir(path.dirname(entry.targetPath), { recursive: true });
      await fs.promises.cp(entry.sourcePath, entry.targetPath, {
        force: true,
        recursive: entry.kind === "directory",
      });
      copied.push(entry);
    } catch (error) {
      if (isMissingError(error) && skipMissing) {
        skipped.push({
          entry,
          reason: "missing_source",
        });
        continue;
      }

      if (isUnreadableError(error) && skipUnreadable) {
        skipped.push({
          entry,
          reason: "unreadable_source",
        });
        continue;
      }

      throw error;
    }
  }

  return {
    copied,
    skipped,
  };
}

function resolveCodeServerProfilePathMap(overrides?: Partial<CodeServerProfilePathMap>): CodeServerProfilePathMap {
  return resolveProfilePathMap(overrides);
}

function normalizeProfileItems(items?: CodeServerProfileItem[]): CodeServerProfileItem[] {
  const normalized: CodeServerProfileItem[] = [];

  for (const item of items ?? DEFAULT_CODE_SERVER_PROFILE_ITEMS) {
    if (!normalized.includes(item)) {
      normalized.push(item);
    }
  }

  return normalized;
}

function resolveProfilePathMap(overrides?: Partial<CodeServerProfilePathMap>): CodeServerProfilePathMap {
  return {
    ...DEFAULT_CODE_SERVER_PROFILE_PATHS,
    ...(overrides ?? {}),
  };
}

function createProfileSyncEntry(
  item: CodeServerProfileItem,
  sourceDir: string,
  targetDir: string,
  relativePath: string,
): CodeServerProfileSyncEntry {
  const kind = item === "snippets" || item === "extensions"
    ? "directory"
    : "file";

  return {
    item,
    kind,
    relativePath,
    sourcePath: path.join(sourceDir, relativePath),
    targetPath: path.join(targetDir, relativePath),
  };
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && String(error.code) === "ENOENT";
}

function isUnreadableError(error: unknown): boolean {
  if (typeof error !== "object" || error == null || !("code" in error)) return false;
  const code = String(error.code);
  return code === "EACCES" || code === "EPERM";
}

export {
  DEFAULT_CODE_SERVER_PROFILE_ITEMS,
  DEFAULT_CODE_SERVER_PROFILE_PATHS,
  createCodeServerProfileSyncPlan,
  resolveCodeServerProfilePathMap,
  syncCodeServerProfile,
};
