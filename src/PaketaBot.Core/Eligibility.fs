namespace PaketaBot

open System

type Eligibility =
    | Eligible
    | Ineligible of reasons: string list

module Eligibility =
    let private publicNuGetHosts = set [ "api.nuget.org"; "www.nuget.org"; "nuget.org" ]

    let private isCommentOrEmpty (line: string) =
        let value = line.Trim()
        String.IsNullOrWhiteSpace(value) || value.StartsWith("#")

    let private sourceReason (line: string) =
        let value = line.Trim().Substring("source ".Length).Trim().Trim('"')

        let hasUserInfo =
            let schemeSeparator = value.IndexOf("://", StringComparison.Ordinal)

            if schemeSeparator < 0 then
                false
            else
                let authorityStart = schemeSeparator + 3
                let pathStart = value.IndexOf('/', authorityStart)

                let authority =
                    if pathStart < 0 then
                        value.Substring(authorityStart)
                    else
                        value.Substring(authorityStart, pathStart - authorityStart)

                authority.Contains('@')

        match Uri.TryCreate(value, UriKind.Absolute) with
        | true, uri when
            uri.Scheme = "https"
            && publicNuGetHosts.Contains(uri.Host.ToLowerInvariant())
            && not hasUserInfo
            ->
            None
        | _ -> Some $"unsupported package source: {value}"

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
            Some $"unsupported Paket directive: {value}"
        else
            None

    /// Validate the deliberately narrow credential-free runner policy for Paket inputs.
    ///
    /// decision: v1 accepts only HTTPS NuGet.org sources so the runner never needs package-source credentials
    /// invariant: every non-comment source directive resolves to a public NuGet.org host without user information
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
