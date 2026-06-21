import { normalizeCodeServerStartupFailure } from "./diagnostics.js";
import {
  ensureCodeServerLaunchable,
  repairCodeServerInstall,
  validateCodeServerInstall,
} from "./preparation.js";
import { createCodeServerSessionManager } from "./session.js";
import type {
  CodeServerDoctorOptions,
  CodeServerDoctorResult,
  CodeServerSmokeTestOptions,
  CodeServerSmokeTestResult,
} from "./types.js";

async function runCodeServerDoctor(options: CodeServerDoctorOptions = {}): Promise<CodeServerDoctorResult> {
  const validation = validateCodeServerInstall(options);
  if (validation.ok || options.attemptRepair === false) {
    return {
      repaired: null,
      status: validation.status,
      validation,
    };
  }

  const repaired = await repairCodeServerInstall(options);
  return {
    repaired,
    status: repaired.statusAfter,
    validation,
  };
}

async function runCodeServerSmokeTest(options: CodeServerSmokeTestOptions): Promise<CodeServerSmokeTestResult> {
  const manager = createCodeServerSessionManager({
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    resolveFrom: options.resolveFrom,
  });
  await ensureCodeServerLaunchable({
    attemptRepair: true,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    resolveFrom: options.resolveFrom,
  });

  const started = await manager.start(options);
  if (!options.keepSession) {
    await manager.stop({
      logger: options.logger,
      loggerAdapter: options.loggerAdapter,
      profile: options.profile,
      sanitizer: options.sanitizer,
      sessionKey: options.sessionKey,
      stateRoot: options.stateRoot,
    });
  }

  return {
    diagnostics: started.diagnostics,
    readiness: started.readiness,
    session: started,
  };
}

function explainCodeServerFailure(error: unknown) {
  return normalizeCodeServerStartupFailure(error);
}

export {
  explainCodeServerFailure,
  runCodeServerDoctor,
  runCodeServerSmokeTest,
};
