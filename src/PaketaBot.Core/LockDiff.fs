namespace PaketaBot

open System
open System.Text.RegularExpressions

module LockDiff =
    let private packageLine =
        Regex("^\\s{4}([A-Za-z0-9_.-]+) \\(([^ )]+)", RegexOptions.Compiled)

    let private requirementLine =
        Regex("^\\s{6}([A-Za-z0-9_.-]+) \\(([^)]+)\\)", RegexOptions.Compiled)

    let private packages (lockFile: string) =
        lockFile.Split([| '\r'; '\n' |], StringSplitOptions.RemoveEmptyEntries)
        |> Array.choose (fun line ->
            let matched = packageLine.Match(line)

            if matched.Success then
                Some(matched.Groups[1].Value, matched.Groups[2].Value)
            else
                None)
        |> Map.ofArray

    let changes previous current =
        let before = packages previous
        let after = packages current

        after
        |> Map.toList
        |> List.choose (fun (name, currentVersion) ->
            match Map.tryFind name before with
            | Some previousVersion when previousVersion <> currentVersion ->
                Some {
                    Name = name
                    Previous = previousVersion
                    Current = currentVersion
                }
            | _ -> None)

    let private requirements (lockFile: string) =
        let mutable requiredBy = None

        lockFile.Split([| '\r'; '\n' |], StringSplitOptions.RemoveEmptyEntries)
        |> Array.choose (fun line ->
            let packageMatch = packageLine.Match(line)

            if packageMatch.Success then
                requiredBy <- Some packageMatch.Groups[1].Value
                None
            else
                let requirementMatch = requirementLine.Match(line)

                match requiredBy, requirementMatch.Success with
                | Some parent, true ->
                    let name = requirementMatch.Groups[1].Value
                    let requirement = requirementMatch.Groups[2].Value
                    Some((parent, name), requirement)
                | _ -> None)
        |> Map.ofArray

    /// Report dependency requirements recorded beneath each resolved package.
    ///
    /// decision: keys requirements by both parent and dependency because one package can require different ranges in one lock file
    let requirementChanges previous current =
        let before = requirements previous
        let after = requirements current

        after
        |> Map.toList
        |> List.choose (fun ((requiredBy, name), currentRequirement) ->
            match Map.tryFind (requiredBy, name) before with
            | Some previousRequirement when previousRequirement <> currentRequirement ->
                Some {
                    Name = name
                    RequiredBy = requiredBy
                    Previous = previousRequirement
                    Current = currentRequirement
                }
            | _ -> None)
