module PaketaBot.App.Program

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App
open PaketaBot.App.Bindings

let private envOr name fallback =
    let value = env name
    if String.IsNullOrWhiteSpace(value) then fallback else value

let private requireEnv name =
    let value = env name

    if String.IsNullOrWhiteSpace(value) then
        invalidOp $"{name} must be set"

    value

let private createGateway () : IGitHubGateway =
    let appId = env "GITHUB_APP_ID"
    let privateKey = env "GITHUB_APP_PRIVATE_KEY"

    match String.IsNullOrWhiteSpace(appId), String.IsNullOrWhiteSpace(privateKey) with
    | true, true -> FakeGitHubGateway() :> IGitHubGateway
    | false, false -> GitHubApp(AppOptions(appId, privateKey.Replace("\\n", "\n"))) |> OctokitGateway :> IGitHubGateway
    | _ -> invalidOp "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured together"

let private createRunner () : ISandboxRunner =
    let image = env "PAKETABOT_RUNNER_IMAGE"

    if String.IsNullOrWhiteSpace(image) then
        NoopRunner() :> ISandboxRunner
    else
        ContainerRunner(envOr "PAKETABOT_CONTAINER_RUNTIME" "podman", image) :> ISandboxRunner

let private start () =
    async {
        let databaseUrl = env "DATABASE_URL"

        // decision: refuses an implicit webhook secret because a known fallback would authenticate forged events
        // invariant: the HTTP server never starts without an explicitly configured webhook secret
        let webhookSecret = requireEnv "GITHUB_WEBHOOK_SECRET"
        let github = createGateway ()

        let artifacts =
            LocalArtifactStore(envOr "PAKETABOT_ARTIFACT_ROOT" (join [| tempDirectory (); "paketabot-artifacts" |]))

        let runner = createRunner ()

        let! store, queue, stopInfrastructure =
            async {
                if String.IsNullOrWhiteSpace(databaseUrl) then
                    let store = MemoryRepositoryStore() :> IRepositoryStore
                    let service = UpdateService(store, github, artifacts, runner)
                    let queue = MemoryJobQueue(fun job -> service.Run job |> Async.Ignore) :> IJobQueue
                    return store, queue, async { return () }
                else
                    let pool = Pool(PoolOptions(databaseUrl))
                    let postgresStore = PostgresRepositoryStore(pool)
                    do! postgresStore.Migrate()
                    let store = postgresStore :> IRepositoryStore
                    let boss = PgBoss(databaseUrl)
                    let! _ = boss.start () |> Async.AwaitPromise
                    do! PgBossWorkers.initialize boss
                    let queue = PgBossJobQueue(boss) :> IJobQueue
                    let service = UpdateService(store, github, artifacts, runner)
                    let! _ = PgBossWorkers.start boss service |> Async.AwaitPromise
                    let! _ = PgBossWorkers.startScheduler boss store queue |> Async.AwaitPromise
                    do! PgBossWorkers.scheduleWeekly boss |> Async.AwaitPromise

                    let stop =
                        async {
                            do! boss.stop () |> Async.AwaitPromise
                            do! pool.``end`` () |> Async.AwaitPromise
                        }

                    return store, queue, stop
            }

        let server =
            Server.create {
                Store = store
                GitHub = github
                Queue = queue
                Webhooks = Webhooks(WebhookOptions(webhookSecret))
            }

        let stop () =
            async {
                do! server.close () |> Async.AwaitPromise
                do! stopInfrastructure
            }
            |> Async.StartAsPromise
            |> ignore

        onProcessEvent "SIGTERM" stop
        onProcessEvent "SIGINT" stop

        let port = envOr "PORT" "3000" |> int

        let! address =
            server.listen (createObj [ "host" ==> "0.0.0.0"; "port" ==> port ])
            |> Async.AwaitPromise

        log $"PaketaBot listening at {address}"
    }

[<EntryPoint>]
let main _ =
    start () |> Async.StartAsPromise |> ignore
    0
