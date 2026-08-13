module PaketaBot.Runner.Program

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.Runner.Bindings

let private failed message = {
    Status = Failed
    LockFile = None
    Changes = []
    Messages = [ message ]
}

let private run archivePath outputPath =
    async {
        let! workspace = mkdtemp (join [| tempDirectory (); "paketabot-worker-" |]) |> Async.AwaitPromise

        let write result =
            writeFile outputPath (Serialization.encodeResult result) |> Async.AwaitPromise

        do!
            async {
                try
                    let options =
                        createObj [ "cwd" ==> workspace; "timeout" ==> 60_000; "maxBuffer" ==> 1_048_576 ]

                    let! _ =
                        execFile "tar" [| "-xzf"; archivePath; "--strip-components=1" |] options
                        |> Async.AwaitPromise

                    let dependenciesPath = join [| workspace; "paket.dependencies" |]
                    let lockPath = join [| workspace; "paket.lock" |]
                    let! dependencies = readFile dependenciesPath "utf8" |> Async.AwaitPromise

                    match Eligibility.inspect dependencies with
                    | Ineligible reasons ->
                        do!
                            write {
                                Status = Rejected
                                LockFile = None
                                Changes = []
                                Messages = reasons
                            }
                    | Eligible ->
                        let! previous = readFile lockPath "utf8" |> Async.AwaitPromise

                        let updateOptions =
                            createObj [ "cwd" ==> workspace; "timeout" ==> 540_000; "maxBuffer" ==> 1_048_576 ]

                        let! _, stderr =
                            execFile "paket" [| "update"; "--no-install" |] updateOptions
                            |> Async.AwaitPromise

                        let! current = readFile lockPath "utf8" |> Async.AwaitPromise

                        if current = previous then
                            do!
                                write {
                                    Status = NoChange
                                    LockFile = None
                                    Changes = []
                                    Messages = []
                                }
                        else
                            do!
                                write {
                                    Status = Updated
                                    LockFile = Some current
                                    Changes = LockDiff.changes previous current
                                    Messages =
                                        if String.IsNullOrWhiteSpace(stderr) then
                                            []
                                        else
                                            [ stderr.Trim() ]
                                }
                with ex ->
                    do! write (failed ex.Message)
            }

        do!
            removePath workspace (createObj [ "recursive" ==> true; "force" ==> true ])
            |> Async.AwaitPromise
    }

[<EntryPoint>]
let main _ =
    match arguments () with
    | [| archivePath; outputPath |] ->
        run archivePath outputPath |> Async.StartAsPromise |> ignore
        0
    | _ -> failwith "usage: paketabot-runner <repository.tar.gz> <result.json>"
