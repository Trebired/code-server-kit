import path from "node:path";

import {
  CodeServerInvalidConfigurationError,
  CodeServerLaunchPlanningError,
} from "#8974ac53d713";
import { ensureCodeServerLaunchable } from "#1fwnycc9wdnp";
import { createReadonlySessionPolicy } from "#3nojkzzzf31b";
import { resolveCodeServerInstallation } from "#9ou2olnossyi";
import {
  assertDirectLaunchAvailable,
  normalizeLaunchMode,
  normalizeTrustedOrigins,
  resolveLaunchBinding,
  resolveLaunchDirectories,
} from "./shared.js";
import { createIntegrationPlanResult } from "./result.js";
import type {
  CodeServerInstallation,
  CodeServerIntegrationPlan,
  CodeServerLaunchPlan,
  CreateCodeServerLaunchPlanOptions,
} from "#3c8d8166992a";

async function createCodeServerIntegrationPlan(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerIntegrationPlan> {
  try {
    await ensureLaunchableIfNeeded(options);
    return await buildIntegrationPlan(options);
  } catch (error) {
    if (
      error instanceof CodeServerLaunchPlanningError
      || error instanceof CodeServerInvalidConfigurationError
      || error instanceof Error && "code" in error
    ) {
      throw error;
    }
    throw new CodeServerLaunchPlanningError("Could not create a code-server integration plan.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function createCodeServerLaunchPlan(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerLaunchPlan> {
  return await createCodeServerIntegrationPlan(options);
}

async function createCodeServerLaunch(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerLaunchPlan> {
  return await createCodeServerLaunchPlan(options);
}

async function ensureLaunchableIfNeeded(options: CreateCodeServerLaunchPlanOptions): Promise<void> {
  if (options.preparation?.mode === "skip") return;
  await ensureCodeServerLaunchable({
    attemptRepair: true,
    resolveFrom: options.resolveFrom,
    strictWatchdog: options.preparation?.strictWatchdog,
  });
}

async function buildIntegrationPlan(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerIntegrationPlan> {
  const installation = await resolvePlanInstallation(options);
  const launchMode = normalizeLaunchMode(options.launchMode, installation);
  const binding = await resolveLaunchBinding(options);
  const context = {
    binding,
    cwd: path.resolve(options.cwd ?? installation.defaultCwd),
    env: {
      ...installation.defaultEnv,
      ...(options.env ?? {}),
    },
    installation,
    launchMode,
    readonly: createReadonlySessionPolicy(options.readonly),
    trustedOrigins: normalizeTrustedOrigins(options.trustedOrigins),
    workspacePath: options.workspacePath ? path.resolve(options.workspacePath) : null,
    ...resolveLaunchDirectories(options),
  };
  if (launchMode === "direct") {
    assertDirectLaunchAvailable(installation.entryPoint);
  }
  return createIntegrationPlanResult(options, context);
}

async function resolvePlanInstallation(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerInstallation> {
  return options.installation ?? await resolveCodeServerInstallation({
    resolveFrom: options.resolveFrom,
    strictWatchdog: options.preparation?.strictWatchdog,
  });
}

export {
  createCodeServerIntegrationPlan,
  createCodeServerLaunch,
  createCodeServerLaunchPlan,
};
