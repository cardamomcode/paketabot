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
- Only bounded, regular root Paket files using the exact
  `https://api.nuget.org/v3/index.json` source are eligible; symbolic links,
  alternate ports, paths, queries, fragments, and lookalike hosts are rejected.
- Git, GitHub, HTTP-file, local-path, cache, credential, and alternative-source
  directives are rejected.
- Repository directives, Paket stderr, artifact decoder errors, and Octokit
  errors are not copied into Action failure logs. Application diagnostics are
  static and bounded, and credential-bearing directives are reported by name
  without their values.
- Lock-derived pull-request cells are neutralized and length-bounded, and each
  summary table is limited to 50 rows.
- Publishing accepts only `paketabot/weekly` and only the root `paket.lock`.
- An existing branch is trusted only when a marked pull request created by the
  authenticated token identity records the same head; an untracked or
  mismatched head is rejected.
- Existing bot branches move through non-forced fast-forwards. Refresh commits
  merge the exact current base behind the verified bot head so intervening base
  changes do not enter the pull-request diff.
- Refreshing an open owned pull request updates its metadata before moving the
  branch, so no fallible GitHub API call follows the ref update.
- An uncertain pull-request creation is retried before any manual action. If no
  owned pull request exists, publication fails closed and requires the
  documented human-verified recovery procedure; the bot never automatically
  deletes an untracked ref.
- Third-party Actions are pinned to reviewed full commit SHAs rather than
  mutable version tags.
- Repository-level immutable releases are enabled. Released workflows use their
  own exact release tag for both internal Action operations.
- Behavioral tests inspect the committed reusable workflow to preserve job
  isolation, one-day artifact retention, and exact internal release references.

## Network egress limitation

The exact source policy rejects repository-configured redirects, alternate
hosts, and DNS lookalikes before Paket starts. It does not pin DNS answers or
TLS certificates, and NuGet.org metadata can legitimately direct the NuGet
client to additional NuGet.org CDN and content endpoints.

GitHub-hosted runners do not provide a repository-level outbound firewall.
Enforcing endpoint-level egress would require a controlled runner or proxy,
which would add a hosted trust boundary and conflict with the no-service V1
deployment. V1 therefore accepts unrestricted resolver-job network egress as
an explicit production limitation. A compromised Paket/NuGet client, official
NuGet.org response, DNS path, or GitHub-hosted runner could access the network
as the resolver job, although the Paket child receives no GitHub token or
Actions runtime credentials.

## Token guidance

Use a fine-grained `PAKETABOT_TOKEN` scoped to one repository with only metadata
read, contents read/write, and pull-request read/write permissions. Prefer a
dedicated automation identity, set an expiration, and rotate the token.

Do not expose a centrally owned GitHub App private key to consuming workflows.
Future App support requires an organization-controlled secret or a small token
broker that returns a short-lived installation token and its verified publisher
identity.

## Verified public-readiness work

- The immutable private preview `v0.1.0` was published from its reviewed release
  commit and smoke-tested with its exact tag in both jobs.
- The source policy is exercised with credential-bearing files, oversized inputs,
  parser edge cases, redirect-shaped paths, DNS lookalikes, and
  metadata-derived Markdown. The application rejects or bounds these inputs
  without echoing them to logs.
- Infrastructure-enforced egress controls were evaluated; the unsupported
  boundary above remains because V1 has no controlled runner, proxy, or hosted
  service.
- Private workflow sharing and token rotation were smoke-tested in a controlled
  consumer. Tests cover artifact retention and the two-job credential contract,
  and the GitHub App migration boundary is documented.
- Reachable branches, tags, and closed pull-request heads were screened for
  credential signatures and private-key files before the visibility change.

## Required before the production release

- Publish the completed hardening as a new immutable private preview and repeat
  the two-job smoke test in a controlled consumer before changing visibility.
- After changing the repository to public, require CI on `main` and prevent
  branch deletion and force pushes. The current GitHub plan does not expose
  repository rulesets while this repository remains private.
- Enable GitHub private vulnerability reporting when repository visibility
  makes the feature available.
- Enable GitHub secret scanning when repository visibility makes the feature
  available and review its findings before announcing the release.
- After every other requirement is satisfied, publish `v1.0.0` from a reviewed
  commit whose reusable workflow invokes that same exact production tag.

The job boundary prevents repository content processed by Paket from sharing a
runner with `PAKETABOT_TOKEN`. It does not sandbox Paket from the resolve job's
runner or network, and GitHub's built-in job token exists within the Actions
runtime even though it is not passed to the Paket child process. The workflow
remains intentionally limited to `paket update --no-install` on the narrow
source policy above.
