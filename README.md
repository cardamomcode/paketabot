# PaketaBot

> The dependency bot that speaks Paket.

PaketaBot is a GitHub App that opens weekly pull requests for dependencies
managed by [Paket](https://fsprojects.github.io/Paket/). It fills the gap left
by Dependabot's lack of `paket.dependencies` and `paket.lock` support.

PaketaBot is itself written in F#, compiled to TypeScript with
[Fable](https://fable.io/), and manages its NuGet dependencies with Paket.

## Status

This repository contains a local vertical slice, not a deployed public
service. It includes the domain workflow, GitHub gateway, webhook endpoint,
PostgreSQL/pg-boss adapters, credential-free container boundary, and a
Scriptorium test suite.

V1 intentionally supports only repositories whose root `paket.dependencies`
uses public HTTPS NuGet.org sources. Private feeds, Git dependencies, HTTP
dependencies, and custom repository commands are rejected.

## Development

Requirements:

- .NET SDK 10
- Node.js 24 and pnpm 10
- Just
- PostgreSQL 13+ for persistent mode
- Podman or Docker to build and run the isolated Paket worker

```bash
just setup
just check
just test
```

Start the API in memory-only development mode:

```bash
GITHUB_WEBHOOK_SECRET=local-development-secret pnpm start
```

The service listens on port 3000 by default and exposes:

- `GET /healthz`
- `POST /webhooks/github`

Set `DATABASE_URL` to enable PostgreSQL persistence and pg-boss scheduling.
Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` to
use the real GitHub gateway. Without App credentials, the service uses its
deterministic development gateway.

Build the runner image after `just build`:

```bash
podman build -f Containerfile.runner -t paketabot-runner:dev .
PAKETABOT_RUNNER_IMAGE=paketabot-runner:dev pnpm start
```

## GitHub App registration

Repository permissions:

- Metadata: read
- Contents: read and write
- Pull requests: read and write
- Issues: read and write

Subscribe to `installation`, `installation_repositories`, and `issue_comment`.
Point the webhook URL at `/webhooks/github` and configure a high-entropy
webhook secret.

PaketaBot understands these commands on its own pull request:

```text
/paketabot update
/paketabot rebase
```

Only users with write, maintain, or admin repository permission can enqueue a
run.

## Design

The control plane downloads a repository archive using a short-lived GitHub App
installation token. Only the archive enters the runner. The runner receives no
GitHub credentials, validates the Paket source policy, executes the bundled
Paket CLI, and returns an updated lock file plus a typed change summary.

See [Architecture](docs/architecture.md) and the
[Threat model](docs/threat-model.md) for the boundary and production gaps.

PaketaBot adopts [Agent Decision Comments](https://github.com/dbrattli/adc).
The pinned local convention is in `AGENT_DECISION_COMMENTS.md`.

## License

MIT
