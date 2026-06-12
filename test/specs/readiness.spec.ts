import net from "node:net";

import { describe, expect, test } from "bun:test";

import {
  CodeServerProcessExitedBeforeReadyError,
  CodeServerStartupProbeError,
  CodeServerStartupTimeoutError,
  createSessionDiagnosticsBridge,
  waitForCodeServerReady,
} from "../../src/index.js";
import { closeServer, getFreePort, sleep } from "./helpers.js";

describe("@trebired/code-server-kit readiness", () => {
  test("waits until the TCP port starts accepting connections", async () => {
    const port = await getFreePort();
    const server = net.createServer((socket) => {
      socket.end();
    });

    setTimeout(() => {
      server.listen(port, "127.0.0.1");
    }, 120);

    try {
      const ready = await waitForCodeServerReady({
        host: "127.0.0.1",
        port,
        retryIntervalMs: 25,
        target: "tcp",
        timeoutMs: 2_000,
      });

      expect(ready.host).toBe("127.0.0.1");
      expect(ready.port).toBe(port);
      expect(ready.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      if (server.listening) {
        await closeServer(server);
      } else {
        await sleep(200);
        if (server.listening) {
          await closeServer(server);
        }
      }
    }
  });

  test("throws a structured startup timeout when the port never opens", async () => {
    const port = await getFreePort();

    await expect(waitForCodeServerReady({
      host: "127.0.0.1",
      port,
      retryIntervalMs: 20,
      target: "http",
      timeoutMs: 120,
    })).rejects.toBeInstanceOf(CodeServerStartupTimeoutError);
  });

  test("throws a structured exit error when the process dies before readiness", async () => {
    const port = await getFreePort();
    const processHandle = {
      args: [],
      bindAddr: `127.0.0.1:${port}`,
      child: null as any,
      codeServerPackageRoot: "/tmp/fake",
      command: "/tmp/fake/bin/code-server",
      cwd: "/tmp/fake",
      env: {},
      exit: (async () => {
        await sleep(60);
        return {
          code: 1,
          signal: null,
        };
      })(),
      extensionsDir: "/tmp/fake/extensions",
      getStderr() {
        return "fatal";
      },
      getStdout() {
        return "booting";
      },
      host: "127.0.0.1",
      kill() {
        return true;
      },
      launchMode: "direct" as const,
      pid: 123,
      plan: null as any,
      port,
      supportRoot: null,
      userDataDir: "/tmp/fake/user-data",
      workspacePath: null,
    };

    await expect(waitForCodeServerReady({
      host: "127.0.0.1",
      port,
      process: processHandle,
      retryIntervalMs: 20,
      target: "http",
      timeoutMs: 500,
    })).rejects.toBeInstanceOf(CodeServerProcessExitedBeforeReadyError);
  });

  test("throws a structured probe error when a caller-provided failure probe fires first", async () => {
    const port = await getFreePort();

    await expect(waitForCodeServerReady({
      failureProbe({ elapsedMs }) {
        if (elapsedMs > 40) {
          return {
            details: {
              phase: "boot",
            },
            message: "probe failed",
          };
        }

        return null;
      },
      host: "127.0.0.1",
      port,
      retryIntervalMs: 20,
      target: "http",
      timeoutMs: 400,
    })).rejects.toBeInstanceOf(CodeServerStartupProbeError);
  });

  test("supports browser-shell readiness through the diagnostics bridge", async () => {
    const port = await getFreePort();
    const bridge = createSessionDiagnosticsBridge();
    const server = net.createServer((socket) => {
      socket.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok");
    });
    server.listen(port, "127.0.0.1");

    setTimeout(() => {
      bridge.recordEvent({
        summary: "shell loaded",
        type: "shell-loaded",
      });
    }, 100);

    try {
      const ready = await waitForCodeServerReady({
        browser: {
          bridge,
        },
        host: "127.0.0.1",
        port,
        retryIntervalMs: 20,
        target: "browser-shell",
        timeoutMs: 1_000,
      });

      expect(ready.target).toBe("browser-shell");
      expect(ready.checkpoints.some((checkpoint) => checkpoint.target === "http")).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  test("fails workbench readiness when browser bootstrap times out", async () => {
    const port = await getFreePort();
    const bridge = createSessionDiagnosticsBridge();
    const server = net.createServer((socket) => {
      socket.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok");
    });
    server.listen(port, "127.0.0.1");

    setTimeout(() => {
      bridge.recordEvent({
        level: "error",
        summary: "bootstrap timed out",
        type: "bootstrap-timeout",
      });
    }, 80);

    try {
      await expect(waitForCodeServerReady({
        browser: {
          bridge,
        },
        host: "127.0.0.1",
        port,
        retryIntervalMs: 20,
        target: "workbench",
        timeoutMs: 500,
      })).rejects.toBeInstanceOf(CodeServerStartupProbeError);
    } finally {
      await closeServer(server);
    }
  });
});
