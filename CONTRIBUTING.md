# Contributing

Thanks for helping improve `@trebired/code-server-kit`.

## Development Setup

```sh
bun install
```

The package is authored in TypeScript and published from `dist`.

## Common Commands

```sh
bun run typecheck
bun test
bun run build
```

## Pull Request Checklist

- Keep public API changes intentional and documented in `README.md`.
- Add or update tests for behavior changes.
- Run typecheck, tests, and build before opening a PR.
- Update `CHANGELOG.md` under `Unreleased`.
- Do not commit `dist` or generated package tarballs.

## Design Principles

- Keep launch planning explicit and easy to inspect.
- Resolve installed `code-server` paths clearly instead of depending on hidden app conventions.
- Return plain command and arg plans so callers can bring their own sandboxing or supervision.
- Keep Linux-first Node.js support solid before widening platform scope.
- Avoid external runtime dependencies unless they remove real complexity.

## Release Process

1. Move `CHANGELOG.md` entries from `Unreleased` into a versioned section.
2. Update the package version:

   ```sh
   npm version patch
   ```

   Use `minor` or `major` instead of `patch` when appropriate.

3. Verify the package:

   ```sh
   bun run typecheck
   bun test
   bun run build
   npm pack --dry-run
   ```

4. Publish with:

   ```sh
   npm publish
   ```

`npm publish` runs `prepublishOnly`, which typechecks, tests, and builds before publishing.
