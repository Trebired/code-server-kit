import type {
  LoggerAdapterEvent,
  LoggerAdapterGenericLogMethod,
  LoggerAdapterLogger,
  LoggerAdapterLogMethod,
  LoggerAdapterWriter,
  NormalizedLoggerAdapter,
} from "@trebired/logger-adapter";

type CodeServerEntryKind = "node_script" | "executable";
type CodeServerLaunchMode = "auto" | "direct" | "node";
type CodeServerLaunchStrategy = "direct" | "systemd";
type CodeServerSystemdScope = "user" | "system";
type CodeServerPathAccessMode = "read" | "write";
type CodeServerWatchdogMode = "disabled_fallback" | "native";
type CodeServerReadinessTarget = "tcp" | "http" | "websocket" | "browser-shell" | "workbench";
type CodeServerLifecyclePhase =
  | "resolve"
  | "prepare"
  | "repair"
  | "profile"
  | "sandbox-plan"
  | "launch"
  | "http-ready"
  | "websocket-ready"
  | "browser-bootstrap"
  | "workbench-ready";
type CodeServerSessionState =
  | "planned"
  | "launching"
  | "ready"
  | "failed"
  | "stopped"
  | "stale"
  | "reusing_existing";
type CodeServerSessionHealth = "failed" | "ready" | "starting" | "stale" | "stopped";
type CodeServerPreparationMode = "auto" | "ensure" | "skip";
type CodeServerPreparationState = "missing" | "prepared" | "repairable";
type CodeServerReadinessState = "launchable" | "repairable" | "unrecoverable";
type CodeServerRepairOutcome = "noop" | "repaired" | "partially_repaired" | "unrecoverable";
type CodeServerProfileItem =
  | "settings.json"
  | "extensions.json"
  | "keybindings.json"
  | "snippets"
  | "extensions"
  | "globalStorage";
type CodeServerProfileRestorePolicy = "always" | "if-missing-or-empty";
type CodeServerProfilePersistPolicy = "always" | "if-changed";
type CodeServerProfileSignatureMode = "content-hash";
type CodeServerDiagnosticCategory =
  | "entrypoint_resolution_failed"
  | "invalid_configuration"
  | "missing_runtime_dependency"
  | "preparation_failed"
  | "process_exited_before_ready"
  | "startup_timeout"
  | "systemd_launch_failed"
  | "systemd_unit_failed"
  | "browser_bootstrap_failed"
  | "workbench_ready_failed"
  | "unknown";
type CodeServerInstallArtifactKind = "file" | "directory";
type CodeServerDependencyKind = "required" | "optional";
type CodeServerBrowserDiagnosticType =
  | "bootstrap-started"
  | "shell-loaded"
  | "websocket-open"
  | "websocket-error"
  | "websocket-close"
  | "workbench-mounted"
  | "bootstrap-timeout"
  | "frontend-stalled"
  | "extension-host-stalled"
  | "resource-error"
  | "resource-mime-mismatch"
  | "asset-404"
  | "asset-missing"
  | "csp-violation"
  | "service-worker"
  | "service-worker-ready"
  | "service-worker-controller-change"
  | "service-worker-error"
  | "iframe-loaded"
  | "iframe-error"
  | "iframe-visibility"
  | "iframe-timeout"
  | "iframe-ready"
  | "iframe-failure"
  | "worker-created"
  | "worker-error"
  | "javascript-error"
  | "unhandled-rejection"
  | "readonly-guard"
  | "theme-sync"
  | "custom";
type CodeServerBrowserDiagnosticLevel = "info" | "warn" | "error";
type CodeServerReadonlyPolicyMode = "off" | "readonly" | "view";
type CodeServerReadonlyFilesystemMode = "auto" | "off" | "require";
type CodeServerReadonlyFilesystemBoundary = "bubblewrap" | "none" | "systemd";
type CodeServerBrowserDiagnosticsTransportMode = "memory" | "callback" | "postmessage" | "http-post";
type CodeServerEmbedState = "idle" | "loading" | "ready" | "failed" | "stalled";
type CodeServerEmbedMessageType = "status" | "ready" | "failure" | "visibility" | "still-loading" | "theme";
type CodeServerReadonlyBrowserActionKind =
  | "beforeinput"
  | "command"
  | "command-uri"
  | "drop"
  | "label"
  | "paste"
  | "selector"
  | "shortcut"
  | "upload";
type CodeServerReadonlyBrowserActionSource =
  | "banner"
  | "command-palette"
  | "context-menu"
  | "keyboard"
  | "link"
  | "notification"
  | "unknown"
  | "widget";
type CodeServerBrowserFailureCategory =
  | "shell-loaded-but-workbench-never-mounted"
  | "websocket-ready-but-frontend-stalled"
  | "browser-bootstrap-started-but-workbench-never-mounted"
  | "static-asset-root-mismatch"
  | "missing-support-files"
  | "csp-blocked-bootstrap"
  | "worker-bootstrap-failed"
  | "iframe-load-failed"
  | "mime-type-mismatch"
  | "extension-host-stalled"
  | "unknown";

type CodeServerKitLogMethod = LoggerAdapterLogMethod;
type CodeServerKitLogEvent = LoggerAdapterEvent;
type CodeServerKitGenericLogMethod = LoggerAdapterGenericLogMethod;
type CodeServerKitLogger = LoggerAdapterLogger;
type CodeServerKitLoggerAdapter = LoggerAdapterWriter;
type NormalizedCodeServerKitLogger = NormalizedLoggerAdapter;

export type {
  CodeServerBrowserDiagnosticLevel,
  CodeServerBrowserDiagnosticsTransportMode,
  CodeServerBrowserDiagnosticType,
  CodeServerBrowserFailureCategory,
  CodeServerDependencyKind,
  CodeServerDiagnosticCategory,
  CodeServerEmbedMessageType,
  CodeServerEmbedState,
  CodeServerEntryKind,
  CodeServerInstallArtifactKind,
  CodeServerKitGenericLogMethod,
  CodeServerKitLogEvent,
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerKitLogMethod,
  CodeServerLaunchMode,
  CodeServerLaunchStrategy,
  CodeServerLifecyclePhase,
  CodeServerPathAccessMode,
  CodeServerPreparationMode,
  CodeServerPreparationState,
  CodeServerProfileItem,
  CodeServerProfilePersistPolicy,
  CodeServerProfileRestorePolicy,
  CodeServerProfileSignatureMode,
  CodeServerReadinessState,
  CodeServerReadinessTarget,
  CodeServerReadonlyBrowserActionKind,
  CodeServerReadonlyBrowserActionSource,
  CodeServerReadonlyFilesystemBoundary,
  CodeServerReadonlyFilesystemMode,
  CodeServerReadonlyPolicyMode,
  CodeServerRepairOutcome,
  CodeServerSessionHealth,
  CodeServerSessionState,
  CodeServerSystemdScope,
  CodeServerWatchdogMode,
  NormalizedCodeServerKitLogger,
};
