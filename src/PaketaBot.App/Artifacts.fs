namespace PaketaBot.App

open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type LocalArtifactStore(root: string) =
    interface IArtifactStore with
        member _.Put(repository, sha, archive) =
            async {
                let directory = join [| root; repository.Id; sha |]
                do! mkdir directory (createObj [ "recursive" ==> true ]) |> Async.AwaitPromise
                let path = join [| directory; "repository.tar.gz" |]
                do! writeFile path archive |> Async.AwaitPromise
                return path
            }
