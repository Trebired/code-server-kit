import { escapeHtmlAttribute } from "./shared.js";
import type { CreateHtmlInjectionPlanOptions } from "#gk2pmrelxtj4";

function createHtmlInjectionPlan(options: CreateHtmlInjectionPlanOptions) {
  const strategy = options.strategy ?? "append-body";
  const script = options.script.trim();
  const nonce = options.nonce?.trim();
  const marker = "data-trebired-code-server-kit=\"browser-bridge\"";
  const snippet = nonce
    ? `<script ${marker} nonce="${escapeHtmlAttribute(nonce)}">${script}</script>`
    : `<script ${marker}>${script}</script>`;
  const markers = strategy === "append-body"
    ? [marker, "</body>", "</html>"]
    : [marker, "<head>", "<html>"];

  return {
    apply(html: string): string {
      if (html.includes(marker)) {
        return html;
      }

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

export { createHtmlInjectionPlan };
