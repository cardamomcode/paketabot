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

type private Artifacts() =
    interface IArtifactStore with
        member _.Create(_, _) =
            async { return "/artifacts/repository.tar.gz" }

type private Runner(result: RunnerResult) =
    interface ISandboxRunner with
        member _.Run _ = async { return result }

let private repository = {
    Owner = "example"
    Name = "service"
    DefaultBranch = "main"
}

let private updateTests =
    testList (
        "updates",
        [
            testAsync (
                "publishes one stable marked pull request",
                fun _ ->
                    async {
                        let github = GitHub(None)

                        let runner =
                            Runner {
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

                        let service = UpdateService(github, Artifacts(), runner)
                        let! outcome = service.Run(repository, String.replicate 40 "a")

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

                        let runner =
                            Runner {
                                Status = NoChange
                                LockFile = None
                                Changes = []
                                Messages = []
                            }

                        let service = UpdateService(github, Artifacts(), runner)
                        let! outcome = service.Run(repository, String.replicate 40 "a")

                        assertThat outcome (isEqualTo Unchanged)
                        assertThat github.Published.IsNone isTrue
                    }
            )
            testAsync (
                "surfaces runner failures without publishing",
                fun _ ->
                    async {
                        let github = GitHub(None)

                        let runner =
                            Runner {
                                Status = Failed
                                LockFile = None
                                Changes = []
                                Messages = [ "runner timed out" ]
                            }

                        let service = UpdateService(github, Artifacts(), runner)
                        let! outcome = service.Run(repository, String.replicate 40 "a")

                        assertThat outcome (isEqualTo (RunFailed [ "runner timed out" ]))
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

                        let runner =
                            Runner {
                                Status = Updated
                                LockFile = Some "NUGET"
                                Changes = []
                                Messages = []
                            }

                        let service = UpdateService(github, Artifacts(), runner)
                        let! _ = service.Run(repository, String.replicate 40 "a")

                        match github.Published with
                        | Some update -> assertThat update.PreviousPublication (isEqualTo (Some previous))
                        | None -> failwith "expected an update publication"
                    }
            )
        ]
    )

let tests = testList ("workflow", [ updateTests ])
