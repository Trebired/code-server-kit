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
  "workbench.action.files.save",
  "workbench.action.files.saveAll",
  "workbench.action.files.saveWithoutFormatting",
  "workbench.action.terminal.new",
  "workbench.action.tasks.runTask",
  "workbench.action.debug.start",
  "git.commit",
  "git.push",
  "testing.runAll",
] as const;
const DEFAULT_BLOCKED_COMMAND_PREFIXES = [
  "git.",
  "workbench.action.debug.",
  "workbench.action.tasks.",
  "testing.",
] as const;
const DEFAULT_BLOCKED_COMMAND_SUBSTRINGS = [
  "save",
  "upload",
  "replace",
  "terminal",
  "task",
  "debug",
] as const;
const DEFAULT_BLOCKED_SHORTCUTS = [
  "ctrl+s",
  "meta+s",
  "ctrl+shift+s",
  "meta+shift+s",
  "ctrl+enter",
  "meta+enter",
] as const;
const DEFAULT_BLOCKED_SELECTORS = [
  "[data-command*='save']",
  "[data-command*='upload']",
  "[data-command*='terminal']",
  "[data-command*='debug']",
  "[data-command*='task']",
  "[data-command*='git']",
  "input[type='file']",
] as const;
const DEFAULT_BLOCKED_UI_LABELS = [
  "Save",
  "Save All",
  "Upload",
  "Commit",
  "Push",
  "Terminal",
  "Debug",
  "Run Task",
  "Run Test",
] as const;

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
      blockedSelectors: [...policy.browserGuards.blockedSelectors],
      blockedUiLabels: [...policy.browserGuards.blockedUiLabels],
    },
    blockedCommandIds: [...policy.blockedCommandIds],
    blockedCommandPrefixes: [...policy.blockedCommandPrefixes],
    blockedCommandSubstrings: [...policy.blockedCommandSubstrings],
    blockedShortcuts: [...policy.blockedShortcuts],
    enabled: policy.enabled,
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
    blockDragAndDrop: enabled
      ? normalized?.browserGuards?.blockDragAndDrop ?? true
      : normalized?.browserGuards?.blockDragAndDrop ?? false,
    blockUpload: enabled
      ? normalized?.browserGuards?.blockUpload ?? true
      : normalized?.browserGuards?.blockUpload ?? false,
    blockedSelectors: normalizeStringList(normalized?.browserGuards?.blockedSelectors, enabled ? DEFAULT_BLOCKED_SELECTORS : []),
    blockedUiLabels: normalizeStringList(normalized?.browserGuards?.blockedUiLabels, enabled ? DEFAULT_BLOCKED_UI_LABELS : []),
    readonlyMessage: normalized?.browserGuards?.readonlyMessage?.trim() || DEFAULT_READONLY_MESSAGE,
    showBanner: enabled
      ? normalized?.browserGuards?.showBanner ?? true
      : normalized?.browserGuards?.showBanner ?? false,
  };
}

function resolveReadonlyBlockReason(
  policy: CodeServerReadonlyPolicy,
  action: CodeServerReadonlyBrowserAction,
): string | null {
  if (!policy.enabled) return null;
  if (action.kind === "drop" && policy.browserGuards.blockDragAndDrop) {
    return "drag-and-drop is disabled in readonly sessions";
  }
  if (action.kind === "upload" && policy.browserGuards.blockUpload) {
    return "uploads are disabled in readonly sessions";
  }
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
  const commandId = action.commandId?.trim().toLowerCase();
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

export {
  createReadonlyBrowserPolicy,
  createReadonlySessionPolicy,
  DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
  evaluateReadonlyBrowserAction,
};
