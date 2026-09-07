namespace PaketaBot

open System

type Eligibility =
    | Eligible
    | Ineligible of reasons: string list

module Eligibility =
    [<Literal>]
    let PublicNuGetV3Source = "https://api.nuget.org/v3/index.json"

    let private isCommentOrEmpty (line: string) =
        let value = line.Trim()
        String.IsNullOrWhiteSpace(value) || value.StartsWith("#")

    let private sourceReason (line: string) =
        let raw = line.Trim().Substring("source ".Length).Trim()

        let value =
            if raw.Length >= 2 && raw[0] = '"' && raw[raw.Length - 1] = '"' then
                raw.Substring(1, raw.Length - 2)
            else
                raw

        if
            String.Equals(value, PublicNuGetV3Source, StringComparison.Ordinal)
            && not (raw.Contains('"') && not (raw.StartsWith('"') && raw.EndsWith('"')))
        then
            None
        else
            Some $"unsupported package source; V1 requires `source {PublicNuGetV3Source}`"

    let private directiveName (value: string) =
        value.Split([| ' '; '\t' |], StringSplitOptions.RemoveEmptyEntries)
        |> Array.tryHead
        |> Option.defaultValue "unknown"
        |> _.ToLowerInvariant()

    let private unsupportedReason (line: string) =
        let value = line.Trim()
        let lower = value.ToLowerInvariant()

        if lower.StartsWith("source ") then
            sourceReason value
        elif
            [
                "git "
                "github "
                "http "
                "file "
                "cache "
                "credentials "
                "username "
                "password "
            ]
            |> List.exists lower.StartsWith
        then
            Some $"unsupported Paket directive: {directiveName value}"
        else
            None

    /// Validate the deliberately narrow credential-free runner policy for Paket inputs.
    ///
    /// decision: v1 accepts only the canonical HTTPS NuGet.org v3 index so source validation cannot be bypassed with alternate paths
    /// invariant: every non-comment source directive is the credential-free api.nuget.org v3 index without query or fragment data
    /// tradeoff: rejects other public NuGet.org endpoints to keep the pre-execution network policy exact and reviewable
    let inspect (dependencies: string) =
        let lines =
            dependencies.Split([| '\r'; '\n' |], StringSplitOptions.RemoveEmptyEntries)
            |> Array.filter (isCommentOrEmpty >> not)

        let reasons =
            [
                if
                    not (
                        lines
                        |> Array.exists (fun line ->
                            line.Trim().StartsWith("source ", StringComparison.OrdinalIgnoreCase))
                    )
                then
                    "paket.dependencies must declare a public NuGet.org source"
                yield! lines |> Array.choose unsupportedReason
            ]
            |> List.distinct

        if List.isEmpty reasons then
            Eligible
        else
            Ineligible reasons
