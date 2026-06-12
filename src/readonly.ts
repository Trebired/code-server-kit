import type {
  CodeServerReadonlyPolicy,
  CodeServerReadonlyPolicyOptions,
} from "./types.js";

const DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH = {
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "update.mode": "none",
  "workbench.startupEditor": "none",
} as const;

function createReadonlySessionPolicy(options?: CodeServerReadonlyPolicyOptions | boolean): CodeServerReadonlyPolicy {
  const normalized = options && typeof options === "object" ? options : undefined;
  const enabled = options === true || normalized?.enabled === true;

  return {
    browserGuards: {
      blockDragAndDrop: options === true
        ? true
        : normalized?.browserGuards?.blockDragAndDrop ?? false,
    },
    enabled,
    mode: enabled ? "readonly" : "off",
    settingsPatch: enabled
      ? {
        ...DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
        ...(normalized?.settingsPatch ?? {}),
      }
      : {},
  };
}

export {
  createReadonlySessionPolicy,
  DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH,
};
