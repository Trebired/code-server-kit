import {
  logPackageInitialized,
  resolveLogger as resolveSharedLogger,
} from "@package/logger-adapter";

import type {
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  NormalizedCodeServerKitLogger,
} from "./types.js";

function resolveLogger(
  logger?: CodeServerKitLogger,
  adapter?: CodeServerKitLoggerAdapter,
): NormalizedCodeServerKitLogger {
  return resolveSharedLogger({
    adapter,
    fallback: "console",
    logger,
    source: "@package/code-server-kit",
  }) as NormalizedCodeServerKitLogger;
}

export {
  logPackageInitialized,
  resolveLogger,
};
