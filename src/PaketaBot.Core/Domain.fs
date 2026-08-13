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

type RequirementChange = {
    Name: string
    RequiredBy: string
    Previous: string
    Current: string
}

type ResolutionStatus =
    | NoChange
    | Updated
    | Rejected
    | Failed

type ResolutionResult = {
    Status: ResolutionStatus
    LockFile: string option
    Changes: VersionChange list
    RequirementChanges: RequirementChange list
    Messages: string list
}

type ResolutionArtifact = {
    Repository: string
    BaseSha: string
    Result: ResolutionResult
}

type Publication = {
    Branch: string
    PullRequestNumber: int
    HeadSha: string
    IsOpen: bool
}

type PublishUpdate = {
    Repository: Repository
    BaseSha: string
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

type ActionOperation =
    | ResolveOperation
    | PublishOperation

module ActionOperation =
    let parse (value: string) =
        match value.Trim().ToLowerInvariant() with
        | "resolve" -> Ok ResolveOperation
        | "publish" -> Ok PublishOperation
        | _ -> Error "the operation input must be resolve or publish"

    /// Enforce the credential contract before either Action operation starts.
    ///
    /// decision: makes token absence an executable resolver precondition in addition to the separate-job workflow boundary
    /// invariant: resolve rejects a supplied publisher token and publish rejects a missing publisher token
    let validateToken operation hasToken =
        match operation, hasToken with
        | ResolveOperation, false
        | PublishOperation, true -> Ok()
        | ResolveOperation, true -> Error "the resolve operation must not receive a GitHub token"
        | PublishOperation, false -> Error "the publish operation requires a GitHub token"

module ResolutionArtifacts =
    /// Bind a downloaded resolution artifact to the caller repository and event revision.
    ///
    /// decision: carries repository and SHA through the artifact because jobs do not share process state
    /// invariant: publication rejects an artifact created for another repository or revision
    let validate expectedRepository expectedSha (artifact: ResolutionArtifact) =
        if not (String.Equals(artifact.Repository, expectedRepository, StringComparison.Ordinal)) then
            Error "the resolution artifact belongs to another repository"
        elif not (String.Equals(artifact.BaseSha, expectedSha, StringComparison.Ordinal)) then
            Error "the resolution artifact belongs to another revision"
        else
            Ok()

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

    [<Literal>]
    let Dependencies = "paket.dependencies"

    [<Literal>]
    let MaxDependenciesBytes = 1_048_576

    [<Literal>]
    let MaxLockBytes = 8_388_608

    [<Literal>]
    let MaxArtifactBytes = 33_554_432

    let isLock path =
        String.Equals(path, Lock, StringComparison.Ordinal)

    /// Bound every repository-controlled file before it is read into memory or
    /// exchanged between jobs.
    ///
    /// decision: uses explicit byte ceilings because GitHub artifact limits do not protect the Action process itself
    /// invariant: dependencies, lock, and artifact inputs larger than their declared ceiling are rejected before reading
    let validateSize description maximumBytes actualBytes =
        if actualBytes < 0 then
            Error $"{description} has an invalid size"
        elif actualBytes > maximumBytes then
            Error $"{description} exceeds the {maximumBytes}-byte limit"
        else
            Ok()

    /// Apply the complete pre-read policy to one observed filesystem entry.
    ///
    /// invariant: an accepted input is a regular non-symbolic-link entry within its byte ceiling
    let validateInput description maximumBytes actualBytes isRegularFile isSymbolicLink =
        if isSymbolicLink || not isRegularFile then
            Error $"{description} must be a regular file, not a symbolic link or special file"
        else
            validateSize description maximumBytes actualBytes

module Checkouts =
    let validateRevision eventSha resolvedSha =
        if String.Equals(eventSha, resolvedSha, StringComparison.Ordinal) then
            Ok()
        else
            Error "the resolved commit does not match GITHUB_SHA"

    /// Require publication to use the event's exact default-branch resolution.
    ///
    /// decision: rejects non-default manual-dispatch refs so the pull request tree always derives from its declared base branch
    /// invariant: the resolved SHA equals GITHUB_SHA and GITHUB_REF names the repository default branch
    let validate defaultBranch eventRef eventSha resolvedSha =
        let expectedRef = $"refs/heads/{defaultBranch}"

        if not (String.Equals(eventRef, expectedRef, StringComparison.Ordinal)) then
            Error $"PaketaBot must run from the default branch ({expectedRef})"
        else
            validateRevision eventSha resolvedSha

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
    /// tradeoff: retains bot branch history instead of force-rebasing it to prevent check-then-overwrite races
    let planPublication baseSha expectedHead currentHead =
        match currentHead, expectedHead with
        | None, _ -> Ok(CreateFrom baseSha)
        | Some actual, Some expected when actual = expected -> Ok(FastForwardFrom actual)
        | Some _, None -> Error "the target branch exists but is not tracked as PaketaBot-owned"
        | Some _, Some _ -> Error "the target branch changed outside PaketaBot; refusing to overwrite it"

    /// Select commit parents that preserve branch ownership and the pull request's lockfile-only diff.
    ///
    /// decision: refreshes merge the exact base behind the verified bot head so main is an ancestor without force-pushing
    /// invariant: the verified bot head is the first refresh parent and the exact current base is the second parent
    let commitParents baseSha publicationPlan =
        match publicationPlan with
        | CreateFrom sha -> [ sha ]
        | FastForwardFrom verifiedHead -> [ verifiedHead; baseSha ]
