# Architecture

## Components

```text
GitHub webhooks
      │
      ▼
Fastify control plane ─── PostgreSQL + pg-boss
      │                           │
      │ source archive            │ scheduled jobs
      ▼                           │
local artifact store              │
      │                           │
      ▼                           │
credential-free Paket runner ◄────┘
      │
      ▼
paket.lock + version summary ──► App-owned branch and PR
```

`PaketaBot.Core` contains the domain, source eligibility rules, lock-file diff,
ports, and update service. It has no npm-specific behavior.

`PaketaBot.App` contains narrow Fable bindings and adapters for Fastify,
Octokit, PostgreSQL, pg-boss, local artifacts, and container execution.

`PaketaBot.Runner` extracts one repository archive, validates its root Paket
files, runs the image-pinned Paket CLI, and writes a typed result. It never
receives a GitHub token.

## Update lifecycle

1. A weekly pg-boss schedule or authorized PR command enqueues a repository.
2. The control plane resolves the latest default-branch SHA.
3. It downloads an archive with a repository-scoped installation token.
4. The token remains in the control plane; only the archive path reaches the
   runner.
5. The runner accepts public NuGet.org dependencies and executes
   `paket update --no-install`.
6. The control plane publishes only `paket.lock` to `paketabot/weekly` and
   creates or refreshes one PR.

pg-boss serializes active jobs by repository across workers. Workflow failures
reject the worker promise so the configured retry policy is applied rather than
silently completing the job.

The domain is written in F#. Fable emits TypeScript, `tsc` validates npm
boundaries, and Node runs the emitted ESM.
