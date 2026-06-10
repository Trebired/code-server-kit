import { isCodeServerKitError } from "./errors.js";
import type {
  CodeServerLaunchPlan,
  CodeServerLaunchSpec,
  CodeServerPathBinding,
  NormalizedCodeServerStartupFailure,
} from "./types.js";
import { buildCodeServerLaunchSpec } from "./plan.js";

function createCodeServerLaunchSpec(plan: CodeServerLaunchPlan): CodeServerLaunchSpec {
  return buildCodeServerLaunchSpec(plan);
}

function formatCodeServerCommand(value: Pick<CodeServerLaunchPlan, "args" | "command"> | Pick<CodeServerLaunchSpec, "args" | "command">): string {
  return [value.command, ...value.args]
    .map((part) => shellEscape(part))
    .join(" ");
}

function normalizeCodeServerStartupFailure(error: unknown): NormalizedCodeServerStartupFailure {
  if (isCodeServerKitError(error)) {
    return {
      code: error.code,
      details: {
        ...error.details,
      },
      isCodeServerKitError: true,
      message: error.message,
      name: error.name,
    };
  }

  if (error instanceof Error) {
    return {
      code: typeof (error as Error & { code?: unknown }).code === "string"
        ? String((error as Error & { code?: unknown }).code)
        : null,
      details: {},
      isCodeServerKitError: false,
      message: error.message,
      name: error.name,
    };
  }

  return {
    code: null,
    details: {},
    isCodeServerKitError: false,
    message: String(error),
    name: "Error",
  };
}

function buildPathBindings(paths: Array<CodeServerPathBinding | null | undefined>): CodeServerPathBinding[] {
  const bindings: CodeServerPathBinding[] = [];
  const seen = new Set<string>();

  for (const value of paths) {
    if (!value) continue;
    const key = `${value.access}:${value.hostPath}:${value.mountPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bindings.push(value);
  }

  return bindings;
}

function shellEscape(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export {
  buildPathBindings,
  createCodeServerLaunchSpec,
  formatCodeServerCommand,
  normalizeCodeServerStartupFailure,
};
