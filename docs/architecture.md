# Architecture

## Components

```text
schedule / workflow_dispatch
              │
              ▼
credential-free resolve job
checkout → source policy → Paket
              │
              │ typed artifact: repository + SHA + result
              ▼
token-bearing publish job ───── PAKETABOT_TOKEN
              │
              ▼
paketabot/weekly + pull request
```

`PaketaBot.Core` contains source eligibility rules, lock-file diffing, artifact
validation, guarded branch transitions, ports, and the split resolve/publish
services. It has no npm-specific behavior.

`PaketaBot.App` is the internal JavaScript Action used in two modes. Resolve
mode invokes Paket with an allowlisted child environment. Publish mode contains
the narrow Fable binding for GitHub's Actions toolkit and Octokit.

The reusable workflow in `.github/workflows/paketabot.yml` is the isolation
mechanism. GitHub assigns the resolve and publish jobs fresh runners. The
publisher receives the explicit secret but never checks out repository content;
the resolver receives repository content but not the secret.

The Fable output is validated with `tsc` and bundled with Rollup. Intermediate
output under `build/` is ignored; GitHub's required self-contained Action bundle
under `dist/` is generated and committed.

Published reusable workflows call the bundled Action through their own exact,
immutable release tag. Third-party Actions are pinned to full commit SHAs. This
keeps every job definition and executable dependency attached to commits that
were reviewed for that release.

## Update lifecycle

1. A repository-local schedule or manual dispatch calls the reusable workflow.
2. The resolve job checks out the triggering revision with persisted
   credentials disabled.
3. The resolver verifies that the checkout equals `GITHUB_SHA`, requires
   bounded regular root Paket files using the exact public NuGet.org v3 index,
   and runs `paket update --no-install` with an allowlisted child environment.
4. It uploads a typed artifact containing the caller repository, event SHA,
   resolution status, lock file, and version summary.
5. If the result is unchanged, the workflow finishes without starting the
   publisher.
6. A fresh publish job downloads the artifact and receives only the explicitly
   mapped `PAKETABOT_TOKEN` secret.
7. The publisher validates the artifact repository and SHA against its caller
   context and requires the event ref to be the default branch.
8. It discovers prior state from the marked pull request created by the token
   identity and publishes only `paket.lock` to `paketabot/weekly`. A refresh
   commit has the verified bot head and exact current base as parents, so it is
   both a safe fast-forward and a lockfile-only diff against the latest base.
9. For an open owned pull request, it updates pull-request metadata before a
   non-forced branch fast-forward, making the ref update the final API mutation.
10. A lost API response is retried. If a new pull request was not created after
    its branch moved, the next run fails closed until a maintainer follows the
    [recovery procedure](recovery.md).

Application failure messages never include raw Paket stderr, repository
directives, artifact decoder errors, or Octokit errors. Lock-derived Markdown
is neutralized and row-bounded before it becomes pull-request metadata. The
typed artifact expires after one day and is rejected before reading when it
exceeds its application-level size ceiling.

The caller's concurrency group prevents overlapping scheduled and manual runs.
There is no server, PostgreSQL database, webhook endpoint, persistent queue, or
container runtime.
