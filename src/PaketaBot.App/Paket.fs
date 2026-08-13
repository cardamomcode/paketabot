namespace PaketaBot.App

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type PaketResolver(workspace: string, executable: string, isolatedHome: string) =
    interface IPaketResolver with
        member _.Resolve() =
            async {
                do! mkdir isolatedHome (createObj [ "recursive" ==> true ]) |> Async.AwaitPromise

                let dependenciesPath = join [| workspace; "paket.dependencies" |]
                let lockPath = join [| workspace; PaketFiles.Lock |]
                let! dependencies = readFile dependenciesPath "utf8" |> Async.AwaitPromise

                match Eligibility.inspect dependencies with
                | Ineligible reasons ->
                    return {
                        Status = Rejected
                        LockFile = None
                        Changes = []
                        RequirementChanges = []
                        Messages = reasons
                    }
                | Eligible ->
                    let! previous = readFile lockPath "utf8" |> Async.AwaitPromise

                    // decision: allowlists the Paket child environment so Actions runtime and GitHub credentials are not inherited
                    // invariant: only non-secret process settings cross from the resolver Action into Paket
                    let childEnvironment =
                        createObj [
                            "PATH" ==> env "PATH"
                            "HOME" ==> isolatedHome
                            "TMPDIR" ==> isolatedHome
                            "DOTNET_ROOT" ==> env "DOTNET_ROOT"
                            "DOTNET_CLI_HOME" ==> join [| isolatedHome; "dotnet" |]
                            "DOTNET_NOLOGO" ==> "1"
                            "DOTNET_SKIP_FIRST_TIME_EXPERIENCE" ==> "1"
                            "NUGET_PACKAGES" ==> join [| isolatedHome; "nuget" |]
                        ]

                    let options =
                        createObj [
                            "cwd" ==> workspace
                            "env" ==> childEnvironment
                            "timeout" ==> 540_000
                            "maxBuffer" ==> 1_048_576
                        ]

                    let! _, stderr = execFile executable [| "update"; "--no-install" |] options |> Async.AwaitPromise

                    let! current = readFile lockPath "utf8" |> Async.AwaitPromise

                    if current = previous then
                        return {
                            Status = NoChange
                            LockFile = None
                            Changes = []
                            RequirementChanges = []
                            Messages = []
                        }
                    else
                        return {
                            Status = Updated
                            LockFile = Some current
                            Changes = LockDiff.changes previous current
                            RequirementChanges = LockDiff.requirementChanges previous current
                            Messages =
                                if String.IsNullOrWhiteSpace(stderr) then
                                    []
                                else
                                    [ stderr.Trim() ]
                        }
            }
