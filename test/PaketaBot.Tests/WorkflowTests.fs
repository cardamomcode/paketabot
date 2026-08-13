module PaketaBot.Tests.WorkflowTests

open Scriptorium.Quill
open Scriptorium.Nib.Assertion
open type Scriptorium.Quill.Test
open PaketaBot

type private Store(repository: Repository) =
    let mutable publication = None
    let mutable deliveryIds = Set.empty

    member _.Publication = publication

    interface IRepositoryStore with
        member _.Save _ = async { return () }
        member _.Remove _ = async { return () }

        member _.TryGet id =
            async { return if id = repository.Id then Some repository else None }

        member _.ListEnabled() = async { return [ repository ] }
        member _.RecordPublication(_, value) = async { publication <- Some value }
        member _.TryGetPublication _ = async { return publication }

        member _.TryAcceptDelivery deliveryId =
            async {
                let accepted = not (deliveryIds.Contains deliveryId)
                deliveryIds <- deliveryIds.Add deliveryId
                return accepted
            }

        member _.ReleaseDelivery deliveryId =
            async { deliveryIds <- deliveryIds.Remove deliveryId }

type private GitHub() =
    let mutable published = None
    let comments = ResizeArray<int * string>()

    member _.Published = published
    member _.Comments = comments |> Seq.toList

    interface IGitHubGateway with
        member _.GetDefaultHead _ =
            async { return String.replicate 40 "a" }

        member _.DownloadArchive(_, _) = async { return [| 1uy; 2uy |] }
        member _.GetPermission(_, _) = async { return Admin }

        member _.Publish value =
            async {
                published <- Some value

                return {
                    Branch = value.Branch
                    PullRequestNumber = 42
                    HeadSha = String.replicate 40 "b"
                }
            }

        member _.Comment(_, pullRequest, body) =
            async { comments.Add(pullRequest, body) }

type private Queue() =
    let jobs = ResizeArray<UpdateJob>()

    member _.Jobs = jobs |> Seq.toList

    interface IJobQueue with
        member _.Enqueue job = async { jobs.Add job }

type private Artifacts() =
    interface IArtifactStore with
        member _.Put(_, _, _) =
            async { return "/artifacts/repository.tar.gz" }

type private Runner(result: RunnerResult) =
    interface ISandboxRunner with
        member _.Run _ = async { return result }

let private repository = {
    Id = "100"
    InstallationId = "200"
    Owner = "example"
    Name = "service"
    DefaultBranch = "main"
    Enabled = true
}

let private updateTests =
    testList (
        "updates",
        [
            testAsync (
                "publishes one stable update branch",
                fun _ ->
                    async {
                        let store = Store(repository)
                        let github = GitHub()

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

                        let service = UpdateService(store, github, Artifacts(), runner)

                        let! outcome =
                            service.Run {
                                RepositoryId = repository.Id
                                Trigger = Scheduled
                            }

                        match outcome, github.Published with
                        | Published publication, Some update ->
                            assertThat publication.PullRequestNumber (isEqualTo 42)
                            assertThat update.Branch (isEqualTo Branches.Weekly)
                            assertThat update.ExpectedHead (isEqualTo None)
                            assertThat (update.Body.Contains("Fable.Core")) isTrue
                        | _ -> failwith "expected an update publication"
                    }
            )
            testAsync (
                "does not publish an unchanged resolution",
                fun _ ->
                    async {
                        let store = Store(repository)
                        let github = GitHub()

                        let runner =
                            Runner {
                                Status = NoChange
                                LockFile = None
                                Changes = []
                                Messages = []
                            }

                        let service = UpdateService(store, github, Artifacts(), runner)

                        let! outcome =
                            service.Run {
                                RepositoryId = repository.Id
                                Trigger = Scheduled
                            }

                        assertThat outcome (isEqualTo Unchanged)
                        assertThat github.Published.IsNone isTrue
                    }
            )
            testAsync (
                "surfaces runner failures without publishing",
                fun _ ->
                    async {
                        let store = Store(repository)
                        let github = GitHub()

                        let runner =
                            Runner {
                                Status = Failed
                                LockFile = None
                                Changes = []
                                Messages = [ "runner timed out" ]
                            }

                        let service = UpdateService(store, github, Artifacts(), runner)

                        let! outcome =
                            service.Run {
                                RepositoryId = repository.Id
                                Trigger = Scheduled
                            }

                        assertThat outcome (isEqualTo (RunFailed [ "runner timed out" ]))
                        assertThat github.Published.IsNone isTrue
                    }
            )
            testAsync (
                "carries the tracked branch head into a refresh",
                fun _ ->
                    async {
                        let store = Store(repository)

                        let previous = {
                            Branch = Branches.Weekly
                            PullRequestNumber = 42
                            HeadSha = String.replicate 40 "c"
                        }

                        do! (store :> IRepositoryStore).RecordPublication(repository.Id, previous)
                        let github = GitHub()

                        let runner =
                            Runner {
                                Status = Updated
                                LockFile = Some "NUGET"
                                Changes = []
                                Messages = []
                            }

                        let service = UpdateService(store, github, Artifacts(), runner)

                        let! _ =
                            service.Run {
                                RepositoryId = repository.Id
                                Trigger = Scheduled
                            }

                        match github.Published with
                        | Some update -> assertThat update.ExpectedHead (isEqualTo (Some previous.HeadSha))
                        | None -> failwith "expected an update publication"
                    }
            )
        ]
    )

let private commandTests =
    testList (
        "pull request commands",
        [
            testAsync (
                "queues a command on the tracked PaketaBot pull request",
                fun _ ->
                    async {
                        let store = Store(repository)

                        do!
                            (store :> IRepositoryStore)
                                .RecordPublication(
                                    repository.Id,
                                    {
                                        Branch = Branches.Weekly
                                        PullRequestNumber = 42
                                        HeadSha = String.replicate 40 "b"
                                    }
                                )

                        let github = GitHub()
                        let queue = Queue()

                        let! handled =
                            CommandHandler.handle store github queue repository.Id 42 "maintainer" "/paketabot update"

                        assertThat handled isTrue
                        assertThat queue.Jobs.Length (isEqualTo 1)
                        assertThat github.Comments.Length (isEqualTo 1)
                    }
            )
            testAsync (
                "ignores a command on an unrelated pull request",
                fun _ ->
                    async {
                        let store = Store(repository)
                        let github = GitHub()
                        let queue = Queue()

                        let! handled =
                            CommandHandler.handle store github queue repository.Id 99 "maintainer" "/paketabot update"

                        assertThat handled isFalse
                        assertThat queue.Jobs.Length (isEqualTo 0)
                        assertThat github.Comments.Length (isEqualTo 0)
                    }
            )
        ]
    )

let private webhookTests =
    testList (
        "webhook deliveries",
        [
            testAsync (
                "dispatches a claimed delivery only once",
                fun _ ->
                    async {
                        let store = Store(repository)
                        let mutable dispatches = 0

                        let dispatch () = async { dispatches <- dispatches + 1 }

                        let! first = WebhookDelivery.handle store "delivery-1" dispatch
                        let! duplicate = WebhookDelivery.handle store "delivery-1" dispatch

                        assertThat first (isEqualTo ProcessedDelivery)
                        assertThat duplicate (isEqualTo DuplicateDelivery)
                        assertThat dispatches (isEqualTo 1)
                    }
            )
            testAsync (
                "releases a failed claim for retry",
                fun _ ->
                    async {
                        let store = Store(repository)
                        let mutable attempts = 0

                        let dispatch () =
                            async {
                                attempts <- attempts + 1

                                if attempts = 1 then
                                    failwith "temporary failure"
                            }

                        let! failed =
                            async {
                                try
                                    let! _ = WebhookDelivery.handle store "delivery-2" dispatch
                                    return false
                                with _ ->
                                    return true
                            }

                        let! retried = WebhookDelivery.handle store "delivery-2" dispatch

                        assertThat failed isTrue
                        assertThat retried (isEqualTo ProcessedDelivery)
                        assertThat attempts (isEqualTo 2)
                    }
            )
        ]
    )

let tests = testList ("workflow", [ updateTests; commandTests; webhookTests ])
