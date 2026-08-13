module PaketaBot.App.Program

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App
open PaketaBot.App.Bindings

let private requiredInput name =
    let value = getInput name

    if String.IsNullOrWhiteSpace(value) then
        invalidOp $"the {name} input is required"

    value

let private requiredEnvironment name =
    let value = env name

    if String.IsNullOrWhiteSpace(value) then
        invalidOp $"{name} must be set by GitHub Actions"

    value

let private repositoryParts (value: string) =
    match value.Split('/') with
    | [| owner; name |] when not (String.IsNullOrWhiteSpace(owner) || String.IsNullOrWhiteSpace(name)) -> owner, name
    | _ -> invalidOp "GITHUB_REPOSITORY must have the form owner/name"

let private requireValid result =
    match result with
    | Ok() -> ()
    | Error message -> invalidOp message

let private failureMessage messages =
    match messages with
    | [] -> "PaketaBot failed without details."
    | values -> String.concat "\n" values

let private writeResolution path artifact =
    async {
        do! mkdir (dirname path) (createObj [ "recursive" ==> true ]) |> Async.AwaitPromise
        do! writeFile path (Serialization.encodeArtifact artifact) |> Async.AwaitPromise
    }

let private resolveDependencies () =
    async {
        let workspace = requiredEnvironment "GITHUB_WORKSPACE"
        let repository = requiredEnvironment "GITHUB_REPOSITORY"
        let eventSha = requiredEnvironment "GITHUB_SHA"
        let resultPath = requiredInput "result-path"
        let paketPath = requiredInput "paket-path"

        let gitOptions =
            createObj [ "cwd" ==> workspace; "timeout" ==> 30_000; "maxBuffer" ==> 1_048_576 ]

        let! (stdout: string), _ = execFile "git" [| "rev-parse"; "HEAD" |] gitOptions |> Async.AwaitPromise
        let checkoutSha = stdout.Trim()
        Checkouts.validateRevision eventSha checkoutSha |> requireValid

        let isolatedHome = join [| requiredEnvironment "RUNNER_TEMP"; "paketabot-home" |]

        let resolver = PaketResolver(workspace, paketPath, isolatedHome) :> IPaketResolver
        let! result = ResolveService(resolver).Run()

        do!
            writeResolution resultPath {
                Repository = repository
                BaseSha = checkoutSha
                Result = result
            }

        match result.Status, result.LockFile with
        | NoChange, _ ->
            info "Paket dependencies are already current."
            setOutput "outcome" "unchanged"
        | Updated, Some _ ->
            info "Paket dependency resolution produced an updated lock file."
            setOutput "outcome" "updated"
        | _ ->
            setOutput "outcome" "failed"
            setFailed (failureMessage result.Messages)
    }

let private publishResolution token =
    async {
        let repositoryName = requiredEnvironment "GITHUB_REPOSITORY"
        let eventSha = requiredEnvironment "GITHUB_SHA"
        let resultPath = requiredInput "result-path"
        let! json = readFile resultPath "utf8" |> Async.AwaitPromise

        let artifact: ResolutionArtifact =
            match Serialization.decodeArtifact json with
            | Ok value -> value
            | Error errors -> errors |> List.map string |> failureMessage |> invalidOp

        ResolutionArtifacts.validate repositoryName eventSha artifact |> requireValid

        let owner, name = repositoryName |> repositoryParts
        let github = OctokitGateway(token) :> IGitHubGateway
        let! repository = github.GetRepository(owner, name)

        Checkouts.validate repository.DefaultBranch (requiredEnvironment "GITHUB_REF") eventSha artifact.BaseSha
        |> requireValid

        let! outcome = PublishService(github).Run(repository, artifact.BaseSha, artifact.Result)

        match outcome with
        | Unchanged -> invalidOp "the publisher received an unchanged resolution"
        | Published publication ->
            info $"Published pull request #{publication.PullRequestNumber}."
            setOutput "outcome" "published"
            setOutput "pull-request-number" publication.PullRequestNumber
        | RunFailed messages ->
            setOutput "outcome" "failed"
            setFailed (failureMessage messages)
    }

let private start () =
    async {
        try
            let token = getInput "token"

            if not (String.IsNullOrWhiteSpace(token)) then
                setSecret token

            let operation =
                match requiredInput "operation" |> ActionOperation.parse with
                | Ok value -> value
                | Error message -> invalidOp message

            ActionOperation.validateToken operation (not (String.IsNullOrWhiteSpace(token)))
            |> requireValid

            match operation with
            | ResolveOperation -> do! resolveDependencies ()
            | PublishOperation -> do! publishResolution token
        with ex ->
            setOutput "outcome" "failed"
            setFailed ex.Message
    }

[<EntryPoint>]
let main _ =
    start () |> Async.StartAsPromise |> ignore
    0
