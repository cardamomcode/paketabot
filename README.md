# PaketaBot

> The dependency bot that speaks Paket.

PaketaBot is a repository-local GitHub Action that opens weekly pull requests
for dependencies managed by [Paket](https://fsprojects.github.io/Paket/). It
fills the gap left by Dependabot's lack of `paket.dependencies` and
`paket.lock` support without requiring a hosted service or database.

PaketaBot is written in F#, compiled to TypeScript with
[Fable](https://fable.io/), and packaged as a Node 24 JavaScript Action.

## Status

This repository contains a private, pre-release vertical slice. It includes the
domain workflow, token-authenticated GitHub publisher, credential-free
container runner, guarded branch refresh, and Scriptorium test suite.

V1 intentionally supports only repositories whose root `paket.dependencies`
uses public HTTPS NuGet.org sources. Private feeds, Git dependencies, HTTP
dependencies, and custom repository commands are rejected.

## Use

Create a fine-grained token for the target repository and save it as the
repository secret `PAKETABOT_TOKEN`. The token needs:

- Contents: read and write
- Pull requests: read and write
- Metadata: read

Copy [`examples/paketabot.yml`](examples/paketabot.yml) into the consuming
repository as `.github/workflows/paketabot.yml`. The important steps are:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v6
    with:
      persist-credentials: false
  - uses: dbrattli/paketabot@main
    with:
      token: ${{ secrets.PAKETABOT_TOKEN }}
```

The action repository is private during development, so GitHub repository
settings must allow the consuming repository to access it. Published versions
will use an immutable release reference instead of `main`.

The workflow runs weekly and supports manual runs through `workflow_dispatch`.
GitHub Actions concurrency prevents overlapping runs. PaketaBot refreshes only
the `paketabot/weekly` branch and only publishes `paket.lock`. Manual runs must
use the repository's default branch.

## Credential boundary

The host Action receives `PAKETABOT_TOKEN`, creates a Git archive of the exact
checked-out commit, and starts the Paket runner container. The archive excludes
`.git` and untracked files. The runner inherits no environment variables,
checkout credentials, or GitHub token from the host. It receives only fixed,
non-secret runtime settings and returns a typed result containing the updated
lock file and version summary.

The publisher treats a marked pull request created by the identity behind
`PAKETABOT_TOKEN` as durable branch state. It refuses to overwrite an existing
branch without that ownership record, requires the branch ref to match the
recorded pull-request head, and moves existing branches only through a
non-forced fast-forward.

Rotating the token without changing its GitHub identity preserves this state.
Future GitHub App support will provide the installation identity alongside a
short-lived token through the authentication adapter. A centrally owned App
private key must never be distributed to consuming repositories.

## Development

Requirements:

- .NET SDK 10
- Node.js 24 and pnpm 10
- Just
- Docker or Podman to build and run the isolated Paket worker

```bash
just setup
just format
just check
just test
```

`just bundle` generates the committed `dist/index.js` host Action and
`dist/runner.mjs` worker bundle. Files under `dist/` are generated artifacts and
must not be edited manually.

See [Architecture](docs/architecture.md) and the
[Threat model](docs/threat-model.md) for the trust boundary and remaining
release work.

PaketaBot adopts [Agent Decision Comments](https://github.com/dbrattli/adc).
The pinned local convention is in `AGENT_DECISION_COMMENTS.md`.

## License

MIT
