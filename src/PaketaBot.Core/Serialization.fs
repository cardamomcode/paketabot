namespace PaketaBot

open Fable.TypedJson.JS.Json

module Serialization =
    // decision: codecs are constructed once per process because TypedJson plans are reusable and non-trivial to build
    let resolutionArtifact = auto<ResolutionArtifact> ()

    let encodeArtifact value = resolutionArtifact.encode value

    let decodeArtifact json =
        resolutionArtifact.decode (parseRaw json)
