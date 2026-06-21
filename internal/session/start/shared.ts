import type {
  CodeServerLaunchStrategy,
  CodeServerPreparationStatus,
  CodeServerProcessHandle,
  CodeServerProfilePolicy,
  CodeServerReadyResult,
  CodeServerSessionBackendCheckpoint,
  CodeServerSessionBrowserOptions,
  CodeServerSessionRecord,
  CodeServerSessionRequest,
} from "#3c8d8166992a";

type SessionStartContext = {
  existing: CodeServerSessionRecord | null;
  launchPlan: Awaited<ReturnType<typeof import("#0c8da394780f").createCodeServerLaunchPlan>>;
  options: CodeServerSessionRequest;
  paths: {
    diagnosticsPath: string;
    recordPath: string;
    sessionDir: string;
    stateRoot: string;
  };
  sessionKey: string;
  specHash: string;
  stateRoot: string;
};

type SessionStartRuntime = {
  backendCheckpoints: CodeServerSessionBackendCheckpoint[];
  browserBridge: CodeServerSessionBrowserOptions["bridge"] | undefined;
  correlationId: string;
  launchStrategy: CodeServerLaunchStrategy;
  preparation: CodeServerPreparationStatus;
  profilePolicy: CodeServerProfilePolicy | null;
  readinessTarget: CodeServerSessionRecord["readinessTarget"];
};

type SessionReadyRuntime = {
  handle: CodeServerProcessHandle | null;
  journalTail: string;
  readiness: CodeServerReadyResult;
};

export type {
  SessionReadyRuntime,
  SessionStartContext,
  SessionStartRuntime,
};
