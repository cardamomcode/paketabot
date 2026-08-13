# Releasing PaketaBot

PaketaBot releases are security boundaries: a consumer grants the published
workflow a repository-scoped token. Release only a reviewed commit after every
remaining public-release requirement in the [threat model](threat-model.md) is
satisfied.

## Release invariants

- Consumers reference an exact release such as `v1.0.0`, never `main` or a
  movable major tag.
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

## Publish and verify

1. Create a draft GitHub release whose tag and target are the reviewed release
   commit.
2. Recheck the draft tag, generated bundle, workflow self-references, and
   release notes before publishing. Publication makes the release immutable.
3. Run `workflow_dispatch` in a disposable repository containing an eligible
   Paket project. Confirm the resolver has no publisher token, the publisher
   changes only `paketabot/weekly`, and the pull request contains only
   `paket.lock`.
4. Record any failure without moving or deleting the published tag. Correct it
   in a new patch release.

While the repository is private, explicitly grant Actions access to intended
private test repositories under **Settings → Actions → General → Access**.
Remove unintended access before a visibility change. When the repository
becomes public, enable secret scanning, private vulnerability reporting, and
the `main` branch rules listed in the threat model before announcing the
release.
