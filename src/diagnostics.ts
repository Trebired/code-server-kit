import { isCodeServerKitError } from "./errors.js";
import type {
  CodeServerDiagnosticCategory,
  CodeServerSanitizedDiagnostics,
  CodeServerSanitizerOptions,
  CodeServerStartupDiagnostics,
  CodeServerWatchdogMode,
  CollectCodeServerStartupDiagnosticsOptions,
  NormalizedCodeServerStartupFailure,
} from "./types.js";

function collectCodeServerStartupDiagnostics(options: CollectCodeServerStartupDiagnosticsOptions = {}): CodeServerStartupDiagnostics {
  const normalized = normalizeError(options.error);
  const category = options.category ?? deriveCategory(normalized.code);
  const stderrTail = trimTail(options.process?.getStderr?.() ?? "");
  const stdoutTail = trimTail(options.process?.getStdout?.() ?? "");
  const journalSummary = trimTail(options.journal ?? "");
  const details = {
    ...normalized.details,
    ...(options.preparationStatus
      ? {
        preparationIssues: options.preparationStatus.issues,
        preparationState: options.preparationStatus.state,
      }
      : {}),
  };
  const diagnostics: CodeServerStartupDiagnostics = {
    category,
    code: normalized.code ?? category,
    details,
    journalSummary: journalSummary || undefined,
    launchStrategy: options.launchStrategy ?? null,
    stderrTail: stderrTail || undefined,
    stdoutTail: stdoutTail || undefined,
    summary: buildSummary(category, normalized.message),
    watchdogMode: options.watchdogMode ?? options.preparationStatus?.watchdogMode,
  } satisfies CodeServerStartupDiagnostics;

  if (options.sanitizer) {
    diagnostics.sanitized = sanitizeCodeServerDiagnostics(diagnostics, options.sanitizer);
  }

  return diagnostics;
}

function sanitizeCodeServerDiagnostics(
  diagnostics: Pick<CodeServerStartupDiagnostics, "details" | "summary">,
  options: CodeServerSanitizerOptions,
): CodeServerSanitizedDiagnostics {
  const redact = createRedactor(options);

  return {
    details: JSON.parse(redact(JSON.stringify(diagnostics.details))) as Record<string, unknown>,
    summary: redact(diagnostics.summary),
  };
}

function normalizeCodeServerStartupFailure(
  error: unknown,
  options: Omit<CollectCodeServerStartupDiagnosticsOptions, "error"> = {},
): NormalizedCodeServerStartupFailure {
  const normalized = normalizeError(error);
  const diagnostics = collectCodeServerStartupDiagnostics({
    ...options,
    error,
  });

  return {
    ...diagnostics,
    isCodeServerKitError: normalized.isCodeServerKitError,
    name: normalized.name,
  };
}

function deriveCategory(code: string | null): CodeServerDiagnosticCategory {
  switch (code) {
    case "entrypoint_resolution_failed":
      return "entrypoint_resolution_failed";
    case "invalid_configuration":
      return "invalid_configuration";
    case "preparation_failed":
      return "preparation_failed";
    case "process_exited_before_ready":
      return "process_exited_before_ready";
    case "startup_timeout":
      return "startup_timeout";
    case "systemd_launch_failed":
      return "systemd_launch_failed";
    case "systemd_status_failed":
    case "systemd_collision":
      return "systemd_unit_failed";
    default:
      if (code?.includes("watchdog") || code?.includes("dependency")) {
        return "missing_runtime_dependency";
      }
      return "unknown";
  }
}

function buildSummary(category: CodeServerDiagnosticCategory, message: string): string {
  switch (category) {
    case "entrypoint_resolution_failed":
      return `Could not resolve the code-server entrypoint. ${message}`;
    case "invalid_configuration":
      return `The code-server launch configuration is invalid. ${message}`;
    case "missing_runtime_dependency":
      return `A code-server runtime dependency is missing. ${message}`;
    case "preparation_failed":
      return `The code-server package could not be prepared. ${message}`;
    case "process_exited_before_ready":
      return `code-server exited before it became ready. ${message}`;
    case "startup_timeout":
      return `Timed out waiting for code-server to become ready. ${message}`;
    case "systemd_launch_failed":
      return `systemd could not launch the code-server unit. ${message}`;
    case "systemd_unit_failed":
      return `The code-server systemd unit failed during startup. ${message}`;
    default:
      return message;
  }
}

function createRedactor(options: CodeServerSanitizerOptions): (value: string) => string {
  return (value: string) => {
    let next = value;

    for (const prefix of options.pathPrefixes ?? []) {
      next = next.split(prefix).join("<redacted-path>");
    }

    for (const current of options.values ?? []) {
      next = next.split(current).join("<redacted>");
    }

    if (options.replacer) {
      next = options.replacer(next);
    }

    return next;
  };
}

function normalizeError(error: unknown): {
  code: string | null;
  details: Record<string, unknown>;
  isCodeServerKitError: boolean;
  message: string;
  name: string;
} {
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

function trimTail(value: string, limit = 8_192): string {
  return value.length > limit
    ? value.slice(value.length - limit)
    : value;
}

export {
  collectCodeServerStartupDiagnostics,
  normalizeCodeServerStartupFailure,
  sanitizeCodeServerDiagnostics,
};
