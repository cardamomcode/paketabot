namespace PaketaBot.App

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type PaketResolver(workspace: string, executable: string, isolatedHome: string) =
    let readRepositoryFile path description maximumBytes =
        async {
            let! stats = lstat path |> Async.AwaitPromise

            // decision: rejects symlinks before reading so root-only policy cannot escape the checked-out workspace through a link
            // invariant: Paket inputs are regular, non-symbolic-link files whose byte size was checked before readFile
            match
                PaketFiles.validateInput description maximumBytes stats.size (stats.isFile ()) (stats.isSymbolicLink ())
            with
            | Error message -> return invalidOp message
            | Ok() -> return! readFile path "utf8" |> Async.AwaitPromise
        }

    interface IPaketResolver with
        member _.Resolve() =
            async {
                do! mkdir isolatedHome (createObj [ "recursive" ==> true ]) |> Async.AwaitPromise

                let dependenciesPath = join [| workspace; PaketFiles.Dependencies |]
                let lockPath = join [| workspace; PaketFiles.Lock |]

                let! dependencies =
                    readRepositoryFile dependenciesPath PaketFiles.Dependencies PaketFiles.MaxDependenciesBytes

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
                    let! previous = readRepositoryFile lockPath PaketFiles.Lock PaketFiles.MaxLockBytes

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

                    let! _ = execFile executable [| "update"; "--no-install" |] options |> Async.AwaitPromise

                    let! current = readRepositoryFile lockPath PaketFiles.Lock PaketFiles.MaxLockBytes

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
                            Messages = []
                        }
            }
