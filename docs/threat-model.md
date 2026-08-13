# Threat Model

PaketaBot processes repositories controlled by untrusted users. Repository
contents are hostile input even when the GitHub App installation is valid.

## Protected assets

- GitHub App private key and installation tokens
- Other tenants' repositories and artifacts
- Control-plane database
- Worker host and internal network
- Pull-request integrity

## Enforced in this vertical slice

- Workers receive archives, never GitHub credentials.
- The image supplies Paket; repository tool manifests are not executed.
- Only root Paket files using public HTTPS NuGet.org sources are eligible.
- Git, GitHub, HTTP-file, local-path, cache, credential, and alternative-source
  directives are rejected.
- Container execution requests a read-only root filesystem, dropped
  capabilities, no privilege escalation, resource limits, and narrow mounts.
- Publishing accepts only the stable `paketabot/weekly` branch and only the
  `paket.lock` path.
- Existing bot branches are updated only when their head matches the last
  publication recorded by PaketaBot; refreshes descend from that verified head
  and move the ref by non-forced fast-forward.
- Webhook signatures are verified before events are processed.
- Webhook delivery claims have one concurrent winner; handled dispatch failures
  release their claim so GitHub can retry them.

## Required before a public launch

- Run workers under gVisor, Firecracker, or an equivalent hardened sandbox.
- Enforce network egress at infrastructure level, allowing only required
  NuGet.org endpoints and blocking private/reserved address ranges after every
  DNS resolution and redirect.
- Store artifacts in tenant-scoped object storage with expiration.
- Replace webhook claims with a leased durable inbox so a process crash after
  claiming a delivery cannot suppress every later retry.
- Make branch mutation, pull-request mutation, and local publication recording
  recoverable as one durable workflow across partial GitHub API failures.
- Encrypt the GitHub App private key using a managed secret service.
- Add audit logging, quotas, abuse detection, and bounded log retention.
- Exercise the system with malicious archives, symlinks, decompression bombs,
  oversized files, Paket parser edge cases, and compromised package content.

The local container command is a development approximation. It does not by
itself provide a sufficient public multi-tenant security boundary.
