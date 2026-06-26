import {
  CodeServerSystemdJournalError,
  CodeServerSystemdLaunchError,
  CodeServerSystemdStatusError,
} from "#8974ac53d713";
import { collectCodeServerStartupDiagnostics } from "#585f3a8d1af0";
import { resolveLogger } from "#5a29135e56c1";
import {
  buildDefaultCodeServerUnitName,
  createCodeServerSystemdLaunchCommand,
  normalizeSystemdScope,
  normalizeSystemdUnitName,
  parseSystemdShowOutput,
  runSystemCommand,
} from "./shared.js";
import type {
  CodeServerSystemdFailure,
  CodeServerSystemdJournalOptions,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdLaunchResult,
  CodeServerSystemdScope,
  CodeServerSystemdStatus,
  CodeServerSystemdStopOptions,
} from "#3c8d8166992a";

const DEFAULT_SYSTEMD_JOURNAL_LINES = 100;

async function launchCodeServerWithSystemd(options: CodeServerSystemdLaunchOptions): Promise<CodeServerSystemdLaunchResult> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const command = createCodeServerSystemdLaunchCommand(options);
  const existing = await safeReadStatus(command.scope, command.unitName);

  if (existing && !existing.notFound) {
    if (existing.reusable) {
      return {
        ...command,
        output: "reused existing unit",
      };
    }
    await stopCodeServerSystemdUnit({
      logger: options.logger,
      loggerAdapter: options.loggerAdapter,
      resetFailed: true,
      scope: command.scope,
      unitName: command.unitName,
    });
  }

  log.info("systemd", "launching code-server transient unit", {
    command: command.command,
    scope: command.scope,
    unitName: command.unitName,
  });

  try {
    const output = await runSystemCommand(command.command, command.args);
    return {
      ...command,
      output,
    };
  } catch (error) {
    throw new CodeServerSystemdLaunchError("Could not launch code-server with systemd-run.", {
      args: command.args,
      cause: error instanceof Error ? error.message : String(error),
      command: command.command,
      scope: command.scope,
      unitName: command.unitName,
    });
  }
}

async function restartCodeServerSystemdUnit(options: CodeServerSystemdStopOptions): Promise<void> {
  await stopCodeServerSystemdUnit({
    ...options,
    resetFailed: true,
  });
}

async function stopCodeServerSystemdUnit(options: CodeServerSystemdStopOptions): Promise<void> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const scopeFlag = options.scope === "user" ? "--user" : "--system";
  log.info("systemd", "stopping code-server transient unit", {
    resetFailed: options.resetFailed ?? false,
    scope: options.scope,
    unitName: options.unitName,
  });

  try {
    await runSystemCommand("systemctl", [scopeFlag, "stop", options.unitName]);
    if (options.resetFailed) {
      await runSystemCommand("systemctl", [scopeFlag, "reset-failed", options.unitName]);
    }
  } catch (error) {
    throw new CodeServerSystemdStatusError("Could not stop the code-server systemd unit.", {
      cause: error instanceof Error ? error.message : String(error),
      scope: options.scope,
      unitName: options.unitName,
    });
  }
}

async function readCodeServerSystemdStatus(options: {
  logger?: CodeServerSystemdLaunchOptions["logger"];
  loggerAdapter?: CodeServerSystemdLaunchOptions["loggerAdapter"];
  scope: CodeServerSystemdScope;
  unitName: string;
}): Promise<CodeServerSystemdStatus> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const scope = normalizeSystemdScope(options.scope);
  const unitName = normalizeSystemdUnitName(options.unitName);
  const scopeFlag = scope === "user" ? "--user" : "--system";

  log.info("systemd", "reading code-server systemd status", { scope, unitName });
  try {
    const output = await runSystemCommand("systemctl", [
      scopeFlag,
      "show",
      unitName,
      "--no-pager",
      "--property",
      "LoadState",
      "--property",
      "ActiveState",
      "--property",
      "SubState",
      "--property",
      "Result",
      "--property",
      "ExecMainPID",
    ]);
    return parseSystemdShowOutput(output, scope, unitName);
  } catch (error) {
    throw new CodeServerSystemdStatusError("Could not read the code-server systemd unit status.", {
      cause: error instanceof Error ? error.message : String(error),
      scope,
      unitName,
    });
  }
}

async function readCodeServerSystemdJournal(options: CodeServerSystemdJournalOptions): Promise<string> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const scope = normalizeSystemdScope(options.scope);
  const unitName = normalizeSystemdUnitName(options.unitName);
  const lines = options.lines ?? DEFAULT_SYSTEMD_JOURNAL_LINES;

  log.info("systemd", "reading code-server systemd journal", { lines, scope, unitName });
  try {
    return await runSystemCommand("journalctl", [
      scope === "user" ? "--user-unit" : "--unit",
      unitName,
      "--no-pager",
      "--output",
      "short",
      "-n",
      String(lines),
    ]);
  } catch (error) {
    throw new CodeServerSystemdJournalError("Could not read the code-server systemd journal.", {
      cause: error instanceof Error ? error.message : String(error),
      lines,
      scope,
      unitName,
    });
  }
}

async function summarizeCodeServerSystemdJournal(options: CodeServerSystemdJournalOptions): Promise<string> {
  const journal = await readCodeServerSystemdJournal(options);
  const lines = journal.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(lines.length - 10, 0)).join("\n");
}

async function extractCodeServerSystemdFailure(options: CodeServerSystemdJournalOptions): Promise<CodeServerSystemdFailure> {
  const summary = await summarizeCodeServerSystemdJournal(options);
  return {
    diagnostics: collectCodeServerStartupDiagnostics({
      category: "systemd_unit_failed",
      journal: summary,
      launchStrategy: "systemd",
    }),
    summary,
  };
}

async function safeReadStatus(scope: CodeServerSystemdScope, unitName: string): Promise<CodeServerSystemdStatus | null> {
  try {
    return await readCodeServerSystemdStatus({ scope, unitName });
  } catch {
    return null;
  }
}

export {
  extractCodeServerSystemdFailure,
  launchCodeServerWithSystemd,
  readCodeServerSystemdJournal,
  readCodeServerSystemdStatus,
  restartCodeServerSystemdUnit,
  stopCodeServerSystemdUnit,
  summarizeCodeServerSystemdJournal,
};
