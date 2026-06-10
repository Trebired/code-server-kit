type CodeServerKitErrorCode =
  | "binary_not_found"
  | "package_resolution_failed"
  | "port_allocation_failed"
  | "process_exited_before_ready"
  | "startup_timeout";

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

class CodeServerBinaryNotFoundError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("binary_not_found", message, details);
    this.name = "CodeServerBinaryNotFoundError";
  }
}

class CodeServerPackageResolutionError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("package_resolution_failed", message, details);
    this.name = "CodeServerPackageResolutionError";
  }
}

class CodeServerPortAllocationError extends CodeServerKitError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("port_allocation_failed", message, details);
    this.name = "CodeServerPortAllocationError";
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

function isCodeServerKitError(value: unknown): value is CodeServerKitError {
  return value instanceof CodeServerKitError;
}

export {
  CodeServerBinaryNotFoundError,
  CodeServerKitError,
  CodeServerPackageResolutionError,
  CodeServerPortAllocationError,
  CodeServerProcessExitedBeforeReadyError,
  CodeServerStartupTimeoutError,
  isCodeServerKitError,
};
export type { CodeServerKitErrorCode };
