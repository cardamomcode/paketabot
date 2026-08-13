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

let private actionRoot () =
    moduleUrl |> fileUrlToPath |> dirname |> dirname

let private start () =
    async {
        try
            let token = requiredInput "token"
            setSecret token

            let workspace = requiredEnvironment "GITHUB_WORKSPACE"
            let owner, name = requiredEnvironment "GITHUB_REPOSITORY" |> repositoryParts
            let runtime = requiredInput "container-runtime"
            let configuredImage = getInput "runner-image"
            let github = OctokitGateway(token) :> IGitHubGateway
            let! repository = github.GetRepository(owner, name)

            let gitOptions =
                createObj [ "cwd" ==> workspace; "timeout" ==> 30_000; "maxBuffer" ==> 1_048_576 ]

            let! (stdout: string), _ = execFile "git" [| "rev-parse"; "HEAD" |] gitOptions |> Async.AwaitPromise
            let baseSha = stdout.Trim()

            match
                Checkouts.validate
                    repository.DefaultBranch
                    (requiredEnvironment "GITHUB_REF")
                    (requiredEnvironment "GITHUB_SHA")
                    baseSha
            with
            | Ok() -> ()
            | Error message -> invalidOp message

            let artifactRoot =
                join [| requiredEnvironment "RUNNER_TEMP"; "paketabot-artifacts" |]

            let artifacts = GitArtifactStore(workspace, artifactRoot) :> IArtifactStore
            let! image = RunnerImage.resolve runtime configuredImage (actionRoot ())
            let runner = ContainerRunner(runtime, image) :> ISandboxRunner
            let service = UpdateService(github, artifacts, runner)
            let! outcome = service.Run(repository, baseSha)

            match outcome with
            | Unchanged ->
                info "Paket dependencies are already current."
                setOutput "outcome" "unchanged"
            | Published publication ->
                info $"Published pull request #{publication.PullRequestNumber}."
                setOutput "outcome" "published"
                setOutput "pull-request-number" publication.PullRequestNumber
            | RunFailed messages ->
                let message =
                    match messages with
                    | [] -> "PaketaBot failed without details."
                    | values -> String.concat "\n" values

                setOutput "outcome" "failed"
                setFailed message
        with ex ->
            setOutput "outcome" "failed"
            setFailed ex.Message
    }

[<EntryPoint>]
let main _ =
    start () |> Async.StartAsPromise |> ignore
    0
