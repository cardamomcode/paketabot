module PaketaBot.App.Bindings

open System
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type JsError =
    abstract message: string

[<AllowNullLiteral>]
type ActionOctokit =
    abstract request: route: string * parameters: obj -> JS.Promise<obj>

[<AllowNullLiteral>]
type FileStats =
    abstract size: int
    abstract isFile: unit -> bool
    abstract isSymbolicLink: unit -> bool

[<Import("getOctokit", "@actions/github")>]
let getOctokit (token: string) : ActionOctokit = jsNative

let request (client: ActionOctokit) (route: string) (parameters: obj) = client.request (route, parameters)

[<Import("getInput", "@actions/core")>]
let getInput (name: string) : string = jsNative

[<Import("setSecret", "@actions/core")>]
let setSecret (value: string) : unit = jsNative

[<Import("setOutput", "@actions/core")>]
let setOutput (name: string) (value: obj) : unit = jsNative

[<Import("setFailed", "@actions/core")>]
let setFailed (message: string) : unit = jsNative

[<Import("info", "@actions/core")>]
let info (message: string) : unit = jsNative

[<Emit("($0 as any)?.status === 404 || ($0 as any)?.response?.status === 404")>]
let isNotFound (error: exn) : bool = jsNative

[<Import("mkdir", "node:fs/promises")>]
let private mkdirNative: obj = jsNative

[<Emit("$0($1, $2 as any).then(() => undefined)")>]
let callMkdir (mkdirFunction: obj) (path: string) (options: obj) : JS.Promise<unit> = jsNative

let mkdir path options = callMkdir mkdirNative path options

[<Import("readFile", "node:fs/promises")>]
let readFile (path: string) (encoding: string) : JS.Promise<string> = jsNative

[<Import("lstat", "node:fs/promises")>]
let lstat (path: string) : JS.Promise<FileStats> = jsNative

[<Import("writeFile", "node:fs/promises")>]
let writeFile (path: string) (content: string) : JS.Promise<unit> = jsNative

[<Import("dirname", "node:path")>]
let dirname (path: string) : string = jsNative

[<Import("join", "node:path")>]
let join ([<ParamArray>] paths: string array) : string = jsNative

[<Emit("process.env[$0] ?? ''")>]
let env (name: string) : string = jsNative

[<Emit("Buffer.from($0, 'utf8').toString('base64')")>]
let toBase64 (value: string) : string = jsNative

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
