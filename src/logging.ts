import { createLog, type LogInstance } from "@package/logger";
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
const defaultLoggers = new Map<string, LogInstance>();

function createDefaultCodeServerKitLogger(source = CODE_SERVER_KIT_PACKAGE_NAME): LogInstance {
  const existing = defaultLoggers.get(source);
  if (existing) return existing;

  const logger = createLog({
      console: {
        metadata: false,
        timestamp: false,
      },
      quiet: true,
      save: false,
      source,
  });
  defaultLoggers.set(source, logger);
  return logger;
}

function resolveLogger(
  logger?: CodeServerKitLogger,
  adapter?: CodeServerKitLoggerAdapter,
): NormalizedCodeServerKitLogger {
  return resolveSharedLogger({
      adapter,
      defaultLogger: createDefaultCodeServerKitLogger,
      fallback: "console",
      logger,
      source: CODE_SERVER_KIT_PACKAGE_NAME,
  }) as NormalizedCodeServerKitLogger;
}

export {
  CODE_SERVER_KIT_LOG_GROUP,
  CODE_SERVER_KIT_PACKAGE_NAME,
  createDefaultCodeServerKitLogger,
  logPackageInitialized,
  resolveLogger,
};
