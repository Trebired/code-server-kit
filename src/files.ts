import fs from "node:fs";
import path from "node:path";

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

function uniquePaths(values: Array<string|null|undefined>): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const nextValue = path.resolve(value);
    if (!normalized.includes(nextValue)) normalized.push(nextValue);
  }
  return normalized;
}

export {
  isDirectory,
  isFile,
  uniquePaths,
};
