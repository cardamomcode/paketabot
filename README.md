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

This repository contains the public PaketaBot workflow. It includes a
credential-free resolver job, token-authenticated publisher job, guarded branch
refresh, and Scriptorium test suite.

V1 intentionally supports only repositories whose root `paket.dependencies`
uses the exact `https://api.nuget.org/v3/index.json` source. The root
`paket.dependencies` and `paket.lock` must be regular files rather than
symbolic links and are limited to 1 MiB and 8 MiB respectively. Private feeds,
alternate endpoints, Git dependencies, HTTP dependencies, and custom
repository commands are rejected.

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
    uses: cardamomcode/paketabot/.github/workflows/paketabot.yml@v1.0.0
    permissions:
      contents: read
    secrets:
      paketabot_token: ${{ secrets.PAKETABOT_TOKEN }}
```

Consumers use the exact immutable release shown above; do not reference `main`
or a movable major tag. The `v0.1.x` releases remain immutable previews used to
exercise the complete workflow before the repository became public. The
production `v1.0.0` tag is published only from its reviewed release commit.

The example runs weekly and supports manual runs through `workflow_dispatch`.
GitHub Actions concurrency prevents overlapping runs. PaketaBot refreshes only
the `paketabot/weekly` branch and publishes only `paket.lock`. Manual runs must
use the repository's default branch.

## Safety

PaketaBot keeps your repository files and its publishing token in separate
jobs. The job that updates Paket cannot access your token, and the job that
uses the token never checks out or runs your repository's code.

It only updates the `paketabot/weekly` branch and changes `paket.lock`. For
the security model, limitations, and recovery guidance, see the
[threat model](docs/threat-model.md).

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
