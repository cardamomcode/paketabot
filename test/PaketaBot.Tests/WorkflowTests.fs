module PaketaBot.Tests.WorkflowTests

open Scriptorium.Quill
open Scriptorium.Nib.Assertion
open type Scriptorium.Quill.Test
open PaketaBot

type private GitHubFailure =
    | NoFailure
    | FailCreatePullRequest
    | LoseCreatePullRequestResponse
    | FailUpdatePullRequest

type private GitHub(initialPublication: Publication option, initialHead: string option, initialFailure: GitHubFailure) =
    let operations = ResizeArray<string>()
    let mutable currentPublication = initialPublication
    let mutable currentHead = initialHead
    let mutable failure = initialFailure
    let mutable published = None
    let mutable commitNumber = 0

    member _.Published = published
    member _.CurrentHead = currentHead
    member _.CurrentPublication = currentPublication
    member _.Operations = operations |> Seq.toList
    member _.ClearOperations() = operations.Clear()

    interface IGitHubGateway with
        member _.GetRepository(owner, name) =
            async {
                return {
                    Owner = owner
                    Name = name
                    DefaultBranch = "main"
                }
            }

        member _.TryGetPublication _ =
            async {
                operations.Add("get publication")
                return currentPublication
            }

        member _.GetBranchHead(_, _) =
            async {
                operations.Add("get branch head")
                return currentHead
            }

        member _.CreateCommit(value, parentShas) =
            async {
                let parentDescription = String.concat " + " parentShas
                operations.Add($"create commit from {parentDescription}")
                published <- Some value
                commitNumber <- commitNumber + 1
                return $"commit-{commitNumber}"
            }

        member _.CreateBranch(_, branch, commitSha) =
            async {
                operations.Add($"create {branch}")
                currentHead <- Some commitSha
            }

        member _.FastForwardBranch(_, branch, commitSha) =
            async {
                operations.Add($"fast-forward {branch}")
                currentHead <- Some commitSha

                currentPublication <-
                    currentPublication
                    |> Option.map (fun publication -> { publication with HeadSha = commitSha })
            }

        member _.CreatePullRequest _ =
            async {
                operations.Add("create pull request")

                match failure with
                | FailCreatePullRequest -> return failwith "pull request creation failed"
                | LoseCreatePullRequestResponse ->
                    failure <- NoFailure

                    currentPublication <-
                        Some {
                            Branch = Branches.Weekly
                            PullRequestNumber = 42
                            HeadSha = currentHead.Value
                            IsOpen = true
                        }

                    return failwith "pull request response was lost"
                | _ ->
                    currentPublication <-
                        Some {
                            Branch = Branches.Weekly
                            PullRequestNumber = 42
                            HeadSha = currentHead.Value
                            IsOpen = true
                        }

                    return 42
            }

        member _.UpdatePullRequest(_, pullRequestNumber) =
            async {
                operations.Add($"update pull request {pullRequestNumber}")

                match failure with
                | FailUpdatePullRequest -> return failwith "pull request update failed"
                | _ -> return ()
            }

type private Resolver(result: ResolutionResult) =
    interface IPaketResolver with
        member _.Resolve() = async { return result }

type private ThrowingResolver() =
    interface IPaketResolver with
        member _.Resolve() =
            async { return failwith "resolution crashed" }

let private repository = {
    Owner = "example"
    Name = "service"
    DefaultBranch = "main"
}

let private updatedResult = {
    Status = Updated
    LockFile = Some "NUGET\n  specs:\n    Fable.Core (5.2.0)"
    Changes = [
        {
            Name = "Fable.Core"
            Previous = "5.1.0"
            Current = "5.2.0"
        }
    ]
    RequirementChanges = []
    Messages = []
}

let private resolveTests =
    testList (
        "resolve",
        [
            testAsync (
                "returns the credential-free resolver result",
                fun _ ->
                    async {
                        let! result = ResolveService(Resolver updatedResult).Run()
                        assertThat result (isEqualTo updatedResult)
                    }
            )
            testAsync (
                "turns resolver exceptions into a typed failure",
                fun _ ->
                    async {
                        let! result = ResolveService(ThrowingResolver()).Run()
                        assertThat result.Status (isEqualTo Failed)
                        assertThat result.Messages (isEqualTo [ "resolution crashed" ])
                    }
            )
        ]
    )

let private publishTests =
    testList (
        "publish",
        [
            testAsync (
                "publishes one stable marked pull request",
                fun _ ->
                    async {
                        let github = GitHub(None, None, NoFailure)
                        let baseSha = String.replicate 40 "a"
                        let! outcome = PublishService(github).Run(repository, baseSha, updatedResult)

                        match outcome, github.Published with
                        | Published publication, Some update ->
                            assertThat publication.PullRequestNumber (isEqualTo 42)
                            assertThat update.Branch (isEqualTo Branches.Weekly)
                            assertThat (update.Body.Contains(PullRequests.Marker)) isTrue
                            assertThat (update.Body.Contains("Fable.Core")) isTrue

                            assertThat
                                github.Operations
                                (isEqualTo [
                                    "get publication"
                                    "get branch head"
                                    $"create commit from {baseSha}"
                                    $"create {Branches.Weekly}"
                                    "create pull request"
                                ])
                        | _ -> failwith "expected an update publication"
                    }
            )
            testAsync (
                "does not publish an unchanged resolution",
                fun _ ->
                    async {
                        let github = GitHub(None, None, NoFailure)

                        let unchanged = {
                            Status = NoChange
                            LockFile = None
                            Changes = []
                            RequirementChanges = []
                            Messages = []
                        }

                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", unchanged)
                        assertThat outcome (isEqualTo Unchanged)
                        assertThat github.Published.IsNone isTrue
                        assertThat github.Operations (isEqualTo [])
                    }
            )
            testAsync (
                "surfaces resolution failures without publishing",
                fun _ ->
                    async {
                        let github = GitHub(None, None, NoFailure)

                        let failed = {
                            Status = Failed
                            LockFile = None
                            Changes = []
                            RequirementChanges = []
                            Messages = [ "resolver timed out" ]
                        }

                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", failed)
                        assertThat outcome (isEqualTo (RunFailed [ "resolver timed out" ]))
                        assertThat github.Published.IsNone isTrue
                        assertThat github.Operations (isEqualTo [])
                    }
            )
            testAsync (
                "updates an open pull request before fast-forwarding its branch",
                fun _ ->
                    async {
                        let previous = {
                            Branch = Branches.Weekly
                            PullRequestNumber = 42
                            HeadSha = String.replicate 40 "c"
                            IsOpen = true
                        }

                        let github = GitHub(Some previous, Some previous.HeadSha, NoFailure)
                        let baseSha = String.replicate 40 "a"
                        let! outcome = PublishService(github).Run(repository, baseSha, updatedResult)

                        match outcome with
                        | Published publication ->
                            assertThat publication.PullRequestNumber (isEqualTo previous.PullRequestNumber)

                            assertThat
                                github.Operations
                                (isEqualTo [
                                    "get publication"
                                    "get branch head"
                                    $"create commit from {previous.HeadSha} + {baseSha}"
                                    $"update pull request {previous.PullRequestNumber}"
                                    $"fast-forward {Branches.Weekly}"
                                ])
                        | _ -> failwith "expected an update publication"
                    }
            )
            testAsync (
                "does not move an open branch when pull request refresh fails",
                fun _ ->
                    async {
                        let previous = {
                            Branch = Branches.Weekly
                            PullRequestNumber = 42
                            HeadSha = String.replicate 40 "c"
                            IsOpen = true
                        }

                        let github = GitHub(Some previous, Some previous.HeadSha, FailUpdatePullRequest)
                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", updatedResult)

                        match outcome with
                        | RunFailed [ message ] -> assertThat message (isEqualTo "pull request update failed")
                        | _ -> failwith "expected a failed publication"

                        assertThat github.CurrentHead (isEqualTo (Some previous.HeadSha))
                        assertThat (github.Operations |> List.contains $"fast-forward {Branches.Weekly}") isFalse
                    }
            )
            testAsync (
                "fast-forwards a closed publication before creating its successor",
                fun _ ->
                    async {
                        let previous = {
                            Branch = Branches.Weekly
                            PullRequestNumber = 41
                            HeadSha = String.replicate 40 "c"
                            IsOpen = false
                        }

                        let github = GitHub(Some previous, Some previous.HeadSha, NoFailure)
                        let baseSha = String.replicate 40 "a"
                        let! outcome = PublishService(github).Run(repository, baseSha, updatedResult)

                        match outcome with
                        | Published publication -> assertThat publication.PullRequestNumber (isEqualTo 42)
                        | _ -> failwith "expected a successor pull request"

                        assertThat
                            github.Operations
                            (isEqualTo [
                                "get publication"
                                "get branch head"
                                $"create commit from {previous.HeadSha} + {baseSha}"
                                $"fast-forward {Branches.Weekly}"
                                "create pull request"
                            ])
                    }
            )
            testAsync (
                "recovers when GitHub creates the pull request but loses its response",
                fun _ ->
                    async {
                        let github = GitHub(None, None, LoseCreatePullRequestResponse)
                        let service = PublishService(github)
                        let baseSha = String.replicate 40 "a"
                        let! first = service.Run(repository, baseSha, updatedResult)

                        match first with
                        | RunFailed [ message ] -> assertThat (message.Contains("Rerun PaketaBot first")) isTrue
                        | _ -> failwith "expected the uncertain first publication to fail"

                        assertThat github.CurrentPublication.IsSome isTrue
                        github.ClearOperations()

                        let! second = service.Run(repository, baseSha, updatedResult)

                        match second with
                        | Published publication -> assertThat publication.PullRequestNumber (isEqualTo 42)
                        | _ -> failwith "expected the retry to recover publication state"

                        assertThat
                            github.Operations
                            (isEqualTo [
                                "get publication"
                                "get branch head"
                                $"create commit from commit-1 + {baseSha}"
                                "update pull request 42"
                                $"fast-forward {Branches.Weekly}"
                            ])
                    }
            )
            testAsync (
                "fails closed when a new branch has no confirmed pull request",
                fun _ ->
                    async {
                        let github = GitHub(None, None, FailCreatePullRequest)
                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", updatedResult)

                        match outcome with
                        | RunFailed [ message ] -> assertThat (message.Contains("recovery procedure")) isTrue
                        | _ -> failwith "expected publication to fail closed"

                        assertThat github.CurrentHead.IsSome isTrue
                        assertThat github.CurrentPublication.IsNone isTrue
                    }
            )
        ]
    )

let tests = testList ("workflow", [ resolveTests; publishTests ])
