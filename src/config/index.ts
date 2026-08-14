export {
  defineConfig,
  mergeBrowserOptions,
  normalizeConfig,
} from "./normalize.js";
export {
  CODE_SERVER_KIT_PROJECT_CONFIG_PATH,
  findConfig,
  findConfigSync,
  loadCachedConfigSync,
  loadConfig,
  loadConfigSync,
  resetConfigCacheForTests,
} from "./load.js";

export type {
  CodeServerKitConfig,
  LoadCodeServerKitConfigOptions,
  LoadedCodeServerKitConfig,
  NormalizedCodeServerKitConfig,
} from "./types.js";
