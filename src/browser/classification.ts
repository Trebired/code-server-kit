import { extractRelevantUrl, isFailureEvent } from "./shared.js";
import type {
  CodeServerBrowserDiagnosticEvent,
  CodeServerBrowserDiagnosticsSummary,
  CodeServerBrowserFailure,
} from "../types.js";

function summarizeCodeServerBrowserDiagnostics(
  events: CodeServerBrowserDiagnosticEvent[] = [],
): CodeServerBrowserDiagnosticsSummary {
  const counts: Record<string, number> = {};
  let mostRelevantUrl: string | null = null;
  const selectors = new Set<string>();
  let frameState: CodeServerBrowserDiagnosticsSummary["frameState"] = "unknown";
  let workbenchState: CodeServerBrowserDiagnosticsSummary["workbenchState"] = "unknown";

  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    const url = extractRelevantUrl(event.details);
    if (url) mostRelevantUrl = url;
    if (typeof event.details.selector === "string") selectors.add(event.details.selector);

    if (event.type === "iframe-ready") frameState = "ready";
    else if (event.type === "iframe-visibility" && event.details.visible === false) frameState = "hidden";
    else if (event.type === "iframe-timeout" || event.type === "iframe-error" || event.type === "iframe-failure") frameState = "failed";
    else if (event.type === "iframe-loaded") frameState = "loading";

    if (event.type === "workbench-mounted") workbenchState = "mounted";
    else if (event.type === "frontend-stalled" || event.type === "extension-host-stalled" || event.type === "bootstrap-timeout") workbenchState = "stalled";
    else if (event.type === "shell-loaded" || event.type === "websocket-open") workbenchState = "loading";
  }

  const failure = classifyCodeServerBrowserFailure(events);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;

  return {
    counts,
    eventCategory: lastEvent?.type ?? "none",
    failureHint: lastEvent && isFailureEvent(lastEvent) ? failure.hint : null,
    frameState,
    mostRelevantUrl,
    retryable: failure.retryable,
    selectors: [...selectors],
    workbenchState,
  };
}

function classifyCodeServerBrowserFailure(
  events: CodeServerBrowserDiagnosticEvent[] = [],
): CodeServerBrowserFailure {
  const latest = events.length > 0 ? events[events.length - 1] : null;
  const match = (...types: CodeServerBrowserDiagnosticEvent["type"][]) => [...events].reverse().find((event) => types.includes(event.type)) ?? null;

  const csp = match("csp-violation");
  if (csp) return failure("csp-blocked-bootstrap", "Browser bootstrap was blocked by Content Security Policy.", "Inspect your CSP nonce, inline-script policy, and worker restrictions.", false, csp);

  const mimeMismatch = match("resource-mime-mismatch");
  if (mimeMismatch) return failure("mime-type-mismatch", "code-server assets loaded with the wrong MIME type.", "Check proxy content-type rewriting for code-server JavaScript and WASM assets.", false, mimeMismatch);

  const iframeFailure = match("iframe-failure", "iframe-error", "iframe-timeout");
  if (iframeFailure) return failure("iframe-load-failed", "The embedded code-server iframe failed to finish loading.", "Inspect iframe embedding, visibility, and parent-child messaging setup.", true, iframeFailure);

  const workerFailure = match("worker-error");
  if (workerFailure) return failure("worker-bootstrap-failed", "A browser worker failed during code-server bootstrap.", "Check worker asset paths, CSP worker-src rules, and proxy rewrites.", false, workerFailure);

  const extensionHost = match("extension-host-stalled");
  if (extensionHost) return failure("extension-host-stalled", "The extension host appears stalled after websocket readiness.", "The frontend mounted networking but extension-host startup appears stalled.", true, extensionHost);

  const missingAsset = match("asset-missing", "asset-404");
  if (missingAsset) return failure("static-asset-root-mismatch", "Required code-server assets could not be loaded by the browser.", "Check static asset roots, support files, and proxy path rewriting for code-server assets.", false, missingAsset);

  const frontendStalled = match("frontend-stalled");
  if (frontendStalled && events.some((event) => event.type === "websocket-open")) {
    return failure("websocket-ready-but-frontend-stalled", "The browser connected to the websocket, then stalled before the workbench mounted.", "The websocket opened, but the frontend never finished bootstrapping.", true, frontendStalled);
  }

  const timeout = match("bootstrap-timeout");
  if (timeout && events.some((event) => event.type === "shell-loaded")) {
    return failure("shell-loaded-but-workbench-never-mounted", "The browser shell loaded, but the workbench never mounted.", "The shell HTML loaded, but the workbench never mounted. Check asset paths, CSP, and browser console failures.", true, timeout);
  }
  if (timeout) {
    return failure("browser-bootstrap-started-but-workbench-never-mounted", "The browser bootstrap timed out before code-server became usable.", "The browser bootstrap started but did not reach a mounted workbench before timeout.", true, timeout);
  }

  const resourceFailure = match("resource-error");
  if (resourceFailure) {
    return failure("missing-support-files", "A required browser resource failed during code-server bootstrap.", "A browser resource failed to load. Check support files, static assets, and proxy passthrough.", true, resourceFailure);
  }

  return {
    category: "unknown",
    hint: "Inspect browser diagnostic events for more detail.",
    relevantEvent: latest,
    retryable: latest?.retryable ?? true,
    summary: latest?.summary ?? "No browser failure has been classified.",
  };
}

function failure(
  category: CodeServerBrowserFailure["category"],
  summary: string,
  hint: string,
  retryable: boolean,
  relevantEvent: CodeServerBrowserDiagnosticEvent,
): CodeServerBrowserFailure {
  return {
    category,
    hint,
    relevantEvent,
    retryable,
    summary,
  };
}

export {
  classifyCodeServerBrowserFailure,
  summarizeCodeServerBrowserDiagnostics,
};
