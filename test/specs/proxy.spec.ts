import { describe, expect, test } from "bun:test";

import {
  CodeServerInvalidConfigurationError,
  buildForwardedHeaders,
  isCodeServerHtmlResponse,
  normalizeTrustedOrigin,
  normalizeTrustedOrigins,
} from "../../src/index.js";

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
});
