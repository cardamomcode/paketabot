namespace PaketaBot.App

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

module private GitHubValues =
    let data (response: obj) : obj = response?data
    let sha (response: obj) : string = (data response)?sha

    let permission value =
        match string value with
        | "admin" -> Admin
        | "maintain" -> Maintain
        | "write" -> Write
        | "triage" -> Triage
        | "read" -> Read
        | _ -> NoAccess

type OctokitGateway(app: GitHubApp) =
    let client installationId =
        getInstallationOctokit app installationId |> Async.AwaitPromise

    let call installationId route parameters =
        async {
            let! octokit = client installationId
            return! request octokit route parameters |> Async.AwaitPromise
        }

    let repoParameters repository = [ "owner" ==> repository.Owner; "repo" ==> repository.Name ]

    interface IGitHubGateway with
        member _.GetDefaultHead repository =
            async {
                let! response =
                    call
                        repository.InstallationId
                        "GET /repos/{owner}/{repo}/git/ref/{ref}"
                        (createObj (repoParameters repository @ [ "ref" ==> $"heads/{repository.DefaultBranch}" ]))

                return (GitHubValues.data response)?``object``?sha
            }

        member _.DownloadArchive(repository, sha) =
            async {
                let! response =
                    call
                        repository.InstallationId
                        "GET /repos/{owner}/{repo}/tarball/{ref}"
                        (createObj (repoParameters repository @ [ "ref" ==> sha ]))

                return unbox<byte array> (GitHubValues.data response)
            }

        member _.GetPermission(repository, login) =
            async {
                let! response =
                    call
                        repository.InstallationId
                        "GET /repos/{owner}/{repo}/collaborators/{username}/permission"
                        (createObj (repoParameters repository @ [ "username" ==> login ]))

                return GitHubValues.permission ((GitHubValues.data response)?permission)
            }

        member _.Publish update =
            async {
                if not (Branches.isOwned update.Branch) then
                    invalidArg (nameof update.Branch) "PaketaBot can only publish its owned weekly branch"

                let installationId = update.Repository.InstallationId
                let repo = repoParameters update.Repository

                // invariant: an existing bot branch matches the last recorded head before PaketaBot creates objects or moves its ref
                let! currentRef =
                    call
                        installationId
                        "GET /repos/{owner}/{repo}/git/ref/{ref}"
                        (createObj (repo @ [ "ref" ==> $"heads/{update.Branch}" ]))
                    |> Async.Catch

                let currentHead =
                    match currentRef with
                    | Choice1Of2 response -> Some((GitHubValues.data response)?``object``?sha)
                    | Choice2Of2 error when isNotFound error -> None
                    | Choice2Of2 error -> raise error

                let publicationPlan =
                    match Branches.planPublication update.BaseSha update.ExpectedHead currentHead with
                    | Ok plan -> plan
                    | Error message -> invalidOp message

                let parentSha =
                    match publicationPlan with
                    | Branches.CreateFrom baseSha -> baseSha
                    | Branches.FastForwardFrom verifiedHead -> verifiedHead

                let! blob =
                    call
                        installationId
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
                        installationId
                        "POST /repos/{owner}/{repo}/git/trees"
                        (createObj (repo @ [ "base_tree" ==> update.BaseSha; "tree" ==> [| treeItem |] ]))

                let treeSha: string = (GitHubValues.data tree)?sha

                let! commit =
                    call
                        installationId
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
                            installationId
                            "PATCH /repos/{owner}/{repo}/git/refs/{ref}"
                            (createObj (
                                repo
                                @ [ "ref" ==> $"heads/{update.Branch}"; "sha" ==> commitSha; "force" ==> false ]
                            ))

                    ()
                | Branches.CreateFrom _ ->
                    let! _ =
                        call
                            installationId
                            "POST /repos/{owner}/{repo}/git/refs"
                            (createObj (repo @ [ "ref" ==> $"refs/heads/{update.Branch}"; "sha" ==> commitSha ]))

                    ()

                let! pulls =
                    call
                        installationId
                        "GET /repos/{owner}/{repo}/pulls"
                        (createObj (
                            repo
                            @ [ "state" ==> "open"; "head" ==> $"{update.Repository.Owner}:{update.Branch}" ]
                        ))

                let existing: obj array = unbox (GitHubValues.data pulls)

                let! pull =
                    if existing.Length > 0 then
                        let number: int = existing[0]?number

                        call
                            installationId
                            "PATCH /repos/{owner}/{repo}/pulls/{pull_number}"
                            (createObj (
                                repo
                                @ [ "pull_number" ==> number; "title" ==> update.Title; "body" ==> update.Body ]
                            ))
                    else
                        call
                            installationId
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

        member _.Comment(repository, pullRequest, body) =
            async {
                let! _ =
                    call
                        repository.InstallationId
                        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments"
                        (createObj (repoParameters repository @ [ "issue_number" ==> pullRequest; "body" ==> body ]))

                return ()
            }

type FakeGitHubGateway() =
    let mutable archive = [||]
    let mutable head = String.replicate 40 "a"
    let mutable permission = Admin
    let mutable publicationNumber = 0
    let publications = ResizeArray<PublishUpdate>()

    member _.Archive
        with get () = archive
        and set value = archive <- value

    member _.Head
        with get () = head
        and set value = head <- value

    member _.Permission
        with get () = permission
        and set value = permission <- value

    member _.Publications = publications |> Seq.toList

    interface IGitHubGateway with
        member _.GetDefaultHead _ = async { return head }
        member _.DownloadArchive(_, _) = async { return archive }
        member _.GetPermission(_, _) = async { return permission }

        member _.Publish update =
            async {
                publications.Add update
                publicationNumber <- max 1 publicationNumber

                return {
                    Branch = update.Branch
                    PullRequestNumber = publicationNumber
                    HeadSha = String.replicate 40 "b"
                }
            }

        member _.Comment(_, _, _) = async { return () }
