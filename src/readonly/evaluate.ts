import type {
  CodeServerReadonlyBrowserAction,
  CodeServerReadonlyBrowserBlockResult,
  CodeServerReadonlyPolicy,
} from "#3c8d8166992a";
import { WRITABLE_SESSION_PROMOTION_SUBSTRINGS } from "./defaults.js";

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
  if (
    shortcut &&
      policy.blockedShortcuts.some(
      (entry) => normalizeShortcut(entry) === shortcut,
    )
  ) {
    return `shortcut "${action.shortcut}" is blocked`;
  }

  const selector = action.selector?.trim().toLowerCase();
  if (
    selector &&
      policy.browserGuards.blockedSelectors.some((entry) =>
      selector.includes(entry.toLowerCase()),
    )
  ) {
    return `selector "${action.selector}" matches a blocked UI target`;
  }

  const label = action.label?.trim().toLowerCase();
  if (
    label &&
      policy.browserGuards.blockedUiLabels.some((entry) =>
      label.includes(entry.toLowerCase()),
    )
  ) {
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
  if (
    policy.blockedCommandIds.some((entry) => entry.toLowerCase() === commandId)
  ) {
    return `command "${action.commandId}" is blocked`;
  }
  if (
    policy.blockedCommandPrefixes.some((entry) =>
      commandId.startsWith(entry.toLowerCase()),
    )
  ) {
    return `command "${action.commandId}" matches a blocked prefix`;
  }
  if (
    policy.blockedCommandSubstrings.some((entry) =>
      commandId.includes(entry.toLowerCase()),
    )
  ) {
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
  if (
    !policy.browserGuards.blockedCommandLinkSchemes.some(
      (entry) => entry.toLowerCase() === parsed.scheme,
    )
  ) {
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

function normalizeShortcut(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
  .trim()
  .toLowerCase()
  .split("command")
  .join("meta")
  .split("cmd")
  .join("meta")
  .split("control")
  .join("ctrl")
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
  return value?.trim().toLowerCase() || null;
}

function normalizeCommandUri(value: string | undefined): string | null {
  return value?.trim() || null;
}

function isWritableSessionPromotionCommand(commandId: string): boolean {
  return (
    WRITABLE_SESSION_PROMOTION_SUBSTRINGS.every((entry) =>
      commandId.includes(entry),
    ) ||
      commandId.includes("setactiveeditorwriteableinsession") ||
      commandId.includes("setactiveeditorwritableinsession") ||
      commandId.includes("toggleactiveeditorreadonlyinsession") ||
      commandId.includes("resetactiveeditorreadonlyinsession")
  );
}

function readonlyPolicyBlocksWritableSessionPromotions(
  policy: CodeServerReadonlyPolicy,
): boolean {
  return (
    policy.blockedCommandIds.some((entry) =>
      isWritableSessionPromotionCommand(entry.toLowerCase()),
    ) ||
      policy.blockedCommandPrefixes.some((entry) =>
      isWritableSessionPromotionCommand(entry.toLowerCase()),
    ) ||
      policy.blockedCommandSubstrings.some((entry) =>
      WRITABLE_SESSION_PROMOTION_SUBSTRINGS.includes(
        entry.toLowerCase() as(typeof WRITABLE_SESSION_PROMOTION_SUBSTRINGS)[number],
      ),
    )
  );
}

export {
  evaluateReadonlyBrowserAction,
  readonlyPolicyBlocksWritableSessionPromotions,
};
