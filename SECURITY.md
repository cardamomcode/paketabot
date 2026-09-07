# Security Policy

## Reporting a vulnerability

Please use GitHub private vulnerability reporting when it is available for this
repository. While the repository is private, contact the repository owner
through GitHub to request a confidential channel without including exploit
details. Do not include credentials, exploit details, or other sensitive
information in a public issue.

If a PaketaBot token may have been exposed, revoke it immediately in GitHub,
then rotate it in every consuming repository before investigating further.

## Supported versions

No production version is supported during the private pre-release. After the
first production release, only the latest immutable GitHub release will be
supported; `main` and older releases may contain unreleased or superseded
behavior.

PaketaBot's current security boundary and explicit production limitations are
documented in the [threat model](docs/threat-model.md). Those limitations are
not vulnerability claims; reports showing that an enforced boundary can be
bypassed are security issues.
