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
  if (isReadonlyPolicy(options)) {
    return {
      browserGuards: {
        ...options.browserGuards,
        blockedSelectors: [...options.browserGuards.blockedSelectors],
        blockedUiLabels: [...options.browserGuards.blockedUiLabels],
      },
      blockedCommandIds: [...options.blockedCommandIds],
      blockedCommandPrefixes: [...options.blockedCommandPrefixes],
      blockedCommandSubstrings: [...options.blockedCommandSubstrings],
      blockedShortcuts: [...options.blockedShortcuts],
      enabled: options.enabled,
      mode: options.mode,
      settingsPatch: {
        ...options.settingsPatch,
      },
    };
  }

  const normalized = options && typeof options === "object" ? options : undefined;
  const enabled = options === true || normalized?.enabled === true || normalized?.mode === "readonly" || normalized?.mode === "view";
  const mode = enabled
    ? normalized?.mode && normalized.mode !== "off"
      ? normalized.mode
      : "view"
    : "off";

  return {
    browserGuards: {
      blockDragAndDrop: enabled
        ? normalized?.browserGuards?.blockDragAndDrop ?? true
        : normalized?.browserGuards?.blockDragAndDrop ?? false,
      blockUpload: enabled
        ? normalized?.browserGuards?.blockUpload ?? true
        : normalized?.browserGuards?.blockUpload ?? false,
      blockedSelectors: normalizeStringList(
        normalized?.browserGuards?.blockedSelectors,
        enabled ? DEFAULT_BLOCKED_SELECTORS : [],
      ),
      blockedUiLabels: normalizeStringList(
        normalized?.browserGuards?.blockedUiLabels,
        enabled ? DEFAULT_BLOCKED_UI_LABELS : [],
      ),
      readonlyMessage: normalized?.browserGuards?.readonlyMessage?.trim() || DEFAULT_READONLY_MESSAGE,
      showBanner: enabled
        ? normalized?.browserGuards?.showBanner ?? true
        : normalized?.browserGuards?.showBanner ?? false,
    },
    blockedCommandIds: normalizeStringList(
      normalized?.blockedCommandIds,
      enabled ? DEFAULT_BLOCKED_COMMAND_IDS : [],
    ),
    blockedCommandPrefixes: normalizeStringList(
      normalized?.blockedCommandPrefixes,
      enabled ? DEFAULT_BLOCKED_COMMAND_PREFIXES : [],
    ),
    blockedCommandSubstrings: normalizeStringList(
      normalized?.blockedCommandSubstrings,
      enabled ? DEFAULT_BLOCKED_COMMAND_SUBSTRINGS : [],
    ),
    blockedShortcuts: normalizeStringList(
      normalized?.blockedShortcuts,
      enabled ? DEFAULT_BLOCKED_SHORTCUTS : [],
    ),
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
  if (!policy.enabled) {
    return {
      action,
      blocked: false,
      reason: null,
      summary: "Readonly browser policy is disabled.",
    };
  }

  const commandId = action.commandId?.trim().toLowerCase();
  const shortcut = normalizeShortcut(action.shortcut);
  const label = action.label?.trim().toLowerCase();
  const selector = action.selector?.trim().toLowerCase();

  if (action.kind === "drop" && policy.browserGuards.blockDragAndDrop) {
    return createBlockedResult(action, "drag-and-drop is disabled in readonly sessions");
  }

  if (action.kind === "upload" && policy.browserGuards.blockUpload) {
    return createBlockedResult(action, "uploads are disabled in readonly sessions");
  }

  if (commandId) {
    if (policy.blockedCommandIds.some((entry) => entry.toLowerCase() === commandId)) {
      return createBlockedResult(action, `command "${action.commandId}" is blocked`);
    }

    if (policy.blockedCommandPrefixes.some((entry) => commandId.startsWith(entry.toLowerCase()))) {
      return createBlockedResult(action, `command "${action.commandId}" matches a blocked prefix`);
    }

    if (policy.blockedCommandSubstrings.some((entry) => commandId.includes(entry.toLowerCase()))) {
      return createBlockedResult(action, `command "${action.commandId}" matches a blocked pattern`);
    }
  }

  if (shortcut && policy.blockedShortcuts.some((entry) => normalizeShortcut(entry) === shortcut)) {
    return createBlockedResult(action, `shortcut "${action.shortcut}" is blocked`);
  }

  if (selector && policy.browserGuards.blockedSelectors.some((entry) => selector.includes(entry.toLowerCase()))) {
    return createBlockedResult(action, `selector "${action.selector}" matches a blocked UI target`);
  }

  if (label && policy.browserGuards.blockedUiLabels.some((entry) => label.includes(entry.toLowerCase()))) {
    return createBlockedResult(action, `label "${action.label}" matches a blocked UI label`);
  }

  return {
    action,
    blocked: false,
    reason: null,
    summary: "Readonly browser policy allows this action.",
  };
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
