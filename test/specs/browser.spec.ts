import { expect, test } from "bun:test";

import {
  browserReadinessPolicy,
  classifyCodeServerBrowserFailure,
  createBrowserDiagnosticsScript,
  createCodeServerBrowserBridge,
  createBrowserDiagnosticsTransport,
  createCodeServerBrowserIntegration,
  createCodeServerEmbedController,
  createHtmlInjectionPlan,
  createReadonlyBrowserPolicy,
  evaluateReadonlyBrowserAction,
  injectCodeServerBrowserBridgeHtml,
  parseBrowserDiagnosticEvent,
  summarizeCodeServerBrowserDiagnostics,
  transformCodeServerHtml,
} from "#c0ucu2gxeffq";

test("builds a richer browser diagnostics script", () => {
    const script = createBrowserDiagnosticsScript({
      bridgeProperty: "__bridge__",
      embed: {
        channel: "demo",
        enableParentStatus: true,
      },
      readonly: true,
      sessionKey: "demo",
      theme: {
        initialTheme: "dark",
      },
      transport: {
        endpointUrl: "https://example.test/diagnostics",
        mode: "http-post",
      },
    });

    expect(script).toContain("__bridge__");
    expect(script).toContain("resource-mime-mismatch");
    expect(script).toContain("iframe-timeout");
    expect(script).toContain("readonly browser policy blocked an action");
    expect(script).toContain("command URI");
    expect(script).toContain("patchReadonlyLinkClicks");
    expect(script).toContain("https://example.test/diagnostics");
    expect(script).toContain("theme synchronized");
});

test("creates an HTML injection plan with nonce support", () => {
    const plan = createHtmlInjectionPlan({
      nonce: "nonce-123",
      script: "window.test=true;",
    });

    expect(plan.apply("<html><body>Hello</body></html>")).toContain("<script data-trebired-code-server-kit=\"browser-bridge\" nonce=\"nonce-123\">window.test=true;</script></body>");
});

test("keeps browser bridge HTML injection idempotent", () => {
    const once = injectCodeServerBrowserBridgeHtml({
      diagnostics: {
        bridgeProperty: "__bridge__",
      },
      html: "<html><head></head><body></body></html>",
      readonly: {
        enabled: true,
        mode: "view",
      },
    });
    const twice = injectCodeServerBrowserBridgeHtml({
      diagnostics: {
        bridgeProperty: "__bridge__",
      },
      html: once,
      readonly: {
        enabled: true,
        mode: "view",
      },
    });

    expect(once).toBe(twice);
    expect((once.match(/data-trebired-code-server-kit="browser-bridge"/g) ?? []).length).toBe(1);
});

test("transforms proxied HTML with diagnostics, readonly, and appearance hooks", () => {
    const html = transformCodeServerHtml({
      appearance: {
        bodyData: {
          session: "demo",
        },
        faviconHref: "/favicon.ico",
        title: "Readonly IDE",
      },
      cspNonce: "nonce-1",
      diagnostics: {
        bridgeProperty: "__bridge__",
        transport: {
          mode: "postmessage",
        },
      },
      html: "<html><head><title>Original</title><script type=\"module\"></script></head><body></body></html>",
      readonly: true,
      stripEmptyModuleScripts: true,
    });

    expect(html).toContain("nonce=\"nonce-1\"");
    expect(html).toContain("__bridge__");
    expect(html).toContain("Readonly IDE");
    expect(html).toContain("data-session=\"demo\"");
    expect(html).toContain("favicon.ico");
    expect(html).not.toContain("<script type=\"module\"></script>");
});

test("parses and sanitizes browser diagnostic events", () => {
    const event = parseBrowserDiagnosticEvent({
      details: {
        path: "/srv/workspaces/demo",
        resourceUrl: "https://example.test/srv/workspaces/demo/static/workbench.js",
      },
      summary: "resource failed at /srv/workspaces/demo",
      type: "resource-error",
    }, {
      pathPrefixes: ["/srv/workspaces/demo"],
    });

    expect(event.phase).toBe("browser-bootstrap");
    expect(event.summary).toContain("<redacted-path>");
    expect(String(event.details.path)).toContain("<redacted-path>");
    expect(String(event.details.resourceUrl)).toContain("<redacted-path>");
});

test("normalizes browser readiness policy defaults", () => {
    const policy = browserReadinessPolicy({
      target: "browser-shell",
    });

    expect(policy.target).toBe("browser-shell");
    expect(policy.workbenchSelectors.length).toBeGreaterThan(0);
    expect(policy.shellSelectors?.length).toBeGreaterThan(0);
    expect(policy.stallTimeoutMs).toBeGreaterThan(0);
});

test("normalizes readonly browser policy and blocks risky actions", () => {
    const policy = createReadonlyBrowserPolicy(true);
    const commandBlock = evaluateReadonlyBrowserAction(policy, {
      commandId: "workbench.action.files.save",
      kind: "command",
    });
    const shortcutBlock = evaluateReadonlyBrowserAction(policy, {
      kind: "shortcut",
      shortcut: "Ctrl+S",
    });

    expect(policy.browserGuards.blockUpload).toBe(true);
    expect(policy.browserGuards.blockCommandLinks).toBe(true);
    expect(policy.filesystem.mode).toBe("auto");
    expect(commandBlock.blocked).toBe(true);
    expect(shortcutBlock.blocked).toBe(true);
    expect(shortcutBlock.reason).toContain("shortcut");
});

test("blocks command URI links and writable-session promotion flows", () => {
    const policy = createReadonlyBrowserPolicy(true);
    const commandUriBlock = evaluateReadonlyBrowserAction(policy, {
      href: "command:workbench.action.files.setActiveEditorWriteableInSession",
      kind: "command-uri",
      source: "notification",
    });
    const writablePromotionBlock = evaluateReadonlyBrowserAction(policy, {
      commandId: "workbench.action.files.toggleActiveEditorReadonlyInSession",
      kind: "command",
      source: "widget",
    });

    expect(commandUriBlock.blocked).toBe(true);
    expect(commandUriBlock.reason).toContain("command URI");
    expect(writablePromotionBlock.blocked).toBe(true);
    expect(writablePromotionBlock.reason).toContain("blocked");
});

test("creates a high-level browser bridge with readonly view mode", () => {
    const bridge = createCodeServerBrowserBridge({
      diagnostics: {
        bridgeProperty: "__bridge__",
      },
      readonly: {
        enabled: true,
        mode: "view",
      },
      sessionKey: "readonly-demo",
    });

    const html = bridge.injectHtml({
      html: "<html><head></head><body><input type=\"file\"></body></html>",
    });
    const blocked = evaluateReadonlyBrowserAction(bridge.readonlyPolicy, {
      kind: "upload",
      selector: "input[type='file']",
    });

    expect(bridge.readonlyPolicy.mode).toBe("view");
    expect(blocked.blocked).toBe(true);
    expect(html).toContain("__bridge__");
    expect(html).toContain("readonly browser policy blocked an action");
});

test("classifies stalled browser readiness and builds summaries", () => {
    const events = [
      parseBrowserDiagnosticEvent({
        details: {},
        summary: "shell",
        type: "shell-loaded",
      }),
      parseBrowserDiagnosticEvent({
        details: {
          resourceUrl: "/static/out/vs/workbench/workbench.js",
        },
        summary: "socket ready",
        type: "websocket-open",
      }),
      parseBrowserDiagnosticEvent({
        details: {
          timeoutMs: 8000,
        },
        summary: "frontend stalled",
        type: "frontend-stalled",
      }),
    ];

    const failure = classifyCodeServerBrowserFailure(events);
    const summary = summarizeCodeServerBrowserDiagnostics(events);

    expect(failure.category).toBe("websocket-ready-but-frontend-stalled");
    expect(summary.eventCategory).toBe("frontend-stalled");
    expect(summary.workbenchState).toBe("stalled");
    expect(summary.mostRelevantUrl).toContain("workbench.js");
});

test("buffers diagnostics and parses transport payloads", async () => {
    const transport = createBrowserDiagnosticsTransport({
      arrayName: "__TEST_BROWSER_EVENTS__",
      mode: "memory",
    });

    await transport.deliver(parseBrowserDiagnosticEvent({
      details: {},
      summary: "ready",
      type: "workbench-mounted",
    }));

    const globalEvents = (globalThis as Record<string, unknown>).__TEST_BROWSER_EVENTS__ as unknown[];
    const parsed = transport.parseMessage({
      events: [{
        details: {
          resourceUrl: "/static/out/vs/workbench/workbench.js",
        },
        summary: "missing asset",
        type: "asset-404",
      }],
    });

    expect(transport.getBufferedEvents()).toHaveLength(1);
    expect(globalEvents).toHaveLength(1);
    expect(parsed[0]?.type).toBe("asset-404");
});

test("creates a high-level browser integration that transforms HTML", () => {
    const integration = createCodeServerBrowserIntegration({
      diagnostics: {
        bridgeProperty: "__bridge__",
        transport: {
          mode: "callback",
        },
      },
      readonly: true,
      sessionKey: "demo",
    });

    const html = integration.transformHtml({
      html: "<html><head></head><body></body></html>",
    });
    const script = integration.createScript();

    expect(integration.readonlyPolicy.enabled).toBe(true);
    expect(html).toContain("__bridge__");
    expect(script).toContain("callback");
});

test("tracks embed readiness through the iframe controller", async () => {
    const controller = createCodeServerEmbedController({
      channel: "frame",
      loadTimeoutMs: 1_000,
    });
    const waiting = controller.waitForReady();

    controller.handleMessage({
      channel: "frame",
      payload: {
        state: "ready",
      },
      timestamp: new Date().toISOString(),
      type: "ready",
    });

    const ready = await waiting;
    expect(ready.type).toBe("ready");
    expect(controller.getState().state).toBe("ready");
});

test("tracks embed failures and visibility updates", () => {
    const controller = createCodeServerEmbedController({
      channel: "frame",
    });

    controller.recordVisibility(false);
    controller.handleMessage({
      channel: "frame",
      payload: {
        reason: "timeout",
      },
      timestamp: new Date().toISOString(),
      type: "failure",
    });

    expect(controller.getState().visible).toBe(false);
    expect(controller.getState().state).toBe("failed");
});
