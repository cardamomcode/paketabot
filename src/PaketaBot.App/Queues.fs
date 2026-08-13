namespace PaketaBot.App

open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

module private JobNames =
    [<Literal>]
    let Update = "paket-update"

    [<Literal>]
    let Schedule = "schedule-paket-updates"

type MemoryJobQueue(handler: UpdateJob -> Async<unit>) =
    let jobs = ResizeArray<UpdateJob>()

    member _.Jobs = jobs |> Seq.toList

    interface IJobQueue with
        member _.Enqueue job =
            async {
                jobs.Add job
                do! handler job
            }

type PgBossJobQueue(boss: PgBoss) =
    interface IJobQueue with
        member _.Enqueue job =
            async {
                let payload =
                    createObj [
                        "repositoryId" ==> job.RepositoryId
                        "requestedBy"
                        ==> match job.Trigger with
                            | Scheduled -> null
                            | RequestedBy login -> box login
                    ]

                let options =
                    createObj [
                        "group" ==> createObj [ "id" ==> job.RepositoryId ]
                        "retryLimit" ==> 3
                        "retryBackoff" ==> true
                    ]

                let! _ = sendJob boss JobNames.Update payload options |> Async.AwaitPromise
                return ()
            }

module PgBossWorkers =
    /// Create queues explicitly before any producer, worker, or schedule uses them.
    ///
    /// decision: performs queue provisioning during startup because pg-boss 12 does not create application queues implicitly
    /// invariant: both application queues exist before workers start or jobs are sent
    let initialize (boss: PgBoss) =
        async {
            do! boss.createQueue (JobNames.Update) |> Async.AwaitPromise
            do! boss.createQueue (JobNames.Schedule) |> Async.AwaitPromise
        }

    let start (boss: PgBoss) (service: UpdateService) =
        // decision: uses pg-boss global group concurrency because singletonKey alone does not serialize standard queues
        // invariant: at most one update job per repository is active across all workers
        boss.work (
            JobNames.Update,
            createObj [ "groupConcurrency" ==> 1 ],
            fun jobs ->
                async {
                    for job in jobs do
                        let repositoryId: string = job.data?repositoryId
                        let requestedBy: string = job.data?requestedBy

                        let trigger =
                            if isNull requestedBy then
                                Scheduled
                            else
                                RequestedBy requestedBy

                        let! outcome =
                            service.Run {
                                RepositoryId = repositoryId
                                Trigger = trigger
                            }

                        // invariant: workflow failures reject the handler promise so pg-boss applies its retry policy
                        match UpdateOutcome.completionError outcome with
                        | Some message -> invalidOp message
                        | None -> ()
                }
                |> Async.StartAsPromise
        )

    let scheduleWeekly (boss: PgBoss) =
        boss.schedule (JobNames.Schedule, "0 4 * * 1", null, createObj [])

    let startScheduler (boss: PgBoss) (store: IRepositoryStore) (queue: IJobQueue) =
        boss.work (
            JobNames.Schedule,
            fun _ ->
                async {
                    let! repositories = store.ListEnabled()

                    for repository in repositories do
                        do!
                            queue.Enqueue {
                                RepositoryId = repository.Id
                                Trigger = Scheduled
                            }
                }
                |> Async.StartAsPromise
        )
