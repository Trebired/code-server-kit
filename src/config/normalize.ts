import type {
  CodeServerKitConfig,
  NormalizedCodeServerKitConfig,
} from "./types.js";
import type { CodeServerBrowserIntegrationOptions } from "#3c8d8166992a";

function defineConfig<TConfig extends CodeServerKitConfig>(config: TConfig): TConfig {
  return config;
}

function normalizeConfig(config: CodeServerKitConfig = {}): NormalizedCodeServerKitConfig {
  if (!isRecord(config)) throw new Error("code-server-kit config must be an object");
  return {
    browser: normalizeBrowser(config.browser),
  };
}

function mergeBrowserOptions(
  defaults: CodeServerBrowserIntegrationOptions,
  options: CodeServerBrowserIntegrationOptions = {},
): CodeServerBrowserIntegrationOptions {
  return {
    ...defaults,
    ...options,
    appearance: mergeObjects(defaults.appearance, options.appearance),
    diagnostics: mergeObjects(defaults.diagnostics, options.diagnostics),
    embed: mergeObjects(defaults.embed, options.embed),
    html: mergeObjects(defaults.html, options.html),
    readonly: mergeConfigValue(defaults.readonly, options.readonly),
    theme: mergeObjects(defaults.theme, options.theme),
  };
}

function normalizeBrowser(input: CodeServerKitConfig["browser"]): CodeServerBrowserIntegrationOptions {
  return isRecord(input) ? { ...input } : {};
}

function mergeObjects<TValue extends object>(left: TValue | undefined, right: TValue | undefined): TValue | undefined {
  if (!left && !right) return undefined;
  return {
    ...(left || {}),
    ...(right || {}),
  } as TValue;
}

function mergeConfigValue<TValue>(left: TValue | undefined, right: TValue | undefined): TValue | undefined {
  if (right !== undefined) {
    if (isRecord(left) && isRecord(right)) {
      return {
        ...left,
        ...right,
      } as TValue;
    }

    return right;
  }

  return left;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export {
  defineConfig,
  mergeBrowserOptions,
  normalizeConfig,
};
