# Changelog

## Unreleased

- nothing yet

## 1.0.0

- expand the package from a session helper into a fuller generic `code-server` integration layer
- add package preparation status and auto-repair helpers for the installed `code-server` dependency
- add richer integration planning, diagnostics normalization, redaction, and proxy websocket helpers
- add profile snapshot and deduplicated persistence helpers
- strengthen session lifecycle ownership with inflight dedup, richer status metadata, and persisted diagnostics
- expand systemd helpers with restart, journal summarization, and structured failure extraction

## 0.3.0

- expand the package from launch planning into a full generic `code-server` session runtime
- add session lifecycle APIs for start, stop, restart, status, diagnostics, and session-manager creation
- add Linux-first transient systemd helpers and launch-command builders
- add disk-backed session metadata, reuse checks, profile restore and persist hooks, and richer startup diagnostics
- add `@trebired/logger-adapter` support across the higher-level APIs

## 0.2.0

- add `createCodeServerLaunchPlan()` as the main higher-level launch planning API
- add generic launch spec, command formatting, and startup failure normalization helpers
- add readiness probe support and broader structured error coverage
- add generic allowlisted profile sync helpers for `code-server` user data and extensions
- add reverse-proxy helpers for forwarded headers, trusted origins, and HTML response detection

## 0.1.0

- Initial release
