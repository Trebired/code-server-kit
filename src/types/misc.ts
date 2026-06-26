import type { CodeServerPathBinding, CodeServerReadinessStatus, CodeServerRepairResult, CodeServerEnsureLaunchableOptions, CodeServerInstallValidationResult } from "./preparation.js";
import type { CodeServerReadyResult } from "./launch.js";
import type { CodeServerSessionDiagnostics, CodeServerSessionRequest, CodeServerSessionStartResult } from "./session.js";

type CodeServerDoctorOptions = CodeServerEnsureLaunchableOptions;

type CodeServerDoctorResult = {
  repaired: CodeServerRepairResult | null;
  status: CodeServerReadinessStatus;
  validation: CodeServerInstallValidationResult;
};

type CodeServerSmokeTestOptions = CodeServerSessionRequest & {
  keepSession?: boolean;
};

type CodeServerSmokeTestResult = {
  diagnostics: CodeServerSessionDiagnostics | null;
  readiness: CodeServerReadyResult | null;
  session: CodeServerSessionStartResult;
};

type CodeServerSupportBindingSuggestion = CodeServerPathBinding;

export type {
  CodeServerDoctorOptions,
  CodeServerDoctorResult,
  CodeServerSmokeTestOptions,
  CodeServerSmokeTestResult,
  CodeServerSupportBindingSuggestion,
};
