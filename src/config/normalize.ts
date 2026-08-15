import type {
  CodeServerKitConfig,
  NormalizedCodeServerKitConfig,
} from "./types.js";
import type { CodeServerBrowserIntegrationOptions } from "#3c8d8166992a";
import { PACKAGE_VERSION } from "#ztxam4p5ur4e";
import { isRecord } from "@trebired/utils";
import { resolveForVersion } from "@trebired/utils";

type NormalizeOptions = {
  configPath?: string;
  requireForVersion?: boolean;
};

function defineConfig<TConfig extends CodeServerKitConfig>(config: TConfig): TConfig {
  return config;
}

function normalizeConfig(
  config: CodeServerKitConfig = {},
  options: NormalizeOptions = {},
): NormalizedCodeServerKitConfig {
  if (!isRecord(config)) throw new Error("code-server-kit config must be an object");
  return {
    browser: normalizeBrowser(config.browser),
    forVersion: normalizeForVersion(config, options),
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

function normalizeForVersion(
  config: CodeServerKitConfig,
  options: NormalizeOptions,
): string {
  return resolveForVersion({
      configPath: options.configPath,
      forVersion: config.forVersion,
      label: "code-server-kit",
      packageVersion: PACKAGE_VERSION,
      requireForVersion: options.requireForVersion,
  });
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

export {
  defineConfig,
  mergeBrowserOptions,
  normalizeConfig,
};
