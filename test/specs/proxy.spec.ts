import { describe, expect, test } from "bun:test";

import {
  buildCodeServerWebSocketHeaders,
  CodeServerInvalidConfigurationError,
  buildForwardedHeaders,
  classifyCodeServerProxyFailure,
  createCodeServerProxyAdapter,
  isCodeServerHtmlResponse,
  normalizeTrustedOrigin,
  normalizeTrustedOrigins,
} from "#c0ucu2gxeffq";

describe("@trebired/code-server-kit proxy", () => {
  test("builds forwarded headers for reverse-proxy embedding", () => {
    expect(buildForwardedHeaders({
      forwardedFor: ["10.0.0.1", "10.0.0.2"],
      host: "app.example.com",
      port: 443,
      proto: "https",
    })).toEqual({
      "forwarded": "proto=https;host=app.example.com",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
    });
  });

  test("normalizes trusted origins and rejects invalid values", () => {
    expect(normalizeTrustedOrigins([
      "https://app.example.com",
      "https://app.example.com/",
      "https://admin.example.com/path",
    ])).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);

    expect(() => normalizeTrustedOrigin("not-an-origin")).toThrow(CodeServerInvalidConfigurationError);
  });

  test("identifies html responses that may need transformation", () => {
    expect(isCodeServerHtmlResponse({
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      method: "GET",
      statusCode: 200,
    })).toBe(true);

    expect(isCodeServerHtmlResponse({
      contentType: "application/json",
      method: "GET",
      statusCode: 200,
    })).toBe(false);
  });

  test("builds websocket upgrade headers for proxying code-server", () => {
    expect(buildCodeServerWebSocketHeaders({
      forwardedFor: "10.0.0.1",
      host: "app.example.com",
      proto: "https",
    })).toEqual({
      "connection": "Upgrade",
      "forwarded": "proto=https;host=app.example.com",
      "upgrade": "websocket",
      "x-forwarded-for": "10.0.0.1",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    });
  });

  test("classifies common upstream proxy failures", () => {
    expect(classifyCodeServerProxyFailure({
      error: {
        code: "ECONNREFUSED",
      },
    }).category).toBe("refused");

    expect(classifyCodeServerProxyFailure({
      error: {
        code: "ETIMEDOUT",
      },
    }).category).toBe("timeout");
  });

  test("owns HTML transform vs passthrough proxy response branching", async () => {
    const proxy = createCodeServerProxyAdapter({
      browser: {
        diagnostics: {
          bridgeProperty: "__bridge__",
        },
      },
      readonly: {
        enabled: true,
        mode: "view",
      },
    });

    const transformed = await proxy.handleResponse({
      body: "<html><head></head><body></body></html>",
      headers: {
        "content-encoding": "gzip",
        "content-length": "123",
        "content-type": "text/html; charset=utf-8",
      },
      method: "GET",
      pathname: "/",
      statusCode: 200,
    });
    const passthrough = await proxy.handleResponse({
      body: "{\"ok\":true}",
      headers: {
        "content-type": "application/json",
      },
      method: "GET",
      pathname: "/healthz",
      statusCode: 200,
    });

    expect(transformed.classification.kind).toBe("transform");
    expect(transformed.body).toContain("__bridge__");
    expect(transformed.headers["content-encoding"]).toBeUndefined();
    expect(transformed.headers["content-length"]).toBeUndefined();
    expect(passthrough.classification.kind).toBe("passthrough");
    expect(passthrough.body).toBe("{\"ok\":true}");
  });

  test("can neutralize a service worker route through the proxy adapter", async () => {
    const proxy = createCodeServerProxyAdapter({
      serviceWorker: {
        mode: "neutralize",
        pathname: "/service-worker.js",
      },
    });

    const overridden = await proxy.handleResponse({
      body: "original",
      headers: {
        "content-type": "application/javascript",
      },
      method: "GET",
      pathname: "/service-worker.js",
      statusCode: 200,
    });

    expect(overridden.classification.kind).toBe("service-worker-override");
    expect(overridden.body).toContain("self.skipWaiting");
    expect(overridden.headers["content-type"]).toContain("application/javascript");
  });
});
