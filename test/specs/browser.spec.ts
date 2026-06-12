import { describe, expect, test } from "bun:test";

import {
  browserReadinessPolicy,
  createBrowserDiagnosticsScript,
  createHtmlInjectionPlan,
  parseBrowserDiagnosticEvent,
} from "../../src/index.js";

describe("@trebired/code-server-kit browser", () => {
  test("builds a generic browser diagnostics script", () => {
    const script = createBrowserDiagnosticsScript({
      bridgeProperty: "__bridge__",
      sessionKey: "demo",
    });

    expect(script).toContain("__bridge__");
    expect(script).toContain("workbench-mounted");
    expect(script).toContain("bootstrap-timeout");
  });

  test("creates an HTML injection plan for proxied shell pages", () => {
    const plan = createHtmlInjectionPlan({
      script: "window.test=true;",
    });

    expect(plan.apply("<html><body>Hello</body></html>")).toContain("<script>window.test=true;</script></body>");
  });

  test("parses and sanitizes browser diagnostic events", () => {
    const event = parseBrowserDiagnosticEvent({
      details: {
        path: "/srv/workspaces/demo",
      },
      summary: "resource failed at /srv/workspaces/demo",
      type: "resource-error",
    }, {
      pathPrefixes: ["/srv/workspaces/demo"],
    });

    expect(event.phase).toBe("browser-bootstrap");
    expect(event.summary).toContain("<redacted-path>");
    expect(String(event.details.path)).toContain("<redacted-path>");
  });

  test("normalizes browser readiness policy defaults", () => {
    const policy = browserReadinessPolicy({
      target: "browser-shell",
    });

    expect(policy.target).toBe("browser-shell");
    expect(policy.workbenchSelectors.length).toBeGreaterThan(0);
  });
});
