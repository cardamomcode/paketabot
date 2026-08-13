module PaketaBot.Tests.WorkflowContractTests

open System
open System.Text.RegularExpressions
open Fable.Core
open Scriptorium.Quill
open Scriptorium.Nib.Assertion
open type Scriptorium.Quill.Test

[<Import("readFileSync", "node:fs")>]
let private readFileSync (path: string) (encoding: string) : string = jsNative

[<Emit("process.cwd()")>]
let private currentDirectory () : string = jsNative

let private readRepositoryFile path =
    readFileSync ($"{currentDirectory ()}/{path}") "utf8"

let private section (startMarker: string) (endMarker: string) (document: string) =
    let startIndex = document.IndexOf(startMarker, StringComparison.Ordinal)

    if startIndex < 0 then
        failwith $"missing workflow section: {startMarker}"

    let endIndex =
        document.IndexOf(endMarker, startIndex + startMarker.Length, StringComparison.Ordinal)

    if endIndex < 0 then
        document.Substring(startIndex)
    else
        document.Substring(startIndex, endIndex - startIndex)

let private count (pattern: string) (value: string) =
    Regex.Matches(value, Regex.Escape(pattern)).Count

// decision: tests the committed YAML as text because job isolation and artifact retention are security controls outside compiled F#
// invariant: the resolver has no publisher secret, the publisher executes no repository content, and artifacts expire after one day
let tests =
    testList (
        "workflow contract",
        [
            test (
                "keeps the publisher token out of the resolver job",
                fun _ ->
                    let workflow = readRepositoryFile ".github/workflows/paketabot.yml"
                    let resolveJob = section "\n  resolve:\n" "\n  publish:\n" workflow
                    assertThat (resolveJob.Contains("paketabot_token")) isFalse
                    assertThat (resolveJob.Contains("persist-credentials: false")) isTrue
            )
            test (
                "keeps repository checkout and commands out of the publisher job",
                fun _ ->
                    let workflow = readRepositoryFile ".github/workflows/paketabot.yml"
                    let publishJob = section "\n  publish:\n" "\nnever-present-section:\n" workflow
                    assertThat (publishJob.Contains("actions/checkout")) isFalse
                    assertThat (publishJob.Contains("\n      - run:")) isFalse
                    assertThat (publishJob.Contains("token: ${{ secrets.paketabot_token }}")) isTrue
            )
            test (
                "expires the cross-job artifact after one day",
                fun _ ->
                    let workflow = readRepositoryFile ".github/workflows/paketabot.yml"
                    assertThat (workflow.Contains("retention-days: 1")) isTrue
            )
            test (
                "uses one immutable release for both internal operations",
                fun _ ->
                    let workflow = readRepositoryFile ".github/workflows/paketabot.yml"
                    let package = readRepositoryFile "package.json"

                    let versionMatch = Regex.Match(package, "\"version\"\\s*:\\s*\"([^\"]+)\"")

                    assertThat versionMatch.Success isTrue

                    let version = versionMatch.Groups[1].Value
                    let selfReference = $"uses: cardamomcode/paketabot@v{version}"
                    assertThat (count selfReference workflow) (isEqualTo 2)
            )
        ]
    )
