import { CODE_SERVER_KIT_LOG_GROUP, CODE_SERVER_KIT_PACKAGE_NAME, logPackageInitialized } from "#5a29135e56c1";
import type {
  CodeServerSessionManager,
  CodeServerSessionManagerOptions,
  CodeServerSessionRequest,
  CodeServerSessionRestartResult,
  CodeServerSessionStartResult,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
} from "#3c8d8166992a";
import { readCodeServerSessionDiagnostics } from "./status.js";
import { createSessionManagerApi } from "./manager_helpers.js";

function createCodeServerSessionManager(options: CodeServerSessionManagerOptions = {}): CodeServerSessionManager {
  logPackageInitialized({
      adapter: options.loggerAdapter,
      group: CODE_SERVER_KIT_LOG_GROUP,
      logger: options.logger,
      source: CODE_SERVER_KIT_PACKAGE_NAME,
  });
  return createSessionManagerApi(options);
}

async function startCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  return await createCodeServerSessionManager(createInlineManagerOptions(options)).start(options);
}

async function stopCodeServerSession(
  options: Pick<CodeServerSessionRequest, "logger"|"loggerAdapter"|"profile"|"sanitizer"|"sessionKey"|"stateRoot">& {
    signal?: NodeJS.Signals | number;
  },
): Promise<CodeServerSessionStopResult|null> {
  return await createCodeServerSessionManager({
      logger: options.logger,
      loggerAdapter: options.loggerAdapter,
      profile: options.profile,
  }).stop(options);
}

async function restartCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult> {
  return await createCodeServerSessionManager(createInlineManagerOptions(options)).restart(options);
}

const startSession = startCodeServerSession;

async function stopSession(
  options: Pick<CodeServerSessionRequest, "logger"|"loggerAdapter"|"profile"|"sanitizer"|"sessionKey"|"stateRoot">& {
    signal?: NodeJS.Signals | number;
  },
): Promise<CodeServerSessionStopResult|null> {
  return await stopCodeServerSession(options);
}

const reuseSession = startCodeServerSession;

async function inspectSessionFailure(
  options: Pick<CodeServerSessionRequest, "sanitizer"|"sessionKey"|"stateRoot">,
): Promise<import("#3c8d8166992a").CodeServerSessionDiagnostics["normalizedFailure"]|null> {
  const diagnostics = await readCodeServerSessionDiagnostics(options);
  return diagnostics?.normalizedFailure ?? null;
}

async function getCodeServerSessionStatus(
  options: Pick<CodeServerSessionRequest, "logger"|"loggerAdapter"|"sanitizer"|"sessionKey"|"stateRoot">,
): Promise<CodeServerSessionStatus|null> {
  return await createCodeServerSessionManager({
      logger: options.logger,
      loggerAdapter: options.loggerAdapter,
  }).getStatus(options);
}

function createInlineManagerOptions(options: CodeServerSessionRequest): CodeServerSessionManagerOptions {
  return {
    browser: options.browser,
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    profile: options.profile,
    readonly: options.readonly,
    resolveFrom: options.resolveFrom,
  };
}

export {
  createCodeServerSessionManager,
  getCodeServerSessionStatus,
  inspectSessionFailure,
  restartCodeServerSession,
  reuseSession,
  startCodeServerSession,
  startSession,
  stopCodeServerSession,
  stopSession,
};
