# PaketaBot

> The dependency bot that speaks Paket.

PaketaBot is a reusable GitHub Actions workflow that opens weekly pull requests
for dependencies managed by [Paket](https://fsprojects.github.io/Paket/). It
fills the gap left by Dependabot's lack of `paket.dependencies` and
`paket.lock` support without requiring a hosted service, database, or Docker.

PaketaBot is written in F#, compiled to TypeScript with
[Fable](https://fable.io/), and packaged as a Node 24 JavaScript Action used by
the workflow's two jobs.

## Status

This repository contains a private, pre-release vertical slice. It includes a
credential-free resolver job, token-authenticated publisher job, guarded branch
refresh, and Scriptorium test suite.

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
repository as `.github/workflows/paketabot.yml`. Its update job calls the
reusable workflow and passes only the named secret:

```yaml
jobs:
  update:
    uses: dbrattli/paketabot/.github/workflows/paketabot.yml@v0.1.2
    permissions:
      contents: read
    secrets:
      paketabot_token: ${{ secrets.PAKETABOT_TOKEN }}
```

The action repository is private during development. To test it from another
private repository owned by the same account, grant repository Actions access
under **Settings → Actions → General → Access**. Consumers use the exact
immutable release shown above; do not reference `main` or a movable major tag.
`v0.1.2` is the current private preview; `v0.1.0` remains its immutable initial
smoke-tested release. The production `v1.0.0` release remains reserved until
every public-release requirement in the threat model is satisfied.

The example runs weekly and supports manual runs through `workflow_dispatch`.
GitHub Actions concurrency prevents overlapping runs. PaketaBot refreshes only
the `paketabot/weekly` branch and publishes only `paket.lock`. Manual runs must
use the repository's default branch.

## Credential boundary

The reusable workflow has two fresh GitHub-hosted jobs:

1. The resolver checks out the caller revision without persisting credentials,
   validates the source policy, and runs `paket update --no-install`. It never
   receives `PAKETABOT_TOKEN`, and Paket receives an allowlisted child-process
   environment without Actions or GitHub credentials.
2. The publisher downloads the typed result artifact but never checks out or
   executes repository contents. Only this job receives `PAKETABOT_TOKEN`.

The artifact records the caller repository and exact event SHA. The publisher
rejects a mismatched artifact before using the token.

The publisher treats a marked pull request created by the identity behind
`PAKETABOT_TOKEN` as durable branch state. It refuses to overwrite an existing
branch without that ownership record, requires the branch ref to match the
recorded pull-request head, and moves existing branches only through a
non-forced fast-forward. Refresh commits also merge the exact current base so
the pull request continues to contain only `paket.lock` after main advances.

Rotating the token without changing its GitHub identity preserves this state.
Future GitHub App support will provide the installation identity alongside a
short-lived token through the authentication adapter. A centrally owned App
private key must never be distributed to consuming repositories.

Most interrupted publications recover by rerunning the workflow. If GitHub did
not confirm pull-request creation after moving the bot branch, use the
[fail-closed recovery procedure](docs/recovery.md); PaketaBot will not guess
that an untracked branch belongs to it.

## Development

Requirements:

- .NET SDK 10
- Node.js 24 and pnpm 10
- Just

```bash
just setup
just format
just check
just test
```

`just bundle` generates the committed `dist/index.js` Action bundle. Files
under `dist/` are generated artifacts and must not be edited manually.

See [Architecture](docs/architecture.md) and the
[Threat model](docs/threat-model.md) for the trust boundary and remaining
release work. Maintainers should also follow the
[release procedure](docs/releasing.md) and [recovery procedure](docs/recovery.md).

PaketaBot adopts [Agent Decision Comments](https://github.com/dbrattli/adc).
The pinned local convention is in `AGENT_DECISION_COMMENTS.md`.

## License

MIT
