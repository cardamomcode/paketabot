namespace PaketaBot

open System
open System.Text.RegularExpressions

module LockDiff =
    let private packageLine =
        Regex("^\\s{4}([A-Za-z0-9_.-]+) \\(([^ )]+)", RegexOptions.Compiled)

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
