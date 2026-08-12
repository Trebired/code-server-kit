import type {
  CodeServerSessionManager,
  CodeServerSessionManagerOptions,
  CodeServerSessionRequest,
  CodeServerSessionRestartResult,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
} from "#3c8d8166992a";
import {
  createEmptyStopResult,
  mergeSessionBrowserOptions,
} from "./shared.js";
import {
  getCodeServerSessionStatusInternal,
  readCodeServerSessionDiagnostics,
  stopCodeServerSessionInternal,
} from "./status.js";
import { startCodeServerSessionInternal } from "./start.js";

function createSessionManagerApi(options: CodeServerSessionManagerOptions): CodeServerSessionManager {
  return {
    getStatus: createGetStatusHandler(options),
    readDiagnostics: createReadDiagnosticsHandler(),
    restart: createRestartHandler(options),
    start: createStartHandler(options),
    stop: createStopHandler(options),
  };
}

function createGetStatusHandler(options: CodeServerSessionManagerOptions) {
  return async function getStatus(
    input: Pick<CodeServerSessionRequest, "logger"|"loggerAdapter"|"sanitizer"|"sessionKey"|"stateRoot">,
  ): Promise<CodeServerSessionStatus|null> {
    return await getCodeServerSessionStatusInternal({
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        sanitizer: input.sanitizer,
        sessionKey: input.sessionKey,
        stateRoot: input.stateRoot,
    });
  };
}

function createReadDiagnosticsHandler() {
  return async function readDiagnostics(
    input: Pick<CodeServerSessionRequest, "sanitizer"|"sessionKey"|"stateRoot">,
  ) {
    return await readCodeServerSessionDiagnostics({
        sanitizer: input.sanitizer,
        sessionKey: input.sessionKey,
        stateRoot: input.stateRoot,
    });
  };
}

function createRestartHandler(options: CodeServerSessionManagerOptions) {
  return async function restart(input: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult> {
    const stop = await stopCodeServerSessionInternal({
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        profile: input.profile ?? options.profile,
        sanitizer: input.sanitizer,
        sessionKey: input.sessionKey,
        signal: "SIGTERM",
        stateRoot: input.stateRoot,
    }) ?? createEmptyStopResult(input.sessionKey);
    const start = await startCodeServerSessionInternal(resolveStartInput(options, input));
    return { start, stop };
  };
}

function createStartHandler(options: CodeServerSessionManagerOptions) {
  return async function start(input: CodeServerSessionRequest) {
    return await startCodeServerSessionInternal(resolveStartInput(options, input));
  };
}

function createStopHandler(options: CodeServerSessionManagerOptions) {
  return async function stop(
    input: Pick<CodeServerSessionRequest, "logger"|"loggerAdapter"|"profile"|"sanitizer"|"sessionKey"|"stateRoot">& {
      signal?: NodeJS.Signals | number;
    },
  ): Promise<CodeServerSessionStopResult|null> {
    return await stopCodeServerSessionInternal({
        ...input,
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        profile: input.profile ?? options.profile,
    });
  };
}

function resolveStartInput(
  options: CodeServerSessionManagerOptions,
  input: CodeServerSessionRequest,
): CodeServerSessionRequest {
  return {
    ...input,
    browser: mergeSessionBrowserOptions(options.browser, input.browser),
    installation: input.installation ?? options.installation,
    logger: input.logger ?? options.logger,
    loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
    profile: input.profile ?? options.profile,
    readonly: input.readonly ??options.readonly,
    resolveFrom: input.resolveFrom ?? options.resolveFrom,
  };
}

export { createSessionManagerApi };
