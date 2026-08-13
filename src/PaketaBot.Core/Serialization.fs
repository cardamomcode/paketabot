namespace PaketaBot

open Fable.TypedJson.JS.Json

module Serialization =
    // decision: codecs are constructed once per process because TypedJson plans are reusable and non-trivial to build
    let runnerRequest = auto<RunnerRequest> ()
    let runnerResult = auto<RunnerResult> ()

    let encodeRequest value = runnerRequest.encode value
    let encodeResult value = runnerResult.encode value

    let decodeRequest json = runnerRequest.decode (parseRaw json)
    let decodeResult json = runnerResult.decode (parseRaw json)
