namespace PaketaBot

open Fable.TypedJson.JS.Json

module Serialization =
    // decision: codecs are constructed once per process because TypedJson plans are reusable and non-trivial to build
    let runnerResult = auto<RunnerResult> ()

    let encodeResult value = runnerResult.encode value

    let decodeResult json = runnerResult.decode (parseRaw json)
