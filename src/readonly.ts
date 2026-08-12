import type {
  CodeServerReadonlyInput,
  CodeServerReadonlyPolicy,
} from "./types.js";
import {
  DEFAULT_BLOCKED_COMMAND_IDS,
  DEFAULT_BLOCKED_COMMAND_LINK_SCHEMES,
  DEFAULT_BLOCKED_COMMAND_PREFIXES,
  DEFAULT_BLOCKED_COMMAND_SUBSTRINGS,
  DEFAULT_BLOCKED_SELECTORS,
  DEFAULT_BLOCKED_SHORTCUTS,
  DEFAULT_BLOCKED_UI_LABELS,
  DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
  DEFAULT_READONLY_MESSAGE,
} from "./readonly/defaults.js";
import {
  evaluateReadonlyBrowserAction,
  readonlyPolicyBlocksWritableSessionPromotions,
} from "./readonly/evaluate.js";

function createReadonlySessionPolicy(
  options?: CodeServerReadonlyInput,
): CodeServerReadonlyPolicy {
  return createReadonlyBrowserPolicy(options);
}

function createReadonlyBrowserPolicy(
  options?: CodeServerReadonlyInput,
): CodeServerReadonlyPolicy {
  if (isReadonlyPolicy(options)) return cloneReadonlyPolicy(options);
  return createReadonlyPolicyFromInput(options);
}

function isReadonlyPolicy(
  value: CodeServerReadonlyInput | undefined,
): value is CodeServerReadonlyPolicy {
  return (
    Boolean(value) &&
      typeof value === "object" &&
      "filesystem"in value &&
      "settingsPatch"in value &&
      "blockedShortcuts"in value &&
      "browserGuards"in value
  );
}

function cloneReadonlyPolicy(
  policy: CodeServerReadonlyPolicy,
): CodeServerReadonlyPolicy {
  return {
    browserGuards: {
      ...policy.browserGuards,
      blockedCommandLinkSchemes: [
        ...policy.browserGuards.blockedCommandLinkSchemes,
      ],
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

function createReadonlyPolicyFromInput(
  options?: CodeServerReadonlyInput,
): CodeServerReadonlyPolicy {
  const normalized =
  options && typeof options === "object" ? options : undefined;
  const enabled = isReadonlyEnabled(options, normalized);
  const mode =
  enabled && normalized?.mode && normalized.mode !== "off"
  ? normalized.mode
  : enabled
  ? "view"
  : "off";

  return {
    browserGuards: createReadonlyBrowserGuards(enabled, normalized),
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
  normalized:
  |Exclude<CodeServerReadonlyInput, boolean|CodeServerReadonlyPolicy>
  |undefined,
): boolean {
  return (
    options === true ||
      normalized?.enabled === true ||
      normalized?.mode === "readonly" ||
      normalized?.mode === "view"
  );
}

function createReadonlyBrowserGuards(
  enabled: boolean,
  normalized:
  |Exclude<CodeServerReadonlyInput, boolean|CodeServerReadonlyPolicy>
  |undefined,
) {
  return {
    blockBeforeInput: enabled
    ? (normalized?.browserGuards?.blockBeforeInput ?? false)
    : (normalized?.browserGuards?.blockBeforeInput ?? false),
    blockCommandLinks: enabled
    ? (normalized?.browserGuards?.blockCommandLinks ?? true)
    : (normalized?.browserGuards?.blockCommandLinks ?? false),
    blockDragAndDrop: enabled
    ? (normalized?.browserGuards?.blockDragAndDrop ?? true)
    : (normalized?.browserGuards?.blockDragAndDrop ?? false),
    blockPaste: enabled
    ? (normalized?.browserGuards?.blockPaste ?? false)
    : (normalized?.browserGuards?.blockPaste ?? false),
    blockUpload: enabled
    ? (normalized?.browserGuards?.blockUpload ?? true)
    : (normalized?.browserGuards?.blockUpload ?? false),
    blockedCommandLinkSchemes: normalizeStringList(
      normalized?.browserGuards?.blockedCommandLinkSchemes,
      enabled ? DEFAULT_BLOCKED_COMMAND_LINK_SCHEMES : [],
    ),
    blockedSelectors: normalizeStringList(
      normalized?.browserGuards?.blockedSelectors,
      enabled ? DEFAULT_BLOCKED_SELECTORS : [],
    ),
    blockedUiLabels: normalizeStringList(
      normalized?.browserGuards?.blockedUiLabels,
      enabled ? DEFAULT_BLOCKED_UI_LABELS : [],
    ),
    readonlyMessage:
    normalized?.browserGuards?.readonlyMessage?.trim() ||
      DEFAULT_READONLY_MESSAGE,
    showBanner: enabled
    ? (normalized?.browserGuards?.showBanner ?? true)
    : (normalized?.browserGuards?.showBanner ?? false),
  };
}

function createReadonlyFilesystemPolicy(
  enabled: boolean,
  normalized:
  |Exclude<CodeServerReadonlyInput, boolean|CodeServerReadonlyPolicy>
  |undefined,
) {
  return {
    allowHostTempDir: enabled
    ? (normalized?.filesystem?.allowHostTempDir ?? false)
    : (normalized?.filesystem?.allowHostTempDir ?? false),
    extraWritablePaths: normalizeStringList(
      normalized?.filesystem?.extraWritablePaths,
      [],
    ),
    mode: enabled
    ? (normalized?.filesystem?.mode ?? "auto")
    : (normalized?.filesystem?.mode ?? "off"),
  } as const;
}

function normalizeStringList(
  values: readonly string[] | undefined,
  fallback: readonly string[],
): string[] {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (normalized.length > 0) {
    return [...new Set(normalized)];
  }
  return [...fallback];
}

export {
  createReadonlyBrowserPolicy,
  createReadonlySessionPolicy,
  DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
  evaluateReadonlyBrowserAction,
  readonlyPolicyBlocksWritableSessionPromotions,
};
