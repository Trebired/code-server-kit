import { CodeServerStartupProbeError } from "#sm030wd0nb8l";
import { resolveLogger } from "#x0glhnlu9a7x";
import { DEFAULT_EMBED_CHANNEL } from "./constants.js";
import { parseEmbedMessage, normalizePositiveInteger } from "./shared.js";
import { createBrowserDiagnosticsTransport } from "./transport.js";
import type {
  CodeServerEmbedController,
  CodeServerEmbedControllerOptions,
  CodeServerEmbedMessage,
  CodeServerEmbedMessageType,
  CodeServerEmbedState,
} from "#gk2pmrelxtj4";

function createCodeServerEmbedController(
  options: CodeServerEmbedControllerOptions = {},
): CodeServerEmbedController {
  const channel = options.channel ?? DEFAULT_EMBED_CHANNEL;
  const loadTimeoutMs = normalizePositiveInteger(options.loadTimeoutMs, 15_000);
  const targetOrigin = options.targetOrigin ?? "*";
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const events: CodeServerEmbedMessage[] = [];
  const waiters = new Set<{
    reject(error: Error): void;
    resolve(message: CodeServerEmbedMessage): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const state = {
    lastMessage: null as CodeServerEmbedMessage | null,
    ready: false,
    state: "idle" as CodeServerEmbedState,
    targetOrigin,
    visible: true,
  };

  const push = (message: CodeServerEmbedMessage) => {
    events.push(message);
    state.lastMessage = message;
    log.info("browser:embed", `Embed ${message.type}`, {
      channel: message.channel,
      payload: message.payload,
      type: message.type,
    });

    if (message.type === "ready") {
      state.ready = true;
      state.state = "ready";
      for (const waiter of [...waiters]) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(message);
      }
      return;
    }

    if (message.type === "failure") {
      state.ready = false;
      state.state = "failed";
      for (const waiter of [...waiters]) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.reject(new CodeServerStartupProbeError("Embedded code-server reported a browser-side failure.", {
          channel,
          payload: message.payload,
          phase: "browser-bootstrap",
        }));
      }
      return;
    }

    if (message.type === "still-loading") {
      state.state = "stalled";
      return;
    }

    if (message.type === "visibility") {
      state.visible = message.payload.visible !== false;
      return;
    }

    state.state = "loading";
  };

  return {
    createChildTransport() {
      return createBrowserDiagnosticsTransport({
        messageType: "trebired:code-server-diagnostics",
        mode: "postmessage",
        targetOrigin,
      });
    },
    createStatusMessage(type: CodeServerEmbedMessageType, payload = {}) {
      return {
        channel,
        payload,
        timestamp: new Date().toISOString(),
        type,
      };
    },
    getState() {
      return {
        events: [...events],
        lastMessage: state.lastMessage,
        ready: state.ready,
        state: state.state,
        targetOrigin: state.targetOrigin,
        visible: state.visible,
      };
    },
    handleMessage(data) {
      const message = parseEmbedMessage(data, channel, options.sanitizer);
      if (!message) return null;
      push(message);
      return message;
    },
    recordVisibility(visible) {
      const message = {
        channel,
        payload: { visible },
        timestamp: new Date().toISOString(),
        type: "visibility" as CodeServerEmbedMessageType,
      };
      push(message);
      return message;
    },
    waitForReady(waitOptions = {}) {
      if (state.ready && state.lastMessage) {
        return Promise.resolve(state.lastMessage);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new CodeServerStartupProbeError("Timed out waiting for the embedded code-server frame to report ready.", {
            channel,
            loadTimeoutMs,
            phase: "browser-bootstrap",
            targetOrigin,
          }));
        }, normalizePositiveInteger(waitOptions.timeoutMs, loadTimeoutMs));

        const waiter = { reject, resolve, timer };
        waiters.add(waiter);
      });
    },
  };
}

export { createCodeServerEmbedController };
