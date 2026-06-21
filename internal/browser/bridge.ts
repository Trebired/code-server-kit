import { CodeServerStartupProbeError } from "#sm030wd0nb8l";
import { resolveLogger } from "#x0glhnlu9a7x";
import { classifyCodeServerBrowserFailure } from "./classification.js";
import { browserReadinessPolicy } from "./policy.js";
import { isFailureEvent, parseBrowserDiagnosticEvent } from "./shared.js";
import type {
  CodeServerBrowserDiagnosticEvent,
  CodeServerReadinessTarget,
  CodeServerSessionDiagnosticsBridge,
  CreateCodeServerSessionDiagnosticsBridgeOptions,
} from "#gk2pmrelxtj4";

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
    getEvents: () => [...events],
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
        return Promise.resolve({ elapsedMs: 0, event: existing, target });
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
          const classified = classifyCodeServerBrowserFailure(events);
          reject(new CodeServerStartupProbeError(classified.summary, {
            browserEvents: [...events],
            hints: [classified.hint],
            phase: classified.relevantEvent?.phase ?? "browser-bootstrap",
            retryable: classified.retryable,
            target,
          }));
        }, waitOptions.timeoutMs ?? browserReadinessPolicy(options.policy).bootstrapTimeoutMs);

        const waiter = { reject, resolve, startedAt, target, timer };
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

export { createSessionDiagnosticsBridge };
