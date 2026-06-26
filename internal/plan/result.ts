import {
  browserReadinessPolicy,
} from "#8392d406df71";
import { createReadonlyEnforcement, resolveReadonlyWritablePaths } from "../readonly-launch.js";
import {
  buildCodeServerArgs,
  buildRecommendedBindings,
  buildSandboxPlan,
  normalizeNodeCommand,
  uniquePaths,
} from "./shared.js";
import type {
  CodeServerIntegrationPlan,
  CodeServerLaunchOptions,
  CodeServerReadonlyPolicy,
  CreateCodeServerLaunchPlanOptions,
} from "#3c8d8166992a";

function createIntegrationPlanResult(
  options: CreateCodeServerLaunchPlanOptions,
  context: {
    binding: Awaited<ReturnType<typeof import("./shared.js").resolveLaunchBinding>>;
    cwd: string;
    env: NodeJS.ProcessEnv;
    extensionsDir: string;
    installation: import("#3c8d8166992a").CodeServerInstallation;
    launchMode: Exclude<CodeServerLaunchOptions["launchMode"], "auto" | undefined>;
    readonly: CodeServerReadonlyPolicy;
    trustedOrigins: string[];
    userDataDir: string;
    workspacePath: string | null;
  },
): CodeServerIntegrationPlan {
  const runtime = buildPlanRuntime(options, context);
  const outputs = buildPlanOutputs(options, context);
  const staticFields = buildStaticPlanFields(context);

  return {
    ...createCorePlanResult(options, context, runtime, outputs, staticFields),
    sandboxVisiblePaths: outputs.translatedPaths.map((value) => value.visiblePath),
    translatedPaths: outputs.translatedPaths,
    trustedOrigins: context.trustedOrigins,
    userDataDir: context.userDataDir,
    watchdogMode: staticFields.watchdogMode,
    workspacePath: context.workspacePath,
  };
}

function createCorePlanResult(
  options: CreateCodeServerLaunchPlanOptions,
  context: Parameters<typeof createIntegrationPlanResult>[1],
  runtime: ReturnType<typeof buildPlanRuntime>,
  outputs: ReturnType<typeof buildPlanOutputs>,
  staticFields: ReturnType<typeof buildStaticPlanFields>,
): Omit<CodeServerIntegrationPlan, "sandboxVisiblePaths" | "translatedPaths" | "trustedOrigins" | "userDataDir" | "watchdogMode" | "workspacePath"> {
  return {
    args: runtime.args,
    bindAddr: context.binding.bindAddr,
    bindings: outputs.bindings,
    browser: {
      policy: browserReadinessPolicy(options.browser?.policy),
    },
    codeServerPackageRoot: staticFields.codeServerPackageRoot,
    command: runtime.command,
    cwd: staticFields.cwd,
    defaultCwd: staticFields.defaultCwd,
    defaultEnv: staticFields.defaultEnv,
    entryKind: staticFields.entryKind,
    entryPoint: staticFields.entryPoint,
    env: context.env,
    extensionsDir: context.extensionsDir,
    host: context.binding.host,
    hostVisiblePaths: [...outputs.recommendedReadablePaths, ...outputs.recommendedWritablePaths],
    installation: staticFields.installation,
    launchMode: context.launchMode,
    port: staticFields.port,
    preparationStatus: staticFields.preparationStatus,
    readinessStatus: staticFields.readinessStatus,
    readonly: context.readonly,
    readonlyEnforcement: outputs.readonlyEnforcement,
    recommendedReadablePaths: outputs.recommendedReadablePaths,
    recommendedWritablePaths: outputs.recommendedWritablePaths,
    sandbox: outputs.sandbox,
    supportBindings: staticFields.supportBindings,
    supportRoot: staticFields.supportRoot,
  };
}

function buildStaticPlanFields(context: Parameters<typeof createIntegrationPlanResult>[1]) {
  return {
    codeServerPackageRoot: context.installation.packageRoot,
    cwd: context.cwd,
    defaultCwd: context.installation.defaultCwd,
    defaultEnv: {
      ...context.installation.defaultEnv,
    },
    entryKind: context.installation.entryKind,
    entryPoint: context.installation.entryPoint,
    installation: context.installation,
    port: context.binding.port,
    preparationStatus: context.installation.preparationStatus,
    readinessStatus: context.installation.readinessStatus,
    supportBindings: [...context.installation.supportBindings],
    supportRoot: context.installation.supportRoot,
    watchdogMode: context.installation.preparationStatus.watchdogMode,
  };
}

function buildPlanRuntime(
  options: CreateCodeServerLaunchPlanOptions,
  context: Parameters<typeof createIntegrationPlanResult>[1],
) {
  const command = context.launchMode === "node"
    ? normalizeNodeCommand(options.nodeCommand)
    : context.installation.entryPoint;
  const cliArgs = buildCodeServerArgs({
    bindAddr: context.binding.bindAddr,
    extensionsDir: context.extensionsDir,
    trustedOrigins: context.trustedOrigins,
    userDataDir: context.userDataDir,
    workspacePath: context.workspacePath,
  });
  const args = context.launchMode === "node"
    ? [context.installation.entryPoint, ...cliArgs]
    : cliArgs;
  return { args, command };
}

function buildPlanOutputs(
  options: CreateCodeServerLaunchPlanOptions,
  context: Parameters<typeof createIntegrationPlanResult>[1],
) {
  const recommendedReadablePaths = uniquePaths([
    ...context.installation.recommendedReadablePaths,
    context.workspacePath,
  ]);
  const recommendedWritablePaths = resolveReadonlyWritablePaths({
    readonly: context.readonly,
    writablePaths: [context.userDataDir, context.extensionsDir],
  });
  const bindings = buildRecommendedBindings({
    extensionsDir: context.extensionsDir,
    installation: context.installation,
    recommendedWritablePaths,
    readonly: context.readonly,
    userDataDir: context.userDataDir,
    workspacePath: context.workspacePath,
  });
  const sandbox = buildSandboxPlan({
    bindings,
    dataRoot: options.dataRoot,
    readonly: context.readonly,
    stateRoot: options.stateRoot,
    supportBindings: context.installation.supportBindings,
    workspacePath: context.workspacePath,
  });
  const readonlyEnforcement = createReadonlyEnforcement({
    env: context.env,
    readonly: context.readonly,
    writablePaths: recommendedWritablePaths,
  });
  const translatedPaths = uniquePaths([
    context.installation.packageRoot,
    context.installation.supportRoot,
    context.workspacePath,
    context.userDataDir,
    context.extensionsDir,
  ]).map((value) => ({ hostPath: value, visiblePath: value }));

  return { bindings, readonlyEnforcement, recommendedReadablePaths, recommendedWritablePaths, sandbox, translatedPaths };
}

export { createIntegrationPlanResult };
