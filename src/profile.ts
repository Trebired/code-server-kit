import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type {
  CodeServerProfileItem,
  CodeServerProfilePathMap,
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
} from "./types.js";

const DEFAULT_CODE_SERVER_PROFILE_PATHS: CodeServerProfilePathMap = {
  "extensions": "extensions",
  "extensions.json": "User/extensions.json",
  "globalStorage": "User/globalStorage",
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
  let changed = false;

  for (const entry of plan.entries) {
    try {
      await fs.promises.mkdir(path.dirname(entry.targetPath), { recursive: true });
      await fs.promises.cp(entry.sourcePath, entry.targetPath, {
        force: true,
        recursive: entry.kind === "directory",
      });
      copied.push(entry);
      changed = true;
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
    changed,
    copied,
    skipped,
  };
}

async function readCodeServerProfileSnapshot(options: ReadCodeServerProfileSnapshotOptions): Promise<CodeServerProfileSnapshot> {
  const rootDir = path.resolve(options.rootDir);
  const items = normalizeProfileItems(options.items);
  const pathMap = resolveProfilePathMap(options.pathMap);
  const entries: CodeServerProfileSnapshotEntry[] = [];

  for (const item of items) {
    const targetPath = path.join(rootDir, pathMap[item]);
    entries.push({
      item,
      present: exists(targetPath),
      signature: await readEntrySignature(targetPath),
    });
  }

  if (options.snapshotExtensions && !entries.some((value) => value.item === "extensions")) {
    const targetPath = path.join(rootDir, pathMap.extensions);
    entries.push({
      item: "extensions",
      present: exists(targetPath),
      signature: await readEntrySignature(targetPath),
    });
  }

  return {
    entries,
    rootDir,
    signature: hashJson(entries),
  };
}

async function readCodeServerProfileSignature(options: ReadCodeServerProfileSignatureOptions): Promise<string> {
  const snapshot = await readCodeServerProfileSnapshot(options);
  return snapshot.signature;
}

async function persistCodeServerProfileIfChanged(
  options: PersistCodeServerProfileIfChangedOptions,
): Promise<PersistCodeServerProfileIfChangedResult> {
  const previousSignature = await safeReadSignature({
    items: options.items,
    pathMap: options.pathMap,
    rootDir: options.targetDir,
    snapshotExtensions: options.snapshotExtensions,
  });
  const nextSignature = await readCodeServerProfileSignature({
    items: options.items,
    pathMap: options.pathMap,
    rootDir: options.sourceDir,
    snapshotExtensions: options.snapshotExtensions,
  });

  if (previousSignature && previousSignature === nextSignature) {
    return {
      changed: false,
      copied: [],
      nextSignature,
      previousSignature,
      skipped: [],
    };
  }

  const result = await syncCodeServerProfile(options);
  return {
    ...result,
    nextSignature,
    previousSignature,
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
  const kind = item === "snippets" || item === "extensions" || item === "globalStorage"
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

async function readEntrySignature(targetPath: string): Promise<string | null> {
  if (!exists(targetPath)) return null;

  const stats = await fs.promises.stat(targetPath);
  if (stats.isFile()) {
    return createHash("sha256")
      .update(await fs.promises.readFile(targetPath))
      .digest("hex");
  }

  if (!stats.isDirectory()) {
    return null;
  }

  const files = await listFiles(targetPath);
  const hash = createHash("sha256");

  for (const filePath of files) {
    hash.update(path.relative(targetPath, filePath));
    hash.update(await fs.promises.readFile(filePath));
  }

  return hash.digest("hex");
}

async function listFiles(rootDir: string): Promise<string[]> {
  const values: string[] = [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const filePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      values.push(...await listFiles(filePath));
      continue;
    }
    if (entry.isFile()) {
      values.push(filePath);
    }
  }

  return values.sort();
}

async function safeReadSignature(options: ReadCodeServerProfileSignatureOptions): Promise<string | null> {
  try {
    return await readCodeServerProfileSignature(options);
  } catch {
    return null;
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function exists(value: string): boolean {
  try {
    fs.accessSync(value);
    return true;
  } catch {
    return false;
  }
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
  persistCodeServerProfileIfChanged,
  readCodeServerProfileSignature,
  readCodeServerProfileSnapshot,
  resolveCodeServerProfilePathMap,
  syncCodeServerProfile,
};
