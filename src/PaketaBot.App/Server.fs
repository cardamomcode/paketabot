namespace PaketaBot.App

open System
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type ServerDependencies = {
    Store: IRepositoryStore
    GitHub: IGitHubGateway
    Queue: IJobQueue
    Webhooks: Webhooks
}

module Server =
    let private header name (request: FastifyRequest) =
        let value: obj = request.headers?(name)
        if isNull value then "" else string value

    let private repositoryFrom (installationId: string) enabled (value: obj) = {
        Id = string value?id
        InstallationId = installationId
        Owner = value?owner?login
        Name = value?name
        DefaultBranch = value?default_branch
        Enabled = enabled
    }

    let private saveRepositories (store: IRepositoryStore) installationId enabled (values: obj array) =
        async {
            for value in values do
                do! store.Save(repositoryFrom installationId enabled value)
        }

    let private handleInstallation (dependencies: ServerDependencies) (payload: obj) =
        async {
            let installationId = string payload?installation?id
            let repositories: obj array = payload?repositories
            let action: string = payload?action

            match action with
            | "deleted" ->
                for repository in repositories do
                    do! dependencies.Store.Remove(string repository?id)
            | "suspend" -> do! saveRepositories dependencies.Store installationId false repositories
            | _ -> do! saveRepositories dependencies.Store installationId true repositories
        }

    let private handleRepositorySelection (dependencies: ServerDependencies) (payload: obj) =
        async {
            let installationId = string payload?installation?id
            let added: obj array = payload?repositories_added
            let removed: obj array = payload?repositories_removed
            do! saveRepositories dependencies.Store installationId true added

            for repository in removed do
                do! dependencies.Store.Remove(string repository?id)
        }

    let private handleComment (dependencies: ServerDependencies) (payload: obj) =
        async {
            let issue: obj = payload?issue
            let pullRequest: obj = issue?pull_request
            let action: string = payload?action

            if Commands.isCreatedComment action && not (isNull pullRequest) then
                let repositoryId = string payload?repository?id
                let number: int = issue?number
                let login: string = payload?sender?login
                let body: string = payload?comment?body

                let! _ =
                    CommandHandler.handle
                        dependencies.Store
                        dependencies.GitHub
                        dependencies.Queue
                        repositoryId
                        number
                        login
                        body

                ()
        }

    let private dispatch dependencies eventName payload =
        match eventName with
        | "installation" -> handleInstallation dependencies payload
        | "installation_repositories" -> handleRepositorySelection dependencies payload
        | "issue_comment" -> handleComment dependencies payload
        | _ -> async { return () }

    let create dependencies =
        let server = fastify (createObj [ "logger" ==> true; "bodyLimit" ==> 1_048_576 ])
        addRawBodyParser server

        server.get (
            "/healthz",
            fun _ reply ->
                async { return reply.send (createObj [ "status" ==> "ok" ]) }
                |> Async.StartAsPromise
        )

        server.post (
            "/webhooks/github",
            fun request reply ->
                async {
                    let signature = header "x-hub-signature-256" request
                    let eventName = header "x-github-event" request
                    let deliveryId = header "x-github-delivery" request
                    let body = bufferToString request.body
                    let! valid = dependencies.Webhooks.verify (body, signature) |> Async.AwaitPromise

                    if not valid then
                        return reply.code(401).send (createObj [ "error" ==> "invalid webhook signature" ])
                    elif String.IsNullOrWhiteSpace(deliveryId) then
                        return reply.code(400).send (createObj [ "error" ==> "missing webhook delivery id" ])
                    else
                        let! outcome =
                            WebhookDelivery.handle dependencies.Store deliveryId (fun () ->
                                async {
                                    let payload: obj = JS.JSON.parse body
                                    do! dispatch dependencies eventName payload
                                })

                        match outcome with
                        | DuplicateDelivery ->
                            return reply.code(202).send (createObj [ "accepted" ==> false; "duplicate" ==> true ])
                        | ProcessedDelivery -> return reply.code(202).send (createObj [ "accepted" ==> true ])
                }
                |> Async.StartAsPromise
        )

        server
