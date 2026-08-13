module PaketaBot.App.Bindings

open System
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type JsError =
    abstract message: string
    abstract status: int option

[<AllowNullLiteral>]
type FastifyRequest =
    abstract body: obj
    abstract headers: obj

[<AllowNullLiteral>]
type FastifyReply =
    abstract code: int -> FastifyReply
    abstract send: obj -> obj

[<AllowNullLiteral>]
type FastifyInstance =
    abstract get: string * (FastifyRequest -> FastifyReply -> JS.Promise<obj>) -> unit
    abstract post: string * (FastifyRequest -> FastifyReply -> JS.Promise<obj>) -> unit
    abstract listen: obj -> JS.Promise<string>
    abstract close: unit -> JS.Promise<unit>

[<ImportDefault("fastify")>]
let fastify (options: obj) : FastifyInstance = jsNative

[<Emit("($0 as any).addContentTypeParser('*', { parseAs: 'buffer' }, (_request: any, body: any, done: any) => done(null, body))")>]
let addRawBodyParser (server: FastifyInstance) : unit = jsNative

[<Emit("$0.toString('utf8')")>]
let bufferToString (buffer: obj) : string = jsNative

[<Emit("Buffer.from($0, 'utf8').toString('base64')")>]
let toBase64 (value: string) : string = jsNative

[<AllowNullLiteral>]
[<JS.Pojo>]
type WebhookOptions(secret: string) =
    member val secret: string = jsNative with get, set

[<Import("Webhooks", "@octokit/webhooks")>]
type Webhooks(options: WebhookOptions) =
    member _.verify(payload: string, signature: string) : JS.Promise<bool> = jsNative

[<AllowNullLiteral>]
[<JS.Pojo>]
type AppOptions(appId: string, privateKey: string) =
    member val appId: string = jsNative with get, set
    member val privateKey: string = jsNative with get, set

[<AllowNullLiteral>]
type InstallationOctokit = interface end

[<Import("App", "@octokit/app")>]
type GitHubApp(options: AppOptions) = class end

[<Emit("($0 as any).getInstallationOctokit(Number($1))")>]
let getInstallationOctokit (app: GitHubApp) (installationId: string) : JS.Promise<InstallationOctokit> = jsNative

[<Emit("($0 as any).request($1, $2)")>]
let request (client: InstallationOctokit) (route: string) (parameters: obj) : JS.Promise<obj> = jsNative

[<Emit("($0 as any)?.status === 404 || ($0 as any)?.response?.status === 404")>]
let isNotFound (error: exn) : bool = jsNative

[<AllowNullLiteral>]
type QueryResult =
    abstract rows: obj array

[<AllowNullLiteral>]
[<JS.Pojo>]
type PoolOptions(connectionString: string) =
    member val connectionString: string = jsNative with get, set

[<Import("Pool", "pg")>]
type Pool(options: PoolOptions) =
    member _.``end``() : JS.Promise<unit> = jsNative

[<Emit("($0 as any).query($1, $2 as any)")>]
let queryPool (pool: Pool) (sql: string) (values: obj array) : JS.Promise<QueryResult> = jsNative

[<AllowNullLiteral>]
type PgBossJob =
    abstract data: obj

[<Import("PgBoss", "pg-boss")>]
type PgBoss(connectionString: string) =
    member _.start() : JS.Promise<PgBoss> = jsNative
    member _.stop() : JS.Promise<unit> = jsNative
    member _.createQueue(name: string) : JS.Promise<unit> = jsNative
    member _.send(name: string, data: obj, options: obj) : JS.Promise<string> = jsNative
    member _.work(name: string, handler: PgBossJob array -> JS.Promise<unit>) : JS.Promise<string> = jsNative

    member _.work(name: string, options: obj, handler: PgBossJob array -> JS.Promise<unit>) : JS.Promise<string> =
        jsNative

    member _.schedule(name: string, cron: string, data: obj, options: obj) : JS.Promise<unit> = jsNative

[<Emit("($0 as any).send($1, $2, $3)")>]
let sendJob (boss: PgBoss) (name: string) (data: obj) (options: obj) : JS.Promise<obj> = jsNative

[<Import("mkdir", "node:fs/promises")>]
let private mkdirNative: obj = jsNative

[<Emit("$0($1, $2 as any).then(() => undefined)")>]
let callMkdir (mkdirFunction: obj) (path: string) (options: obj) : JS.Promise<unit> = jsNative

let mkdir path options = callMkdir mkdirNative path options

[<Import("writeFile", "node:fs/promises")>]
let private writeFileNative: obj = jsNative

[<Emit("$0($1, Buffer.from($2))")>]
let writeBinaryFile (writer: obj) (path: string) (content: byte array) : JS.Promise<unit> = jsNative

let writeFile path content =
    writeBinaryFile writeFileNative path content

[<Import("readFile", "node:fs/promises")>]
let readFile (path: string) (encoding: string) : JS.Promise<string> = jsNative

[<Import("mkdtemp", "node:fs/promises")>]
let mkdtemp (prefix: string) : JS.Promise<string> = jsNative

[<Import("rm", "node:fs/promises")>]
let removePath (path: string) (options: obj) : JS.Promise<unit> = jsNative

[<Import("dirname", "node:path")>]
let dirname (path: string) : string = jsNative

[<Import("join", "node:path")>]
let join ([<ParamArray>] paths: string array) : string = jsNative

[<Import("tmpdir", "node:os")>]
let tempDirectory () : string = jsNative

[<Emit("process.env[$0] ?? ''")>]
let env (name: string) : string = jsNative

[<Emit("process.on($0, $1)")>]
let onProcessEvent (name: string) (handler: unit -> unit) : unit = jsNative

[<Emit("console.log($0)")>]
let log (message: string) : unit = jsNative

[<Import("execFile", "node:child_process")>]
let private execFileNative: obj = jsNative

[<Emit("$0($1, $2 as any, $3 as any, $4 as any)")>]
let private callExecFile
    (executor: obj)
    (file: string)
    (args: string array)
    (options: obj)
    (callback: JsError -> string -> string -> unit)
    : obj =
    jsNative

let execFile file args options =
    JS.Constructors.Promise.Create(fun resolve reject ->
        callExecFile execFileNative file args options (fun error stdout stderr ->
            if isNull error then
                resolve (stdout, stderr)
            else
                reject (
                    Exception(
                        if String.IsNullOrWhiteSpace(stderr) then
                            error.message
                        else
                            stderr
                    )
                ))
        |> ignore)
