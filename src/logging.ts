import {
  logPackageInitialized,
  resolveLogger as resolveSharedLogger,
} from "@package/logger-adapter";

import { buildPackageLogGroup, PACKAGE_NAME } from "#ztxam4p5ur4e";
import type {
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  NormalizedCodeServerKitLogger,
} from "./types.js";

const CODE_SERVER_KIT_LOG_GROUP = buildPackageLogGroup();
const CODE_SERVER_KIT_PACKAGE_NAME = PACKAGE_NAME;

function resolveLogger(
  logger?: CodeServerKitLogger,
  adapter?: CodeServerKitLoggerAdapter,
): NormalizedCodeServerKitLogger {
  return resolveSharedLogger({
      adapter,
      fallback: "console",
      logger,
      source: CODE_SERVER_KIT_PACKAGE_NAME,
  }) as NormalizedCodeServerKitLogger;
}

export {
  CODE_SERVER_KIT_LOG_GROUP,
  CODE_SERVER_KIT_PACKAGE_NAME,
  logPackageInitialized,
  resolveLogger,
};
