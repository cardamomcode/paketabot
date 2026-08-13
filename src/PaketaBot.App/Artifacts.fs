namespace PaketaBot.App

open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type GitArtifactStore(workspace: string, root: string) =
    interface IArtifactStore with
        member _.Create(repository, sha) =
            async {
                let directory = join [| root; repository.Owner; repository.Name; sha |]
                do! mkdir directory (createObj [ "recursive" ==> true ]) |> Async.AwaitPromise
                let path = join [| directory; "repository.tar.gz" |]

                let options =
                    createObj [ "cwd" ==> workspace; "timeout" ==> 60_000; "maxBuffer" ==> 1_048_576 ]

                // decision: archives the exact Git commit so .git credentials and untracked workspace files never enter the runner
                // invariant: one synthetic root preserves repository-relative paths when the runner strips one archive component
                let! _ =
                    execFile "git" [| "archive"; "--format=tar.gz"; "--prefix=repository/"; "-o"; path; sha |] options
                    |> Async.AwaitPromise

                return path
            }
