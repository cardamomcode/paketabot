# Repository Guidelines

PaketaBot is a repository-local GitHub Action written in F# and compiled by
Fable to TypeScript for Node.js. Paket manages NuGet dependencies; pnpm manages
npm dependencies.

This repository uses Agent Decision Comments. See
`AGENT_DECISION_COMMENTS.md` for the locally adopted convention, pinned to
v0.3.0. Upstream releases: https://github.com/dbrattli/adc/releases

Before modifying code, read the ADCs already governing it. Treat them as active
constraints and justify any change explicitly. Add ADCs for non-obvious
rationale introduced by your change.

## Commands

- `just setup` restores tools and dependencies.
- `just build` compiles F# to TypeScript, validates it, and emits Node ESM.
- `just bundle` emits the committed JavaScript Action bundles under `dist/`.
- `just test` runs the Scriptorium behavioral suite on Node.
- `just check` runs the native F# smoke build, TypeScript checks, and bundling.
- `just format` formats F# with Fantomas.

Intermediate generated files live under `build/` and are never edited or
committed. GitHub requires JavaScript Action dependencies to be packaged, so
`dist/` is generated and committed. Never edit `dist/` by hand.

## Architecture Rules

- Keep business rules and state transitions in `PaketaBot.Core`.
- Keep npm interop in narrow binding modules; do not add hand-authored
  TypeScript application code.
- Never pass `PAKETABOT_TOKEN`, checkout credentials, or future installation
  tokens into the sandbox runner.
- PaketaBot may update only its verified `paketabot/weekly` branch.
- V1 accepts only public NuGet.org sources.

Tests use Scriptorium Quill and Nib. Add every test module to the runner in
`test/PaketaBot.Tests/Main.fs`.
