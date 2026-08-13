namespace PaketaBot.App

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

module RunnerImage =
    /// Resolve a prebuilt image or build the bundled credential-free runner locally.
    ///
    /// decision: builds the bundled runner when no image is supplied so the Action has no external hosting prerequisite
    /// tradeoff: increases cold-start time until release automation can publish a versioned runner image
    let resolve runtime configuredImage actionRoot =
        async {
            if not (String.IsNullOrWhiteSpace(configuredImage)) then
                return configuredImage
            else
                let runId = env "GITHUB_RUN_ID"

                let suffix = if String.IsNullOrWhiteSpace(runId) then "local" else runId

                let image = $"paketabot-runner:{suffix}"
                info $"Building bundled Paket runner image {image}"

                let options = createObj [ "timeout" ==> 600_000; "maxBuffer" ==> 16_777_216 ]

                let! _ =
                    execFile
                        runtime
                        [|
                            "build"
                            "--file"
                            join [| actionRoot; "Containerfile.runner" |]
                            "--tag"
                            image
                            actionRoot
                        |]
                        options
                    |> Async.AwaitPromise

                return image
        }

type ContainerRunner(runtime: string, image: string) =
    /// Run the untrusted repository in a credential-free container.
    ///
    /// decision: the Action passes only filesystem artifacts to keep PAKETABOT_TOKEN outside the worker
    /// invariant: the container inherits no host environment variables or mounts containing GitHub credentials
    member private _.Arguments(request: RunnerRequest, outputDirectory: string, outputFile: string) = [|
        "run"
        "--rm"
        "--read-only"
        "--cap-drop=ALL"
        "--security-opt=no-new-privileges"
        "--memory=768m"
        "--cpus=1"
        "--pids-limit=128"
        $"--user={userId ()}:{groupId ()}"
        "--env=HOME=/tmp"
        "--env=DOTNET_CLI_HOME=/tmp/dotnet"
        "--env=DOTNET_NOLOGO=1"
        "--env=DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1"
        "--tmpfs=/tmp:rw,noexec,nosuid,size=512m"
        $"--volume={request.ArtifactPath}:/input/repository.tar.gz:ro"
        $"--volume={outputDirectory}:/output:rw"
        image
        "/input/repository.tar.gz"
        $"/output/{outputFile}"
    |]

    interface ISandboxRunner with
        member this.Run request =
            async {
                let! outputDirectory = mkdtemp (join [| tempDirectory (); "paketabot-run-" |]) |> Async.AwaitPromise
                let outputFile = "result.json"

                let! result =
                    async {
                        try
                            let options = createObj [ "timeout" ==> 600_000; "maxBuffer" ==> 1_048_576 ]

                            let! _ =
                                execFile runtime (this.Arguments(request, outputDirectory, outputFile)) options
                                |> Async.AwaitPromise

                            let! json = readFile (join [| outputDirectory; outputFile |]) "utf8" |> Async.AwaitPromise

                            match Serialization.decodeResult json with
                            | Ok value -> return value
                            | Error errors ->
                                return {
                                    Status = Failed
                                    LockFile = None
                                    Changes = []
                                    Messages = errors |> List.map string
                                }
                        with ex ->
                            return {
                                Status = Failed
                                LockFile = None
                                Changes = []
                                Messages = [ ex.Message ]
                            }
                    }

                do!
                    removePath outputDirectory (createObj [ "recursive" ==> true; "force" ==> true ])
                    |> Async.AwaitPromise

                return result
            }
