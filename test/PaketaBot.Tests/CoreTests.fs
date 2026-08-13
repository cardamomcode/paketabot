module PaketaBot.Tests.CoreTests

open Scriptorium.Quill
open Scriptorium.Nib.Assertion
open type Scriptorium.Quill.Test
open PaketaBot

let private eligibilityTests =
    testList (
        "eligibility",
        [
            test (
                "accepts the public NuGet v3 source",
                fun _ ->
                    let result =
                        Eligibility.inspect "source https://api.nuget.org/v3/index.json\nnuget Fable.Core"

                    assertThat result (isEqualTo Eligible)
            )
            test (
                "rejects authenticated and alternative sources",
                fun _ ->
                    let result =
                        Eligibility.inspect "source https://user:secret@example.com/v3/index.json\nnuget Fable.Core"

                    match result with
                    | Ineligible reasons -> assertThat reasons.Length (isEqualTo 1)
                    | Eligible -> failwith "expected an ineligible repository"
            )
            test (
                "rejects Git dependencies",
                fun _ ->
                    match Eligibility.inspect "source https://api.nuget.org/v3/index.json\ngithub owner/repo" with
                    | Ineligible reasons ->
                        assertThat reasons.Head (isEqualTo "unsupported Paket directive: github owner/repo")
                    | Eligible -> failwith "expected an ineligible repository"
            )
            test (
                "requires an explicit public source",
                fun _ ->
                    match Eligibility.inspect "nuget Fable.Core" with
                    | Ineligible reasons ->
                        assertThat reasons.Head (isEqualTo "paket.dependencies must declare a public NuGet.org source")
                    | Eligible -> failwith "expected an ineligible repository"
            )
        ]
    )

let private lockDiffTests =
    testList (
        "lock diff",
        [
            test (
                "reports changed resolved versions",
                fun _ ->
                    let previous = "NUGET\n  specs:\n    Fable.Core (5.1.0)\n    FSharp.Core (10.0.0)"
                    let current = "NUGET\n  specs:\n    Fable.Core (5.2.0)\n    FSharp.Core (10.0.0)"

                    assertThat
                        (LockDiff.changes previous current)
                        (isEqualTo [
                            {
                                Name = "Fable.Core"
                                Previous = "5.1.0"
                                Current = "5.2.0"
                            }
                        ])
            )
        ]
    )

let private commandTests =
    testList (
        "commands",
        [
            test (
                "parses update",
                fun _ -> assertThat (Commands.tryParse " /PaketaBot UPDATE ") (isEqualTo (Some Update))
            )
            test ("ignores conversation", fun _ -> assertThat (Commands.tryParse "please update") (isEqualTo None))
            test ("accepts newly-created comments", fun _ -> assertThat (Commands.isCreatedComment "created") isTrue)
            test ("ignores edited comments", fun _ -> assertThat (Commands.isCreatedComment "edited") isFalse)
            test ("requires write access", fun _ -> assertThat (RepositoryPermission.canRequestUpdate Write) isTrue)
            test ("rejects triage access", fun _ -> assertThat (RepositoryPermission.canRequestUpdate Triage) isFalse)
        ]
    )

let private branchTests =
    testList (
        "branch publication",
        [
            test (
                "creates a missing branch from the current base",
                fun _ ->
                    assertThat (Branches.planPublication "base" None None) (isEqualTo (Ok(Branches.CreateFrom "base")))
            )
            test (
                "fast-forwards from the verified bot head",
                fun _ ->
                    assertThat
                        (Branches.planPublication "base" (Some "tracked") (Some "tracked"))
                        (isEqualTo (Ok(Branches.FastForwardFrom "tracked")))
            )
            test (
                "rejects an untracked existing branch",
                fun _ ->
                    assertThat
                        (Branches.planPublication "base" None (Some "unknown"))
                        (isEqualTo (Error "the target branch exists but is not tracked as PaketaBot-owned"))
            )
            test (
                "rejects a tracked branch changed outside PaketaBot",
                fun _ ->
                    assertThat
                        (Branches.planPublication "base" (Some "tracked") (Some "changed"))
                        (isEqualTo (Error "the target branch changed outside PaketaBot; refusing to overwrite it"))
            )
        ]
    )

let private completionTests =
    testList (
        "job completion",
        [
            test (
                "surfaces workflow failures to the queue",
                fun _ ->
                    assertThat
                        (UpdateOutcome.completionError (RunFailed [ "download failed"; "retry later" ]))
                        (isEqualTo (Some "download failed\nretry later"))
            )
            test (
                "completes terminal non-failure outcomes",
                fun _ -> assertThat (UpdateOutcome.completionError Unchanged) (isEqualTo None)
            )
        ]
    )

let tests =
    testList ("core", [ eligibilityTests; lockDiffTests; commandTests; branchTests; completionTests ])
