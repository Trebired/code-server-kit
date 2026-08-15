import type { CodeServerBrowserIntegrationOptions } from "#3c8d8166992a";

type CodeServerKitConfig = {
  browser?: CodeServerBrowserIntegrationOptions;
  forVersion?: string;
};

type NormalizedCodeServerKitConfig = {
  browser: CodeServerBrowserIntegrationOptions;
  forVersion: string;
};

type LoadedCodeServerKitConfig = {
  config: NormalizedCodeServerKitConfig;
  configPath: string | null;
  dependencies: string[];
};

type LoadCodeServerKitConfigOptions = {
  configPath?: string;
  defaultIfMissing?: boolean;
  searchFrom?: string;
};

export type {
  CodeServerKitConfig,
  LoadCodeServerKitConfigOptions,
  LoadedCodeServerKitConfig,
  NormalizedCodeServerKitConfig,
};
