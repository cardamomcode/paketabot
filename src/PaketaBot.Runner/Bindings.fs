module PaketaBot.Runner.Bindings

open System
open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type JsError =
    abstract message: string

[<Import("readFile", "node:fs/promises")>]
let readFile (path: string) (encoding: string) : JS.Promise<string> = jsNative

[<Import("writeFile", "node:fs/promises")>]
let writeFile (path: string) (content: string) : JS.Promise<unit> = jsNative

[<Import("mkdtemp", "node:fs/promises")>]
let mkdtemp (prefix: string) : JS.Promise<string> = jsNative

[<Import("rm", "node:fs/promises")>]
let removePath (path: string) (options: obj) : JS.Promise<unit> = jsNative

[<Import("join", "node:path")>]
let join ([<ParamArray>] paths: string array) : string = jsNative

[<Import("tmpdir", "node:os")>]
let tempDirectory () : string = jsNative

[<Emit("process.argv.slice(2)")>]
let arguments () : string array = jsNative

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
