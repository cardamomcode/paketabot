namespace PaketaBot.App

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open PaketaBot
open PaketaBot.App.Bindings

type MemoryRepositoryStore() =
    let repositories = Dictionary<RepositoryId, Repository>()
    let publications = Dictionary<RepositoryId, Publication>()
    let deliveries = HashSet<string>()

    interface IRepositoryStore with
        member _.Save repository =
            async { repositories[repository.Id] <- repository }

        member _.Remove repositoryId =
            async { repositories.Remove(repositoryId) |> ignore }

        member _.TryGet repositoryId =
            async {
                match repositories.TryGetValue(repositoryId) with
                | true, repository -> return Some repository
                | _ -> return None
            }

        member _.ListEnabled() =
            async { return repositories.Values |> Seq.filter _.Enabled |> Seq.toList }

        member _.RecordPublication(repositoryId, publication) =
            async { publications[repositoryId] <- publication }

        member _.TryGetPublication repositoryId =
            async {
                match publications.TryGetValue(repositoryId) with
                | true, publication -> return Some publication
                | _ -> return None
            }

        member _.TryAcceptDelivery deliveryId =
            async { return deliveries.Add deliveryId }

        member _.ReleaseDelivery deliveryId =
            async { deliveries.Remove deliveryId |> ignore }

type PostgresRepositoryStore(pool: Pool) =
    let query sql values =
        queryPool pool sql values |> Async.AwaitPromise

    member _.Migrate() =
        async {
            let! _ =
                query """CREATE TABLE IF NOT EXISTS repositories (
                 id text PRIMARY KEY,
                 installation_id text NOT NULL,
                 owner text NOT NULL,
                 name text NOT NULL,
                 default_branch text NOT NULL,
                 enabled boolean NOT NULL DEFAULT true,
                 publication jsonb
               )""" [||]

            let! _ =
                query """CREATE TABLE IF NOT EXISTS webhook_deliveries (
                         delivery_id text PRIMARY KEY,
                         received_at timestamptz NOT NULL DEFAULT now()
                       )""" [||]

            return ()
        }

    interface IRepositoryStore with
        member _.Save repository =
            async {
                let! _ =
                    query
                        """INSERT INTO repositories(id, installation_id, owner, name, default_branch, enabled)
                           VALUES ($1, $2, $3, $4, $5, $6)
                           ON CONFLICT(id) DO UPDATE SET installation_id=$2, owner=$3, name=$4, default_branch=$5, enabled=$6"""
                        [|
                            box repository.Id
                            box repository.InstallationId
                            box repository.Owner
                            box repository.Name
                            box repository.DefaultBranch
                            box repository.Enabled
                        |]

                return ()
            }

        member _.Remove repositoryId =
            async {
                let! _ = query "DELETE FROM repositories WHERE id=$1" [| box repositoryId |]
                return ()
            }

        member _.TryGet repositoryId =
            async {
                let! result = query "SELECT * FROM repositories WHERE id=$1" [| box repositoryId |]

                return
                    result.rows
                    |> Array.tryHead
                    |> Option.map (fun row -> {
                        Id = row?id
                        InstallationId = row?installation_id
                        Owner = row?owner
                        Name = row?name
                        DefaultBranch = row?default_branch
                        Enabled = row?enabled
                    })
            }

        member _.ListEnabled() =
            async {
                let! result = query "SELECT * FROM repositories WHERE enabled=true ORDER BY id" [||]

                return
                    result.rows
                    |> Array.map (fun row -> {
                        Id = row?id
                        InstallationId = row?installation_id
                        Owner = row?owner
                        Name = row?name
                        DefaultBranch = row?default_branch
                        Enabled = row?enabled
                    })
                    |> Array.toList
            }

        member _.RecordPublication(repositoryId, publication) =
            async {
                let value =
                    createObj [
                        "branch" ==> publication.Branch
                        "pullRequestNumber" ==> publication.PullRequestNumber
                        "headSha" ==> publication.HeadSha
                    ]

                let! _ = query "UPDATE repositories SET publication=$2 WHERE id=$1" [| box repositoryId; value |]
                return ()
            }

        member _.TryGetPublication repositoryId =
            async {
                let! result = query "SELECT publication FROM repositories WHERE id=$1" [| box repositoryId |]

                return
                    result.rows
                    |> Array.tryHead
                    |> Option.bind (fun row ->
                        let value: obj = row?publication

                        if isNull value then
                            None
                        else
                            Some {
                                Branch = value?branch
                                PullRequestNumber = value?pullRequestNumber
                                HeadSha = value?headSha
                            })
            }

        member _.TryAcceptDelivery deliveryId =
            async {
                // decision: claims delivery IDs through a primary key so concurrent webhook retries have one winner
                let! result =
                    query
                        "INSERT INTO webhook_deliveries(delivery_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING delivery_id"
                        [| box deliveryId |]

                return result.rows.Length = 1
            }

        member _.ReleaseDelivery deliveryId =
            async {
                let! _ = query "DELETE FROM webhook_deliveries WHERE delivery_id=$1" [| box deliveryId |]
                return ()
            }
