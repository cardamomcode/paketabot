namespace PaketaBot

open System

type Repository = {
    Owner: string
    Name: string
    DefaultBranch: string
}

module Repository =
    let fullName repository = $"{repository.Owner}/{repository.Name}"

type VersionChange = {
    Name: string
    Previous: string
    Current: string
}

type RunnerRequest = {
    Repository: string
    BaseSha: string
    ArtifactPath: string
}

type RunnerStatus =
    | NoChange
    | Updated
    | Rejected
    | Failed

type RunnerResult = {
    Status: RunnerStatus
    LockFile: string option
    Changes: VersionChange list
    Messages: string list
}

type Publication = {
    Branch: string
    PullRequestNumber: int
    HeadSha: string
}

type PublishUpdate = {
    Repository: Repository
    BaseSha: string
    PreviousPublication: Publication option
    Branch: string
    Path: string
    Content: string
    Title: string
    Body: string
}

type UpdateOutcome =
    | Published of Publication
    | Unchanged
    | RunFailed of messages: string list

module PullRequests =
    [<Literal>]
    let Marker = "<!-- paketabot:weekly -->"

    let isTrackedBody (body: string) =
        not (isNull body) && body.Contains(Marker, StringComparison.Ordinal)

    /// Confirm that publication state belongs to the identity behind the configured token.
    ///
    /// decision: combines an exact publisher identity with the marker so arbitrary marked pull requests cannot claim a branch
    /// invariant: a pull request created by another GitHub identity never proves PaketaBot ownership
    let isOwnedBy expectedAuthor actualAuthor body =
        String.Equals(expectedAuthor, actualAuthor, StringComparison.OrdinalIgnoreCase)
        && isTrackedBody body

module PaketFiles =
    [<Literal>]
    let Lock = "paket.lock"

    let isLock path =
        String.Equals(path, Lock, StringComparison.Ordinal)

module Checkouts =
    /// Require Action execution to use the event's exact default-branch revision.
    ///
    /// decision: rejects non-default manual-dispatch refs so the pull request tree always derives from its declared base branch
    /// invariant: the archived checkout SHA equals GITHUB_SHA and GITHUB_REF names the repository default branch
    let validate defaultBranch eventRef eventSha checkoutSha =
        let expectedRef = $"refs/heads/{defaultBranch}"

        if not (String.Equals(eventRef, expectedRef, StringComparison.Ordinal)) then
            Error $"PaketaBot must run from the default branch ({expectedRef})"
        elif not (String.Equals(eventSha, checkoutSha, StringComparison.Ordinal)) then
            Error "the checked-out commit does not match GITHUB_SHA"
        else
            Ok()

module Branches =
    [<Literal>]
    let Weekly = "paketabot/weekly"

    /// Confirm that a branch is the single branch PaketaBot is allowed to overwrite.
    ///
    /// decision: uses one stable branch per repository so scheduled runs refresh one review surface
    /// invariant: publishing never creates or updates a branch whose name differs from paketabot/weekly
    let isOwned branch =
        String.Equals(branch, Weekly, StringComparison.Ordinal)

    type PublicationPlan =
        | CreateFrom of baseSha: string
        | FastForwardFrom of verifiedHead: string

    /// Decide how to create or refresh the owned branch after observing its current head.
    ///
    /// decision: refreshes descend from the verified bot head while their tree snapshots the latest default branch
    /// invariant: an existing owned branch moves only by non-forced fast-forward from its verified current head
    /// tradeoff: retains bot branch history instead of rebasing it to prevent check-then-force overwrite races
    let planPublication baseSha expectedHead currentHead =
        match currentHead, expectedHead with
        | None, _ -> Ok(CreateFrom baseSha)
        | Some actual, Some expected when actual = expected -> Ok(FastForwardFrom actual)
        | Some _, None -> Error "the target branch exists but is not tracked as PaketaBot-owned"
        | Some _, Some _ -> Error "the target branch changed outside PaketaBot; refusing to overwrite it"
