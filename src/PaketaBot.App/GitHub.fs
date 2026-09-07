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
                            "sort" ==> "created"
                            "direction" ==> "desc"
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
                // decision: prefers the open ownership record because the stable branch can have several historical pull requests
                // invariant: a newer closed pull request is considered only when no owned open pull request exists
                let! openPull = findPull repository "open"

                let! pull =
                    match openPull with
                    | Some value -> async { return Some value }
                    | None -> findPull repository "closed"

                return
                    pull
                    |> Option.map (fun value -> {
                        Branch = Branches.Weekly
                        PullRequestNumber = value?number
                        HeadSha = value?head?sha
                        IsOpen = string value?state = "open"
                    })
            }

        member _.GetBranchHead(repository, branch) =
            async {
                if not (Branches.isOwned branch) then
                    invalidArg (nameof branch) "PaketaBot can only inspect its owned weekly branch"

                let repo = repoParameters repository

                let! currentRef =
                    call "GET /repos/{owner}/{repo}/git/ref/{ref}" (createObj (repo @ [ "ref" ==> $"heads/{branch}" ]))
                    |> Async.Catch

                return
                    match currentRef with
                    | Choice1Of2 response -> Some((GitHubValues.data response)?``object``?sha)
                    | Choice2Of2 error when isNotFound error -> None
                    | Choice2Of2 error -> raise error
            }

        member _.CreateCommit(update, parentShas) =
            async {
                if not (Branches.isOwned update.Branch) then
                    invalidArg (nameof update.Branch) "PaketaBot can only publish its owned weekly branch"

                if not (PaketFiles.isLock update.Path) then
                    invalidArg (nameof update.Path) "PaketaBot can only publish paket.lock"

                if List.isEmpty parentShas || not (List.contains update.BaseSha parentShas) then
                    invalidArg (nameof parentShas) "PaketaBot commits must descend from the exact base revision"

                let repo = repoParameters update.Repository

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
                                "parents" ==> List.toArray parentShas
                            ]
                        ))

                let commitSha: string = (GitHubValues.data commit)?sha
                return commitSha
            }

        member _.CreateBranch(repository, branch, commitSha) =
            async {
                if not (Branches.isOwned branch) then
                    invalidArg (nameof branch) "PaketaBot can only create its owned weekly branch"

                let! _ =
                    call
                        "POST /repos/{owner}/{repo}/git/refs"
                        (createObj (
                            repoParameters repository
                            @ [ "ref" ==> $"refs/heads/{branch}"; "sha" ==> commitSha ]
                        ))

                return ()
            }

        member _.FastForwardBranch(repository, branch, commitSha) =
            async {
                if not (Branches.isOwned branch) then
                    invalidArg (nameof branch) "PaketaBot can only update its owned weekly branch"

                let! _ =
                    call
                        "PATCH /repos/{owner}/{repo}/git/refs/{ref}"
                        (createObj (
                            repoParameters repository
                            @ [ "ref" ==> $"heads/{branch}"; "sha" ==> commitSha; "force" ==> false ]
                        ))

                return ()
            }

        member _.CreatePullRequest update =
            async {
                let! pull =
                    call
                        "POST /repos/{owner}/{repo}/pulls"
                        (createObj (
                            repoParameters update.Repository
                            @ [
                                "title" ==> update.Title
                                "body" ==> update.Body
                                "head" ==> update.Branch
                                "base" ==> update.Repository.DefaultBranch
                            ]
                        ))

                return (GitHubValues.data pull)?number
            }

        member _.UpdatePullRequest(update, pullRequestNumber) =
            async {
                let! _ =
                    call
                        "PATCH /repos/{owner}/{repo}/pulls/{pull_number}"
                        (createObj (
                            repoParameters update.Repository
                            @ [
                                "pull_number" ==> pullRequestNumber
                                "title" ==> update.Title
                                "body" ==> update.Body
                            ]
                        ))

                return ()
            }
