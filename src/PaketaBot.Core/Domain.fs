namespace PaketaBot

open System

type InstallationId = string
type RepositoryId = string

type Repository = {
    Id: RepositoryId
    InstallationId: InstallationId
    Owner: string
    Name: string
    DefaultBranch: string
    Enabled: bool
}

module Repository =
    let fullName repository = $"{repository.Owner}/{repository.Name}"

type RunTrigger =
    | Scheduled
    | RequestedBy of login: string

type UpdateCommand =
    | Update
    | Rebase

type UpdateJob = {
    RepositoryId: RepositoryId
    Trigger: RunTrigger
}

type VersionChange = {
    Name: string
    Previous: string
    Current: string
}

type RunnerRequest = {
    Repository: string
    BaseSha: string
    ArtifactPath: string
    OutputPath: string
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
    ExpectedHead: string option
    Branch: string
    Path: string
    Content: string
    Title: string
    Body: string
}

type UpdateOutcome =
    | Skipped of reason: string
    | Published of Publication
    | Unchanged
    | RunFailed of messages: string list

module UpdateOutcome =
    let completionError =
        function
        | RunFailed [] -> Some "dependency update failed without details"
        | RunFailed messages -> Some(String.concat "\n" messages)
        | _ -> None

type RepositoryPermission =
    | NoAccess
    | Read
    | Triage
    | Write
    | Maintain
    | Admin

module RepositoryPermission =
    let canRequestUpdate =
        function
        | Write
        | Maintain
        | Admin -> true
        | _ -> false

module Commands =
    let tryParse (body: string) =
        match body.Trim().ToLowerInvariant() with
        | "/paketabot update" -> Some Update
        | "/paketabot rebase" -> Some Rebase
        | _ -> None

    /// Confirm that a webhook represents a newly-created command candidate.
    ///
    /// decision: ignores edited and deleted comments so changing webhook history cannot replay a command
    let isCreatedComment action =
        String.Equals(action, "created", StringComparison.Ordinal)

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
