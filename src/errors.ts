type CodeServerKitErrorCode =
  | "entrypoint_resolution_failed"
  | "installation_resolution_failed"
  | "invalid_configuration"
  | "launch_planning_failed"
  | "port_allocation_failed"
  | "preparation_failed"
  | "process_exited_before_ready"
  | "session_lifecycle_failed"
  | "session_reuse_conflict"
  | "startup_probe_failed"
  | "startup_timeout"
  | "systemd_collision"
  | "systemd_journal_failed"
  | "systemd_launch_failed"
  | "systemd_status_failed";

class CodeServerKitError extends Error {
  code: CodeServerKitErrorCode | string;
  details: Record<string, unknown>;

  constructor(code: CodeServerKitErrorCode | string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CodeServerKitError";
    this.code = code;
    this.details = details;
  }
}

class CodeServerInstallationResolutionError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("installation_resolution_failed", message, details);
    this.name = "CodeServerInstallationResolutionError";
  }
}

class CodeServerEntrypointResolutionError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("entrypoint_resolution_failed", message, details);
    this.name = "CodeServerEntrypointResolutionError";
  }
}

class CodeServerLaunchPlanningError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("launch_planning_failed", message, details);
    this.name = "CodeServerLaunchPlanningError";
  }
}

class CodeServerInvalidConfigurationError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("invalid_configuration", message, details);
    this.name = "CodeServerInvalidConfigurationError";
  }
}

class CodeServerPortAllocationError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("port_allocation_failed", message, details);
    this.name = "CodeServerPortAllocationError";
  }
}

class CodeServerPreparationError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("preparation_failed", message, details);
    this.name = "CodeServerPreparationError";
  }
}

class CodeServerProcessExitedBeforeReadyError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("process_exited_before_ready", message, details);
    this.name = "CodeServerProcessExitedBeforeReadyError";
  }
}

class CodeServerStartupTimeoutError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("startup_timeout", message, details);
    this.name = "CodeServerStartupTimeoutError";
  }
}

class CodeServerStartupProbeError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("startup_probe_failed", message, details);
    this.name = "CodeServerStartupProbeError";
  }
}

class CodeServerSessionLifecycleError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("session_lifecycle_failed", message, details);
    this.name = "CodeServerSessionLifecycleError";
  }
}

class CodeServerSessionReuseConflictError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("session_reuse_conflict", message, details);
    this.name = "CodeServerSessionReuseConflictError";
  }
}

class CodeServerSystemdLaunchError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("systemd_launch_failed", message, details);
    this.name = "CodeServerSystemdLaunchError";
  }
}

class CodeServerSystemdCollisionError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("systemd_collision", message, details);
    this.name = "CodeServerSystemdCollisionError";
  }
}

class CodeServerSystemdStatusError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("systemd_status_failed", message, details);
    this.name = "CodeServerSystemdStatusError";
  }
}

class CodeServerSystemdJournalError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("systemd_journal_failed", message, details);
    this.name = "CodeServerSystemdJournalError";
  }
}

class CodeServerPackageResolutionError extends CodeServerInstallationResolutionError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "CodeServerPackageResolutionError";
  }
}

class CodeServerBinaryNotFoundError extends CodeServerEntrypointResolutionError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "CodeServerBinaryNotFoundError";
  }
}

function isCodeServerKitError(value: unknown): value is CodeServerKitError {
  return value instanceof CodeServerKitError;
}

export {
  CodeServerBinaryNotFoundError,
  CodeServerEntrypointResolutionError,
  CodeServerInstallationResolutionError,
  CodeServerInvalidConfigurationError,
  CodeServerKitError,
  CodeServerLaunchPlanningError,
  CodeServerPackageResolutionError,
  CodeServerPortAllocationError,
  CodeServerPreparationError,
  CodeServerProcessExitedBeforeReadyError,
  CodeServerSessionLifecycleError,
  CodeServerSessionReuseConflictError,
  CodeServerStartupProbeError,
  CodeServerStartupTimeoutError,
  CodeServerSystemdCollisionError,
  CodeServerSystemdJournalError,
  CodeServerSystemdLaunchError,
  CodeServerSystemdStatusError,
  isCodeServerKitError,
};
export type { CodeServerKitErrorCode };
