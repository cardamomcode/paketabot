# Recovering Publication State

PaketaBot normally recovers from an interrupted GitHub API request by rerunning
the workflow once. A pull request whose response was lost is rediscovered by
its marker, author identity, repository, branch, and head SHA. An open pull
request is updated before its branch moves, so a failed metadata update leaves
the ref unchanged.

Creating a new pull request is the unavoidable exception: GitHub requires its
head branch to exist first, and the Git reference deletion API cannot condition
deletion on an expected commit SHA. PaketaBot therefore never tries to roll
back an unconfirmed branch automatically; a check-then-delete could remove a
maintainer's intervening update.

## First response

1. Rerun the failed workflow once. If GitHub created the pull request but lost
   the API response, PaketaBot will rediscover it and continue safely.
2. If the rerun reports that `paketabot/weekly` is untracked or changed outside
   PaketaBot, stop scheduled retries and inspect the repository. Do not force
   the branch, delete it, or add the marker to an unrelated pull request.
3. Record the authenticated publisher login, branch head SHA, and every pull
   request whose head is `paketabot/weekly`:

   ```bash
   gh api repos/OWNER/REPOSITORY/git/ref/heads/paketabot/weekly
   gh pr list --repo OWNER/REPOSITORY --state all \
     --head paketabot/weekly \
     --json number,state,author,headRefName,headRefOid,body
   ```

An owned pull request must contain `<!-- paketabot:weekly -->`, have the
expected publisher as its author, use the target repository and
`paketabot/weekly` as its head, and record the exact current branch SHA. If all
conditions hold, rerun the workflow without changing the branch.

## No owned pull request exists

Treat the branch as unowned. Review its commit and file changes in GitHub. If
the branch contains any work that must be preserved, rename or copy that work
to a different branch before recovery; PaketaBot must not overwrite it.

Only after a maintainer has verified the repository, exact branch name, current
head SHA, and absence of work to preserve may that maintainer delete
`paketabot/weekly` through GitHub's branch UI. Rerun PaketaBot after deletion so
it can create a fresh branch and ownership pull request. This is intentionally
a human action because GitHub offers no atomic “delete this ref only if it
still equals this SHA” operation.

## Publisher identity or marker changed

Rotating a token without changing its GitHub login needs no recovery. A new
login cannot inherit the old login's ownership record. Verify and preserve any
branch work, then use the no-owned-pull-request procedure above before running
with the new identity.

If the marker was edited out of the genuine ownership pull request, restore it
only after verifying the pull-request author, repository, branch, and exact
head SHA. If the pull request or its head repository is no longer available,
treat the branch as unowned.
