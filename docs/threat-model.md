# Threat Model

PaketaBot processes repository contents and downloaded packages as untrusted
input. Running inside the repository's own workflow reduces cross-tenant risk,
but it does not make dependency content trustworthy.

## Protected assets

- `PAKETABOT_TOKEN` and future GitHub App installation tokens
- Checkout credentials
- GitHub-hosted or self-hosted runner
- Pull-request and branch integrity
- Other repositories accessible to an overly broad token

## Enforced in this vertical slice

- The host Action requires an explicitly supplied token; there is no implicit
  secret or known fallback.
- The checkout must be the event's exact default-branch revision; manual runs
  from another ref are rejected.
- `git archive` includes only tracked files at the exact checkout SHA and omits
  `.git`, so persisted checkout credentials cannot enter the worker archive.
- The worker container receives archives, never GitHub credentials or
  environment variables from the Action host.
- The image supplies Paket; repository tool manifests are not executed.
- Only root Paket files using public HTTPS NuGet.org sources are eligible.
- Git, GitHub, HTTP-file, local-path, cache, credential, and alternative-source
  directives are rejected.
- Container execution requests a read-only root filesystem, dropped
  capabilities, no privilege escalation, resource limits, and narrow mounts.
- Publishing accepts only `paketabot/weekly` and only the `paket.lock` path.
- An existing branch is trusted only when a marked pull request created by the
  authenticated token identity records the same head; an untracked or
  mismatched head is rejected.
- Existing bot branches move through non-forced fast-forwards.

## Token guidance

Use a fine-grained `PAKETABOT_TOKEN` scoped to one repository with only metadata
read, contents read/write, and pull-request read/write permissions. Prefer a
dedicated automation identity, set an expiration, and rotate the token.

Do not expose a centrally owned GitHub App private key to consuming workflows.
Future App support requires an organization-controlled secret or a small token
broker that returns a short-lived installation token and its verified publisher
identity.

## Required before a public release

- Publish and pin a versioned runner image so consumers do not build it from a
  moving source tree on every run.
- Enforce network egress at infrastructure level, allowing only required
  NuGet.org endpoints and blocking private/reserved address ranges after every
  DNS resolution and redirect.
- Make branch mutation and pull-request mutation recoverable across partial
  GitHub API failures.
- Define an explicit recovery procedure when the publisher identity changes or
  the ownership pull request is edited or deleted.
- Add bounded diagnostic logging that reliably redacts tokens and repository
  secrets.
- Exercise the runner with malicious archives, symlinks, decompression bombs,
  oversized files, Paket parser edge cases, and compromised package content.
- Document and test private-action sharing, immutable release references, token
  rotation, and the GitHub App migration path.

The local container command is a development approximation. It does not by
itself provide a sufficient boundary for executing arbitrary hostile code, and
the Action remains intentionally limited to `paket update --no-install` on the
narrow source policy above.
