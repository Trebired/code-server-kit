import { CodeServerStartupProbeError } from "./errors.js";
import { resolveLogger } from "./logging.js";
import type {
  CodeServerBrowserDiagnosticEvent,
  CodeServerBrowserDiagnosticsScriptOptions,
  CodeServerBrowserReadinessPolicy,
  CodeServerReadinessTarget,
  CodeServerReadonlyPolicyOptions,
  CodeServerSanitizerOptions,
  CodeServerSessionDiagnosticsBridge,
  CreateCodeServerSessionDiagnosticsBridgeOptions,
  CreateHtmlInjectionPlanOptions,
} from "./types.js";

const DEFAULT_BROWSER_POLICY: CodeServerBrowserReadinessPolicy = {
  bootstrapTimeoutMs: 20_000,
  target: "workbench",
  workbenchSelectors: [".monaco-workbench", ".workbench"],
};

function browserReadinessPolicy(
  options: Partial<CodeServerBrowserReadinessPolicy> = {},
): CodeServerBrowserReadinessPolicy {
  return {
    bootstrapTimeoutMs: normalizePositiveInteger(
      options.bootstrapTimeoutMs,
      DEFAULT_BROWSER_POLICY.bootstrapTimeoutMs,
    ),
    target: options.target ?? DEFAULT_BROWSER_POLICY.target,
    workbenchSelectors: normalizeSelectors(options.workbenchSelectors),
  };
}

function createBrowserDiagnosticsScript(
  options: CodeServerBrowserDiagnosticsScriptOptions = {},
): string {
  const policy = browserReadinessPolicy(options.policy);
  const bridgeProperty = options.bridgeProperty ?? "__TREBIRED_CODE_SERVER_DIAGNOSTICS__";
  const readonly = normalizeReadonlyOptions(options.readonly);

  return [
    "(function(){",
    `const bridgeProperty=${JSON.stringify(bridgeProperty)};`,
    `const policy=${JSON.stringify(policy)};`,
    `const readonly=${JSON.stringify(readonly)};`,
    "const seenShell={value:false};",
    "function emit(type, level, summary, details){",
    "  const payload={",
    "    type,",
    "    level,",
    "    summary,",
    "    details: details || {},",
    "    timestamp: new Date().toISOString()",
    "  };",
    "  try {",
    "    const bridge = window[bridgeProperty];",
    "    if (typeof bridge === 'function') bridge(payload);",
    "  } catch (error) {",
    "    console.warn('code-server-kit diagnostics bridge failed', error);",
    "  }",
    "}",
    "emit('bootstrap-started','info','browser diagnostics bootstrap started',{sessionKey:" +
      JSON.stringify(options.sessionKey ?? null) + "});",
    "function emitShellLoaded(){",
    "  if (seenShell.value) return;",
    "  seenShell.value = true;",
    "  emit('shell-loaded','info','browser shell loaded',{readyState: document.readyState});",
    "}",
    "if (document.readyState === 'interactive' || document.readyState === 'complete') emitShellLoaded();",
    "document.addEventListener('DOMContentLoaded', emitShellLoaded, { once: true });",
    "window.addEventListener('load', emitShellLoaded, { once: true });",
    "window.addEventListener('error', function(event){",
    "  const target = event.target;",
    "  if (target && target !== window) {",
    "    emit('resource-error','error','browser resource failed to load',{",
    "      tagName: target.tagName || null,",
    "      src: target.src || null,",
    "      href: target.href || null",
    "    });",
    "    return;",
    "  }",
    "  emit('javascript-error','error', String(event.message || 'browser error'), {",
    "    filename: event.filename || null,",
    "    line: event.lineno || null,",
    "    column: event.colno || null",
    "  });",
    "}, true);",
    "window.addEventListener('unhandledrejection', function(event){",
    "  emit('unhandled-rejection','error','browser promise rejection',{",
    "    reason: String(event.reason || 'unknown')",
    "  });",
    "});",
    "document.addEventListener('securitypolicyviolation', function(event){",
    "  emit('csp-violation','error','browser content security policy violation',{",
    "    blockedURI: event.blockedURI || null,",
    "    effectiveDirective: event.effectiveDirective || null",
    "  });",
    "});",
    "if (navigator.serviceWorker) {",
    "  navigator.serviceWorker.addEventListener('controllerchange', function(){",
    "    emit('service-worker','info','service worker controller changed',{});",
    "  });",
    "  navigator.serviceWorker.ready.then(function(registration){",
    "    emit('service-worker','info','service worker ready',{scope: registration.scope || null});",
    "  }).catch(function(error){",
    "    emit('service-worker','warn','service worker readiness failed',{message: String(error && error.message || error)});",
    "  });",
    "}",
    "if (typeof window.Worker === 'function') {",
    "  const NativeWorker = window.Worker;",
    "  window.Worker = function(url, options){",
    "    try {",
    "      const worker = new NativeWorker(url, options);",
    "      worker.addEventListener('error', function(){",
    "        emit('worker-error','error','worker error',{url: String(url)});",
    "      });",
    "      return worker;",
    "    } catch (error) {",
    "      emit('worker-error','error','worker construction failed',{url: String(url), message: String(error && error.message || error)});",
    "      throw error;",
    "    }",
    "  };",
    "  window.Worker.prototype = NativeWorker.prototype;",
    "}",
    "if (typeof window.WebSocket === 'function') {",
    "  const NativeWebSocket = window.WebSocket;",
    "  function DiagnosticWebSocket(url, protocols){",
    "    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);",
    "    socket.addEventListener('open', function(){",
    "      emit('websocket-open','info','browser websocket connected',{url: String(url)});",
    "    });",
    "    socket.addEventListener('error', function(){",
    "      emit('websocket-error','error','browser websocket error',{url: String(url)});",
    "    });",
    "    return socket;",
    "  }",
    "  DiagnosticWebSocket.prototype = NativeWebSocket.prototype;",
    "  DiagnosticWebSocket.CONNECTING = NativeWebSocket.CONNECTING;",
    "  DiagnosticWebSocket.OPEN = NativeWebSocket.OPEN;",
    "  DiagnosticWebSocket.CLOSING = NativeWebSocket.CLOSING;",
    "  DiagnosticWebSocket.CLOSED = NativeWebSocket.CLOSED;",
    "  window.WebSocket = DiagnosticWebSocket;",
    "}",
    "if (readonly.browserGuards.blockDragAndDrop) {",
    "  window.addEventListener('drop', function(event){",
    "    event.preventDefault();",
    "    emit('readonly-guard','warn','readonly guard blocked drop',{});",
    "  }, true);",
    "}",
    "const deadline = Date.now() + policy.bootstrapTimeoutMs;",
    "const selectors = Array.isArray(policy.workbenchSelectors) ? policy.workbenchSelectors : [];",
    "let workbenchMounted = false;",
    "function pollWorkbench(){",
    "  if (workbenchMounted) return;",
    "  for (const selector of selectors) {",
    "    if (selector && document.querySelector(selector)) {",
    "      workbenchMounted = true;",
    "      emit('workbench-mounted','info','browser workbench mounted',{selector});",
    "      return;",
    "    }",
    "  }",
    "  if (Date.now() >= deadline) {",
    "    emit('bootstrap-timeout','error','browser bootstrap timed out',{selectors, timeoutMs: policy.bootstrapTimeoutMs});",
    "    return;",
    "  }",
    "  window.setTimeout(pollWorkbench, 150);",
    "}",
    "pollWorkbench();",
    "})();",
  ].join("");
}

function parseBrowserDiagnosticEvent(
  value: unknown,
  sanitizer?: CodeServerSanitizerOptions,
): CodeServerBrowserDiagnosticEvent {
  const object = typeof value === "object" && value
    ? value as Record<string, unknown>
    : {};
  const event: CodeServerBrowserDiagnosticEvent = {
    details: sanitizeDetails(asRecord(object.details), sanitizer),
    level: normalizeLevel(object.level),
    phase: phaseForBrowserEvent(object.type),
    retryable: isRetryableBrowserEvent(object.type),
    summary: sanitizeText(String(object.summary ?? object.type ?? "browser diagnostic event"), sanitizer),
    timestamp: typeof object.timestamp === "string" ? object.timestamp : new Date().toISOString(),
    type: normalizeBrowserType(object.type),
  };

  return event;
}

function createHtmlInjectionPlan(options: CreateHtmlInjectionPlanOptions) {
  const strategy = options.strategy ?? "append-body";
  const script = options.script.trim();
  const snippet = `<script>${script}</script>`;
  const markers = strategy === "append-body"
    ? ["</body>", "</html>"]
    : ["<head>", "<html>"];

  return {
    apply(html: string): string {
      if (!html.includes("<html")) {
        return `${snippet}${html}`;
      }

      if (strategy === "append-body") {
        if (html.includes("</body>")) {
          return html.replace("</body>", `${snippet}</body>`);
        }
        if (html.includes("</html>")) {
          return html.replace("</html>", `${snippet}</html>`);
        }
        return `${html}${snippet}`;
      }

      if (html.includes("<head>")) {
        return html.replace("<head>", `<head>${snippet}`);
      }

      return `${snippet}${html}`;
    },
    markers,
    script,
    snippet,
    strategy,
  };
}

function createSessionDiagnosticsBridge(
  options: CreateCodeServerSessionDiagnosticsBridgeOptions = {},
): CodeServerSessionDiagnosticsBridge {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const events: CodeServerBrowserDiagnosticEvent[] = [];
  const waiters = new Set<{
    startedAt: number;
    target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">;
    resolve(value: {
      elapsedMs: number;
      event: CodeServerBrowserDiagnosticEvent;
      target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">;
    }): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  return {
    getEvents() {
      return [...events];
    },
    getSnapshot() {
      return {
        events: [...events],
        latestEvent: events.length > 0 ? events[events.length - 1] : null,
        readyTargets: uniqueReadyTargets(events),
      };
    },
    recordEvent(event: unknown) {
      const parsed = parseBrowserDiagnosticEvent(event, options.sanitizer);
      events.push(parsed);
      log.info("browser:diagnostic", parsed.summary, {
        details: parsed.details,
        level: parsed.level,
        phase: parsed.phase,
        type: parsed.type,
      });

      for (const waiter of [...waiters]) {
        if (matchesReadinessTarget(waiter.target, parsed)) {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          waiter.resolve({
            elapsedMs: Date.now() - waiter.startedAt,
            event: parsed,
            target: waiter.target,
          });
          continue;
        }

        if (isFailureEvent(parsed)) {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          waiter.reject(new CodeServerStartupProbeError(parsed.summary, {
            browserEvent: parsed,
            phase: parsed.phase,
          }));
        }
      }

      return parsed;
    },
    waitForTarget(target, waitOptions = {}) {
      const existing = events.find((event) => matchesReadinessTarget(target, event));
      if (existing) {
        return Promise.resolve({
          elapsedMs: 0,
          event: existing,
          target,
        });
      }

      const failure = events.find((event) => isFailureEvent(event));
      if (failure) {
        return Promise.reject(new CodeServerStartupProbeError(failure.summary, {
          browserEvent: failure,
          phase: failure.phase,
        }));
      }

      return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new CodeServerStartupProbeError("Timed out waiting for browser diagnostics readiness.", {
            browserEvents: [...events],
            target,
          }));
        }, normalizePositiveInteger(waitOptions.timeoutMs, browserReadinessPolicy(options.policy).bootstrapTimeoutMs));

        const waiter = {
          reject,
          resolve,
          startedAt,
          target,
          timer,
        };
        waiters.add(waiter);
      });
    },
  };
}

function uniqueReadyTargets(events: CodeServerBrowserDiagnosticEvent[]): CodeServerReadinessTarget[] {
  const targets = new Set<CodeServerReadinessTarget>();
  for (const event of events) {
    if (event.type === "websocket-open") targets.add("websocket");
    if (event.type === "shell-loaded") targets.add("browser-shell");
    if (event.type === "workbench-mounted") targets.add("workbench");
  }
  return [...targets];
}

function matchesReadinessTarget(
  target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">,
  event: CodeServerBrowserDiagnosticEvent,
): boolean {
  if (target === "websocket") return event.type === "websocket-open";
  if (target === "browser-shell") return event.type === "shell-loaded";
  return event.type === "workbench-mounted";
}

function isFailureEvent(event: CodeServerBrowserDiagnosticEvent): boolean {
  return event.type === "bootstrap-timeout" || (event.level === "error" && event.type !== "resource-error");
}

function normalizeSelectors(value?: string[]): string[] {
  const selectors = value?.map((item) => String(item).trim()).filter(Boolean) ?? [];
  return selectors.length > 0
    ? selectors
    : [...DEFAULT_BROWSER_POLICY.workbenchSelectors];
}

function normalizeReadonlyOptions(value?: CodeServerReadonlyPolicyOptions | boolean): Required<NonNullable<CodeServerReadonlyPolicyOptions>> {
  if (value === true) {
    return {
      browserGuards: {
        blockDragAndDrop: true,
      },
      enabled: true,
      settingsPatch: {},
    };
  }

  if (!value || typeof value !== "object") {
    return {
      browserGuards: {
        blockDragAndDrop: false,
      },
      enabled: false,
      settingsPatch: {},
    };
  }

  return {
    browserGuards: {
      blockDragAndDrop: value?.browserGuards?.blockDragAndDrop ?? false,
    },
    enabled: value?.enabled ?? false,
    settingsPatch: value?.settingsPatch ?? {},
  };
}

function normalizeLevel(value: unknown): CodeServerBrowserDiagnosticEvent["level"] {
  return value === "warn" || value === "error" || value === "info"
    ? value
    : "info";
}

function normalizeBrowserType(value: unknown): CodeServerBrowserDiagnosticEvent["type"] {
  switch (value) {
    case "bootstrap-started":
    case "shell-loaded":
    case "websocket-open":
    case "websocket-error":
    case "workbench-mounted":
    case "bootstrap-timeout":
    case "resource-error":
    case "csp-violation":
    case "service-worker":
    case "iframe-error":
    case "worker-error":
    case "javascript-error":
    case "unhandled-rejection":
    case "readonly-guard":
      return value;
    default:
      return "custom";
  }
}

function phaseForBrowserEvent(value: unknown): CodeServerBrowserDiagnosticEvent["phase"] {
  switch (value) {
    case "shell-loaded":
    case "resource-error":
    case "csp-violation":
    case "javascript-error":
    case "unhandled-rejection":
    case "service-worker":
    case "readonly-guard":
      return "browser-bootstrap";
    case "websocket-open":
    case "websocket-error":
      return "websocket-ready";
    case "workbench-mounted":
    case "bootstrap-timeout":
      return "workbench-ready";
    default:
      return "browser-bootstrap";
  }
}

function isRetryableBrowserEvent(value: unknown): boolean {
  return value === "websocket-error" || value === "bootstrap-timeout" || value === "resource-error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value ? value as Record<string, unknown> : {};
}

function sanitizeText(value: string, sanitizer?: CodeServerSanitizerOptions): string {
  if (!sanitizer) return value;

  let next = value;
  for (const prefix of sanitizer.pathPrefixes ?? []) {
    next = next.split(prefix).join("<redacted-path>");
  }
  for (const current of sanitizer.values ?? []) {
    next = next.split(current).join("<redacted>");
  }
  return sanitizer.replacer ? sanitizer.replacer(next) : next;
}

function sanitizeDetails(
  value: Record<string, unknown>,
  sanitizer?: CodeServerSanitizerOptions,
): Record<string, unknown> {
  if (!sanitizer) return value;
  return JSON.parse(sanitizeText(JSON.stringify(value), sanitizer)) as Record<string, unknown>;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export {
  browserReadinessPolicy,
  createBrowserDiagnosticsScript,
  createHtmlInjectionPlan,
  createSessionDiagnosticsBridge,
  parseBrowserDiagnosticEvent,
};
