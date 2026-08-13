# Architecture

## Components

```text
GitHub schedule / workflow_dispatch
              │
              ▼
Node 24 Action host ─────────────── PAKETABOT_TOKEN
              │                           │
              │ tracked Git archive       │ publish paket.lock
              ▼                           ▼
credential-free Paket runner       paketabot/weekly + PR
              │
              ▼
typed result: paket.lock + version summary
```

`PaketaBot.Core` contains source eligibility rules, lock-file diffing, guarded
branch transitions, ports, and the update service. It has no npm-specific
behavior.

`PaketaBot.App` is the JavaScript Action host. It contains narrow Fable bindings
for the GitHub Actions toolkit and Node APIs, creates a credential-free Git
archive, starts the container runner, and publishes through Octokit.

`PaketaBot.Runner` extracts one repository archive, validates its root Paket
files, runs the image-pinned Paket CLI, and writes a typed result. It never
receives `PAKETABOT_TOKEN` or checkout credentials.

The Fable output is validated with `tsc` and bundled with Rollup. Intermediate
output under `build/` is ignored; GitHub's required self-contained Action
bundles under `dist/` are generated and committed.

## Update lifecycle

1. A repository-local schedule or manual dispatch starts the Action.
2. `actions/checkout` checks out the triggering default-branch commit without
   persisting its credential; other refs and mismatched event SHAs are rejected.
3. The host reads `PAKETABOT_TOKEN` and resolves the target repository through
   the GitHub API.
4. `git archive` packages only tracked files at the exact checkout SHA under one
   synthetic root, omitting `.git` and untracked workspace files.
5. The credential-free container accepts public NuGet.org dependencies and runs
   `paket update --no-install`.
6. The host discovers prior publication state from the marked pull request
   created by the authenticated token identity.
7. It publishes only `paket.lock` to `paketabot/weekly`, refusing untracked or
   mismatched branch heads and using only non-forced fast-forwards.
8. It creates or refreshes one pull request.

The workflow's concurrency group prevents overlapping scheduled and manual
runs. There is no server, PostgreSQL database, webhook endpoint, or persistent
job queue.
