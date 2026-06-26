import type {
  CodeServerReadonlyBrowserAction,
  CodeServerReadonlyBrowserBlockResult,
  CodeServerReadonlyInput,
  CodeServerReadonlyPolicy,
} from "./types.js";

const DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH = {
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "update.mode": "none",
  "workbench.startupEditor": "none",
} as const;

const DEFAULT_READONLY_MESSAGE = "This is a readonly session.";
const DEFAULT_BLOCKED_COMMAND_IDS = [
  "editor.action.formatDocument",
  "editor.action.formatSelection",
  "editor.action.rename",
  "git.commit",
  "git.commitAll",
  "git.push",
  "scm.acceptInput",
  "testing.runAll",
  "workbench.action.debug.start",
  "workbench.action.files.save",
  "workbench.action.files.saveAll",
  "workbench.action.files.saveWithoutFormatting",
  "workbench.action.files.setActiveEditorWriteableInSession",
  "workbench.action.files.toggleActiveEditorReadonlyInSession",
  "workbench.action.terminal.new",
  "workbench.action.tasks.runTask",
] as const;
const DEFAULT_BLOCKED_COMMAND_PREFIXES = [
  "editor.action.refactor",
  "git.",
  "scm.",
  "testing.",
  "workbench.action.debug.",
  "workbench.action.files.",
  "workbench.action.tasks.",
  "workbench.action.terminal.",
  "workbench.files.action.",
  "workspace.execute",
  "workspace.apply",
  "vscode.execute",
  "vscode.openfolder",
  "vscode.open",
  "vscode.diff",
  "vscode.changes",
  "_workbench.download",
] as const;
const DEFAULT_BLOCKED_COMMAND_SUBSTRINGS = [
  "commit",
  "debug",
  "delete",
  "download",
  "format",
  "move",
  "readonly",
  "refactor",
  "rename",
  "replace",
  "save",
  "scm",
  "sourcecontrol",
  "stage",
  "task",
  "terminal",
  "trash",
  "upload",
  "writable",
  "writeable",
] as const;
const DEFAULT_BLOCKED_SHORTCUTS = [
  "ctrl+s",
  "meta+s",
  "ctrl+shift+s",
  "meta+shift+s",
  "ctrl+enter",
  "meta+enter",
  "f2",
] as const;
const DEFAULT_BLOCKED_SELECTORS = [
  "[data-command*='debug']",
  "[data-command*='git']",
  "[data-command*='rename']",
  "[data-command*='save']",
  "[data-command*='task']",
  "[data-command*='terminal']",
  "[data-command*='upload']",
  "[data-command*='writable']",
  "[data-command*='writeable']",
  "[data-href^='command:']",
  "a[href^='command:']",
  "input[type='file']",
] as const;
const DEFAULT_BLOCKED_UI_LABELS = [
  "Commit",
  "Debug",
  "Format",
  "Make Writable",
  "Push",
  "Refactor",
  "Rename",
  "Run Task",
  "Run Test",
  "Save",
  "Save All",
  "Set Writable Anyway",
  "Source Control",
  "Stage",
  "Terminal",
  "Upload",
  "Writable",
] as const;
const DEFAULT_BLOCKED_COMMAND_LINK_SCHEMES = ["command"] as const;
const WRITABLE_SESSION_PROMOTION_SUBSTRINGS = ["readonly", "writable", "writeable"] as const;

function createReadonlySessionPolicy(options?: CodeServerReadonlyInput): CodeServerReadonlyPolicy {
  return createReadonlyBrowserPolicy(options);
}

function createReadonlyBrowserPolicy(options?: CodeServerReadonlyInput): CodeServerReadonlyPolicy {
  if (isReadonlyPolicy(options)) return cloneReadonlyPolicy(options);
  return createReadonlyPolicyFromInput(options);
}

function isReadonlyPolicy(value: CodeServerReadonlyInput | undefined): value is CodeServerReadonlyPolicy {
  return Boolean(value)
    && typeof value === "object"
    && "filesystem" in value
    && "settingsPatch" in value
    && "blockedShortcuts" in value
    && "browserGuards" in value;
}

function evaluateReadonlyBrowserAction(
  policy: CodeServerReadonlyPolicy,
  action: CodeServerReadonlyBrowserAction,
): CodeServerReadonlyBrowserBlockResult {
  const reason = resolveReadonlyBlockReason(policy, action);
  return reason
    ? createBlockedResult(action, reason)
    : {
      action,
      blocked: false,
      reason: null,
      summary: policy.enabled
        ? "Readonly browser policy allows this action."
        : "Readonly browser policy is disabled.",
    };
}

function cloneReadonlyPolicy(policy: CodeServerReadonlyPolicy): CodeServerReadonlyPolicy {
  return {
    browserGuards: {
      ...policy.browserGuards,
      blockedCommandLinkSchemes: [...policy.browserGuards.blockedCommandLinkSchemes],
      blockedSelectors: [...policy.browserGuards.blockedSelectors],
      blockedUiLabels: [...policy.browserGuards.blockedUiLabels],
    },
    blockedCommandIds: [...policy.blockedCommandIds],
    blockedCommandPrefixes: [...policy.blockedCommandPrefixes],
    blockedCommandSubstrings: [...policy.blockedCommandSubstrings],
    blockedShortcuts: [...policy.blockedShortcuts],
    enabled: policy.enabled,
    filesystem: {
      ...policy.filesystem,
      extraWritablePaths: [...policy.filesystem.extraWritablePaths],
    },
    mode: policy.mode,
    settingsPatch: {
      ...policy.settingsPatch,
    },
  };
}

function createReadonlyPolicyFromInput(options?: CodeServerReadonlyInput): CodeServerReadonlyPolicy {
  const normalized = options && typeof options === "object" ? options : undefined;
  const enabled = isReadonlyEnabled(options, normalized);
  const mode = enabled && normalized?.mode && normalized.mode !== "off"
    ? normalized.mode
    : enabled
      ? "view"
      : "off";

  return {
    browserGuards: createReadonlyBrowserGuards(enabled, normalized),
    blockedCommandIds: normalizeStringList(normalized?.blockedCommandIds, enabled ? DEFAULT_BLOCKED_COMMAND_IDS : []),
    blockedCommandPrefixes: normalizeStringList(normalized?.blockedCommandPrefixes, enabled ? DEFAULT_BLOCKED_COMMAND_PREFIXES : []),
    blockedCommandSubstrings: normalizeStringList(normalized?.blockedCommandSubstrings, enabled ? DEFAULT_BLOCKED_COMMAND_SUBSTRINGS : []),
    blockedShortcuts: normalizeStringList(normalized?.blockedShortcuts, enabled ? DEFAULT_BLOCKED_SHORTCUTS : []),
    enabled,
    filesystem: createReadonlyFilesystemPolicy(enabled, normalized),
    mode,
    settingsPatch: enabled
      ? {
        ...DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
        ...(normalized?.settingsPatch ?? {}),
      }
      : {},
  };
}

function isReadonlyEnabled(
  options: CodeServerReadonlyInput | undefined,
  normalized: Exclude<CodeServerReadonlyInput, boolean | CodeServerReadonlyPolicy> | undefined,
): boolean {
  return options === true || normalized?.enabled === true || normalized?.mode === "readonly" || normalized?.mode === "view";
}

function createReadonlyBrowserGuards(
  enabled: boolean,
  normalized: Exclude<CodeServerReadonlyInput, boolean | CodeServerReadonlyPolicy> | undefined,
) {
  return {
    blockBeforeInput: enabled
      ? normalized?.browserGuards?.blockBeforeInput ?? false
      : normalized?.browserGuards?.blockBeforeInput ?? false,
    blockCommandLinks: enabled
      ? normalized?.browserGuards?.blockCommandLinks ?? true
      : normalized?.browserGuards?.blockCommandLinks ?? false,
    blockDragAndDrop: enabled
      ? normalized?.browserGuards?.blockDragAndDrop ?? true
      : normalized?.browserGuards?.blockDragAndDrop ?? false,
    blockPaste: enabled
      ? normalized?.browserGuards?.blockPaste ?? false
      : normalized?.browserGuards?.blockPaste ?? false,
    blockUpload: enabled
      ? normalized?.browserGuards?.blockUpload ?? true
      : normalized?.browserGuards?.blockUpload ?? false,
    blockedCommandLinkSchemes: normalizeStringList(
      normalized?.browserGuards?.blockedCommandLinkSchemes,
      enabled ? DEFAULT_BLOCKED_COMMAND_LINK_SCHEMES : [],
    ),
    blockedSelectors: normalizeStringList(normalized?.browserGuards?.blockedSelectors, enabled ? DEFAULT_BLOCKED_SELECTORS : []),
    blockedUiLabels: normalizeStringList(normalized?.browserGuards?.blockedUiLabels, enabled ? DEFAULT_BLOCKED_UI_LABELS : []),
    readonlyMessage: normalized?.browserGuards?.readonlyMessage?.trim() || DEFAULT_READONLY_MESSAGE,
    showBanner: enabled
      ? normalized?.browserGuards?.showBanner ?? true
      : normalized?.browserGuards?.showBanner ?? false,
  };
}

function createReadonlyFilesystemPolicy(
  enabled: boolean,
  normalized: Exclude<CodeServerReadonlyInput, boolean | CodeServerReadonlyPolicy> | undefined,
) {
  return {
    allowHostTempDir: enabled
      ? normalized?.filesystem?.allowHostTempDir ?? false
      : normalized?.filesystem?.allowHostTempDir ?? false,
    extraWritablePaths: normalizeStringList(normalized?.filesystem?.extraWritablePaths, []),
    mode: enabled
      ? normalized?.filesystem?.mode ?? "auto"
      : normalized?.filesystem?.mode ?? "off",
  } as const;
}

function resolveReadonlyBlockReason(
  policy: CodeServerReadonlyPolicy,
  action: CodeServerReadonlyBrowserAction,
): string | null {
  if (!policy.enabled) return null;
  if (action.kind === "beforeinput" && policy.browserGuards.blockBeforeInput) {
    return "editor input mutations are disabled in readonly sessions";
  }
  if (action.kind === "drop" && policy.browserGuards.blockDragAndDrop) {
    return "drag-and-drop is disabled in readonly sessions";
  }
  if (action.kind === "paste" && policy.browserGuards.blockPaste) {
    return "paste is disabled in readonly sessions";
  }
  if (action.kind === "upload" && policy.browserGuards.blockUpload) {
    return "uploads are disabled in readonly sessions";
  }

  const commandUriReason = resolveReadonlyCommandUriBlockReason(policy, action);
  if (commandUriReason) return commandUriReason;
  return resolveReadonlyTextBlockReason(policy, action);
}

function resolveReadonlyTextBlockReason(
  policy: CodeServerReadonlyPolicy,
  action: CodeServerReadonlyBrowserAction,
): string | null {
  const commandReason = resolveReadonlyCommandBlockReason(policy, action);
  if (commandReason) return commandReason;

  const shortcut = normalizeShortcut(action.shortcut);
  if (shortcut && policy.blockedShortcuts.some((entry) => normalizeShortcut(entry) === shortcut)) {
    return `shortcut "${action.shortcut}" is blocked`;
  }

  const selector = action.selector?.trim().toLowerCase();
  if (selector && policy.browserGuards.blockedSelectors.some((entry) => selector.includes(entry.toLowerCase()))) {
    return `selector "${action.selector}" matches a blocked UI target`;
  }

  const label = action.label?.trim().toLowerCase();
  if (label && policy.browserGuards.blockedUiLabels.some((entry) => label.includes(entry.toLowerCase()))) {
    return `label "${action.label}" matches a blocked UI label`;
  }

  return null;
}

function resolveReadonlyCommandBlockReason(
  policy: CodeServerReadonlyPolicy,
  action: CodeServerReadonlyBrowserAction,
): string | null {
  const commandId = normalizeCommandId(action.commandId);
  if (!commandId) return null;
  if (policy.blockedCommandIds.some((entry) => entry.toLowerCase() === commandId)) {
    return `command "${action.commandId}" is blocked`;
  }
  if (policy.blockedCommandPrefixes.some((entry) => commandId.startsWith(entry.toLowerCase()))) {
    return `command "${action.commandId}" matches a blocked prefix`;
  }
  if (policy.blockedCommandSubstrings.some((entry) => commandId.includes(entry.toLowerCase()))) {
    return `command "${action.commandId}" matches a blocked pattern`;
  }
  return null;
}

function resolveReadonlyCommandUriBlockReason(
  policy: CodeServerReadonlyPolicy,
  action: CodeServerReadonlyBrowserAction,
): string | null {
  const commandUri = normalizeCommandUri(action.commandUri ?? action.href);
  if (!commandUri) return null;

  const parsed = parseReadonlyCommandUri(commandUri);
  if (!parsed) return null;
  if (!policy.browserGuards.blockedCommandLinkSchemes.some((entry) => entry.toLowerCase() === parsed.scheme)) {
    return null;
  }

  const commandReason = parsed.commandId
    ? resolveReadonlyCommandBlockReason(policy, {
      ...action,
      commandId: parsed.commandId,
    })
    : null;

  if (commandReason) {
    return `command URI "${commandUri}" ${commandReason.replace(/^command /, "activates command ")}`;
  }

  if (policy.browserGuards.blockCommandLinks) {
    return parsed.commandId
      ? `command URI "${commandUri}" is blocked`
      : `command link scheme "${parsed.scheme}:" is blocked`;
  }

  return null;
}

function parseReadonlyCommandUri(value: string): {
  commandId: string | null;
  scheme: string;
} | null {
  const match = /^([a-z0-9+.-]+):(.*)$/i.exec(value);
  if (!match) return null;

  const scheme = match[1].toLowerCase();
  let commandId: string | null = null;
  if (scheme === "command") {
    const rawCommand = match[2].replace(/^\/\//, "").split("?")[0] ?? "";
    commandId = normalizeCommandId(decodeReadonlyUriComponent(rawCommand));
  }

  return { commandId, scheme };
}

function createBlockedResult(
  action: CodeServerReadonlyBrowserAction,
  reason: string,
): CodeServerReadonlyBrowserBlockResult {
  return {
    action,
    blocked: true,
    reason,
    summary: `Readonly browser policy blocked ${action.kind}.`,
  };
}

function normalizeStringList(values: readonly string[] | undefined, fallback: readonly string[]): string[] {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (normalized.length > 0) {
    return [...new Set(normalized)];
  }
  return [...fallback];
}

function normalizeShortcut(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .split("command").join("meta")
    .split("cmd").join("meta")
    .split("control").join("ctrl")
    .replace(/\s+/g, "");

  return normalized || null;
}

function decodeReadonlyUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeCommandId(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeCommandUri(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function isWritableSessionPromotionCommand(commandId: string): boolean {
  return WRITABLE_SESSION_PROMOTION_SUBSTRINGS.every((entry) => commandId.includes(entry))
    || commandId.includes("setactiveeditorwriteableinsession")
    || commandId.includes("setactiveeditorwritableinsession")
    || commandId.includes("toggleactiveeditorreadonlyinsession")
    || commandId.includes("resetactiveeditorreadonlyinsession");
}

function readonlyPolicyBlocksWritableSessionPromotions(policy: CodeServerReadonlyPolicy): boolean {
  return policy.blockedCommandIds.some((entry) => isWritableSessionPromotionCommand(entry.toLowerCase()))
    || policy.blockedCommandPrefixes.some((entry) => isWritableSessionPromotionCommand(entry.toLowerCase()))
    || policy.blockedCommandSubstrings.some((entry) => WRITABLE_SESSION_PROMOTION_SUBSTRINGS.includes(entry.toLowerCase() as typeof WRITABLE_SESSION_PROMOTION_SUBSTRINGS[number]));
}

export {
  createReadonlyBrowserPolicy,
  createReadonlySessionPolicy,
  DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
  evaluateReadonlyBrowserAction,
  readonlyPolicyBlocksWritableSessionPromotions,
};
