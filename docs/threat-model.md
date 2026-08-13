# Threat Model

PaketaBot processes repository contents and downloaded package metadata as
untrusted input. Running inside the repository's own workflow reduces
cross-tenant risk, but it does not make dependency content trustworthy.

## Protected assets

- `PAKETABOT_TOKEN` and future GitHub App installation tokens
- GitHub Actions runtime credentials
- GitHub-hosted or self-hosted runners
- Pull-request and branch integrity
- Other repositories accessible to an overly broad token

## Enforced in this vertical slice

- The reusable workflow maps only the named `paketabot_token` secret; it does
  not inherit all caller secrets.
- The resolve and publish operations run as separate jobs on fresh runners.
- The resolve job never receives `PAKETABOT_TOKEN`; runtime validation rejects
  a publisher token if one is supplied accidentally.
- Paket receives an allowlisted environment containing only non-secret process
  settings, so Actions runtime and GitHub credentials are not inherited.
- The publisher never checks out or executes repository contents.
- The artifact carries the caller repository and exact event SHA; the publisher
  rejects mismatches and non-default-branch refs before using the token.
- Only root Paket files using public HTTPS NuGet.org sources are eligible.
- Git, GitHub, HTTP-file, local-path, cache, credential, and alternative-source
  directives are rejected.
- Publishing accepts only `paketabot/weekly` and only the root `paket.lock`.
- An existing branch is trusted only when a marked pull request created by the
  authenticated token identity records the same head; an untracked or
  mismatched head is rejected.
- Existing bot branches move through non-forced fast-forwards.
- Third-party Actions are pinned to reviewed full commit SHAs rather than
  mutable version tags.
- Repository-level immutable releases are enabled. Released workflows use their
  own exact release tag for both internal Action operations.

## Token guidance

Use a fine-grained `PAKETABOT_TOKEN` scoped to one repository with only metadata
read, contents read/write, and pull-request read/write permissions. Prefer a
dedicated automation identity, set an expiration, and rotate the token.

Do not expose a centrally owned GitHub App private key to consuming workflows.
Future App support requires an organization-controlled secret or a small token
broker that returns a short-lived installation token and its verified publisher
identity.

## Required before a public release

- Publish and smoke-test `v1.0.0` from the reviewed release commit. Confirm that
  its reusable workflow invokes the same immutable tag in both jobs.
- Make branch mutation and pull-request mutation recoverable across partial
  GitHub API failures.
- Add bounded diagnostic logging that reliably redacts tokens and repository
  secrets.
- Exercise the resolver with malicious Paket files, oversized files, parser
  edge cases, redirects, DNS rebinding attempts, and compromised package
  metadata.
- Evaluate infrastructure-enforced network egress controls if the source policy
  and `paket update --no-install` boundary prove insufficient against Paket or
  NuGet client vulnerabilities.
- Document and test private-workflow sharing, token rotation, artifact retention,
  and the GitHub App migration path.
- Define an explicit recovery procedure when the publisher identity changes or
  the ownership pull request is edited or deleted.
- After changing the repository to public, require CI on `main` and prevent
  branch deletion and force pushes. The current GitHub plan does not expose
  repository rulesets while this repository remains private.
- Enable GitHub private vulnerability reporting when repository visibility
  makes the feature available.
- Enable GitHub secret scanning when repository visibility makes the feature
  available and review its findings before announcing the release.

The job boundary prevents repository content processed by Paket from sharing a
runner with `PAKETABOT_TOKEN`. It does not sandbox Paket from the resolve job's
runner or network, and GitHub's built-in job token exists within the Actions
runtime even though it is not passed to the Paket child process. The workflow
remains intentionally limited to `paket update --no-install` on the narrow
source policy above.
