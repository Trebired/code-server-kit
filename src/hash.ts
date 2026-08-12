import { createHash } from "node:crypto";

function hashJsonValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export { hashJsonValue };
