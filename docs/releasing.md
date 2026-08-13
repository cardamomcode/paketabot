# Releasing PaketaBot

PaketaBot releases are security boundaries: a consumer grants the published
workflow a repository-scoped token. A private preview may be published only for
controlled testing under the explicit limitations in the
[threat model](threat-model.md). Publish a production release only after every
remaining public-release requirement is satisfied.

## Release invariants

- Consumers reference an exact release such as the private preview `v0.1.0` or
  production `v1.0.0`, never `main` or a movable major tag.
- Both internal Action steps in the reusable workflow reference that same exact
  release.
- Third-party Actions use reviewed full commit SHAs with a version comment for
  Dependabot and human reviewers.
- `dist/index.js` is generated from the F# application and belongs to the
  release commit.
- GitHub's immutable-release setting remains enabled. Published tags and assets
  are never replaced; fixes receive a new version.

## Prepare

1. Update the two self-references in `.github/workflows/paketabot.yml`, the
   README example, and `examples/paketabot.yml` to the intended exact version.
2. Run the complete local verification:

   ```bash
   just format
   just check
   just test
   git diff --check
   ```

3. Review the generated `dist/index.js` diff and confirm that
   `git diff --exit-code -- dist` succeeds after rebuilding.
4. Review every third-party Action SHA against its intended upstream release.
5. Audit the reachable Git history for credentials and private keys. Rotate and
   remove any exposed credential before changing repository visibility.
6. Merge the reviewed release commit to `main` and wait for required CI.

## Bootstrap the private preview

The first reusable workflow cannot invoke its own Action until the exact tag in
the workflow exists. After merging the reviewed `v0.1.0` references, create a
draft release targeting that merge commit, mark it as a pre-release, verify the
tag and bundle, and publish it. Do not move or replace the tag after
publication.

Run the private preview only in controlled repositories owned by this account.
It is not a production release and does not remove any remaining public-release
requirement. After those requirements are complete, repeat the reviewed process
with exact `v1.0.0` self-references and publish the production release.

## Publish and verify

1. Create a draft GitHub release whose tag and target are the reviewed release
   commit. Mark `v0.1.0` as a pre-release; do not mark `v1.0.0` as a pre-release.
2. Recheck the draft tag, generated bundle, workflow self-references, and
   release notes before publishing. Publication makes the release immutable.
3. Run `workflow_dispatch` in a disposable repository containing an eligible
   Paket project. Confirm the resolver has no publisher token, the publisher
   changes only `paketabot/weekly`, and the pull request contains only
   `paket.lock`.
4. Exercise the retry and fail-closed cases described in the
   [recovery procedure](recovery.md).
5. Record any failure without moving or deleting the published tag. Correct it
   in a new patch release.

While the repository is private, explicitly grant Actions access to intended
private test repositories under **Settings → Actions → General → Access**.
Remove unintended access before a visibility change. When the repository
becomes public, enable secret scanning, private vulnerability reporting, and
the `main` branch rules listed in the threat model before announcing the
release.
