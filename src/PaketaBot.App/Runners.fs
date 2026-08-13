namespace PaketaBot.App

open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type NoopRunner() =
    interface ISandboxRunner with
        member _.Run _ =
            async {
                return {
                    Status = NoChange
                    LockFile = None
                    Changes = []
                    Messages = [ "runner disabled; set PAKETABOT_RUNNER_IMAGE to enable container execution" ]
                }
            }

type ContainerRunner(runtime: string, image: string) =
    /// Run the untrusted repository in a credential-free container.
    ///
    /// decision: the control plane passes only filesystem artifacts to keep installation tokens outside the worker
    /// invariant: the container receives no environment variables or mounts containing GitHub credentials
    member private _.Arguments(request: RunnerRequest, outputDirectory: string, outputFile: string) = [|
        "run"
        "--rm"
        "--read-only"
        "--cap-drop=ALL"
        "--security-opt=no-new-privileges"
        "--memory=768m"
        "--cpus=1"
        "--pids-limit=128"
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
                            | Ok result -> return result
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
