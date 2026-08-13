namespace PaketaBot.App

open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

module private GitHubValues =
    let data (response: obj) : obj = response?data

    let isTrackedPull repository publisherLogin (value: obj) =
        let body: obj = value?body
        let headRepository: obj = value?head?repo

        not (isNull body)
        && PullRequests.isOwnedBy publisherLogin (string value?user?login) (string body)
        && not (isNull headRepository)
        && string headRepository?full_name = Repository.fullName repository
        && string value?head?``ref`` = Branches.Weekly

type OctokitGateway(token: string) =
    let client = getOctokit token
    let mutable publisherLogin = None

    let call route parameters =
        request client route parameters |> Async.AwaitPromise

    let repoParameters repository = [ "owner" ==> repository.Owner; "repo" ==> repository.Name ]

    let getPublisherLogin () =
        async {
            match publisherLogin with
            | Some value -> return value
            | None ->
                let! response = call "GET /user" (createObj [])
                let value: string = (GitHubValues.data response)?login
                publisherLogin <- Some value
                return value
        }

    let findPull repository state =
        async {
            let! expectedPublisher = getPublisherLogin ()

            let! response =
                call
                    "GET /repos/{owner}/{repo}/pulls"
                    (createObj (
                        repoParameters repository
                        @ [
                            "state" ==> state
                            "head" ==> $"{repository.Owner}:{Branches.Weekly}"
                            "per_page" ==> 100
                        ]
                    ))

            let pulls: obj array = unbox (GitHubValues.data response)
            return pulls |> Array.tryFind (GitHubValues.isTrackedPull repository expectedPublisher)
        }

    interface IGitHubGateway with
        member _.GetRepository(owner, name) =
            async {
                let! response = call "GET /repos/{owner}/{repo}" (createObj [ "owner" ==> owner; "repo" ==> name ])
                let value = GitHubValues.data response

                return {
                    Owner = value?owner?login
                    Name = value?name
                    DefaultBranch = value?default_branch
                }
            }

        member _.TryGetPublication repository =
            async {
                let! pull = findPull repository "all"

                return
                    pull
                    |> Option.map (fun value -> {
                        Branch = Branches.Weekly
                        PullRequestNumber = value?number
                        HeadSha = value?head?sha
                    })
            }

        member _.Publish update =
            async {
                if not (Branches.isOwned update.Branch) then
                    invalidArg (nameof update.Branch) "PaketaBot can only publish its owned weekly branch"

                if not (PaketFiles.isLock update.Path) then
                    invalidArg (nameof update.Path) "PaketaBot can only publish paket.lock"

                let repo = repoParameters update.Repository

                let! currentRef =
                    call
                        "GET /repos/{owner}/{repo}/git/ref/{ref}"
                        (createObj (repo @ [ "ref" ==> $"heads/{update.Branch}" ]))
                    |> Async.Catch

                let currentHead =
                    match currentRef with
                    | Choice1Of2 response -> Some((GitHubValues.data response)?``object``?sha)
                    | Choice2Of2 error when isNotFound error -> None
                    | Choice2Of2 error -> raise error

                let expectedHead = update.PreviousPublication |> Option.map _.HeadSha

                let publicationPlan =
                    match Branches.planPublication update.BaseSha expectedHead currentHead with
                    | Ok plan -> plan
                    | Error message -> invalidOp message

                let parentSha =
                    match publicationPlan with
                    | Branches.CreateFrom baseSha -> baseSha
                    | Branches.FastForwardFrom verifiedHead -> verifiedHead

                let! blob =
                    call
                        "POST /repos/{owner}/{repo}/git/blobs"
                        (createObj (repo @ [ "content" ==> toBase64 update.Content; "encoding" ==> "base64" ]))

                let blobSha: string = (GitHubValues.data blob)?sha

                let treeItem =
                    createObj [
                        "path" ==> update.Path
                        "mode" ==> "100644"
                        "type" ==> "blob"
                        "sha" ==> blobSha
                    ]

                let! tree =
                    call
                        "POST /repos/{owner}/{repo}/git/trees"
                        (createObj (repo @ [ "base_tree" ==> update.BaseSha; "tree" ==> [| treeItem |] ]))

                let treeSha: string = (GitHubValues.data tree)?sha

                let! commit =
                    call
                        "POST /repos/{owner}/{repo}/git/commits"
                        (createObj (
                            repo
                            @ [
                                "message" ==> update.Title
                                "tree" ==> treeSha
                                "parents" ==> [| parentSha |]
                            ]
                        ))

                let commitSha: string = (GitHubValues.data commit)?sha

                match publicationPlan with
                | Branches.FastForwardFrom _ ->
                    let! _ =
                        call
                            "PATCH /repos/{owner}/{repo}/git/refs/{ref}"
                            (createObj (
                                repo
                                @ [ "ref" ==> $"heads/{update.Branch}"; "sha" ==> commitSha; "force" ==> false ]
                            ))

                    ()
                | Branches.CreateFrom _ ->
                    let! _ =
                        call
                            "POST /repos/{owner}/{repo}/git/refs"
                            (createObj (repo @ [ "ref" ==> $"refs/heads/{update.Branch}"; "sha" ==> commitSha ]))

                    ()

                let! existing = findPull update.Repository "open"

                let! pull =
                    match existing with
                    | Some value ->
                        let number: int = value?number

                        call
                            "PATCH /repos/{owner}/{repo}/pulls/{pull_number}"
                            (createObj (
                                repo
                                @ [ "pull_number" ==> number; "title" ==> update.Title; "body" ==> update.Body ]
                            ))
                    | None ->
                        call
                            "POST /repos/{owner}/{repo}/pulls"
                            (createObj (
                                repo
                                @ [
                                    "title" ==> update.Title
                                    "body" ==> update.Body
                                    "head" ==> update.Branch
                                    "base" ==> update.Repository.DefaultBranch
                                ]
                            ))

                let pullData = GitHubValues.data pull

                return {
                    Branch = update.Branch
                    PullRequestNumber = pullData?number
                    HeadSha = commitSha
                }
            }
