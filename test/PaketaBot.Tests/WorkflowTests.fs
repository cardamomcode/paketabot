module PaketaBot.Tests.WorkflowTests

open Scriptorium.Quill
open Scriptorium.Nib.Assertion
open type Scriptorium.Quill.Test
open PaketaBot

type private GitHub(previousPublication: Publication option) =
    let mutable published = None

    member _.Published = published

    interface IGitHubGateway with
        member _.GetRepository(owner, name) =
            async {
                return {
                    Owner = owner
                    Name = name
                    DefaultBranch = "main"
                }
            }

        member _.TryGetPublication _ = async { return previousPublication }

        member _.Publish value =
            async {
                published <- Some value

                return {
                    Branch = value.Branch
                    PullRequestNumber = 42
                    HeadSha = String.replicate 40 "b"
                }
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
                        let github = GitHub(None)
                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", updatedResult)

                        match outcome, github.Published with
                        | Published publication, Some update ->
                            assertThat publication.PullRequestNumber (isEqualTo 42)
                            assertThat update.Branch (isEqualTo Branches.Weekly)
                            assertThat update.PreviousPublication (isEqualTo None)
                            assertThat (update.Body.Contains(PullRequests.Marker)) isTrue
                            assertThat (update.Body.Contains("Fable.Core")) isTrue
                        | _ -> failwith "expected an update publication"
                    }
            )
            testAsync (
                "does not publish an unchanged resolution",
                fun _ ->
                    async {
                        let github = GitHub(None)

                        let unchanged = {
                            Status = NoChange
                            LockFile = None
                            Changes = []
                            Messages = []
                        }

                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", unchanged)
                        assertThat outcome (isEqualTo Unchanged)
                        assertThat github.Published.IsNone isTrue
                    }
            )
            testAsync (
                "surfaces resolution failures without publishing",
                fun _ ->
                    async {
                        let github = GitHub(None)

                        let failed = {
                            Status = Failed
                            LockFile = None
                            Changes = []
                            Messages = [ "resolver timed out" ]
                        }

                        let! outcome = PublishService(github).Run(repository, String.replicate 40 "a", failed)
                        assertThat outcome (isEqualTo (RunFailed [ "resolver timed out" ]))
                        assertThat github.Published.IsNone isTrue
                    }
            )
            testAsync (
                "carries pull request publication state into a refresh",
                fun _ ->
                    async {
                        let previous = {
                            Branch = Branches.Weekly
                            PullRequestNumber = 42
                            HeadSha = String.replicate 40 "c"
                        }

                        let github = GitHub(Some previous)
                        let! _ = PublishService(github).Run(repository, String.replicate 40 "a", updatedResult)

                        match github.Published with
                        | Some update -> assertThat update.PreviousPublication (isEqualTo (Some previous))
                        | None -> failwith "expected an update publication"
                    }
            )
        ]
    )

let tests = testList ("workflow", [ resolveTests; publishTests ])
