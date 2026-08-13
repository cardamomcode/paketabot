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
                    | Ineligible reasons ->
                        assertThat reasons.Length (isEqualTo 1)
                        assertThat (reasons.Head.Contains("user")) isFalse
                        assertThat (reasons.Head.Contains("secret")) isFalse
                    | Eligible -> failwith "expected an ineligible repository"
            )
            test (
                "rejects NuGet host lookalikes and alternate endpoints",
                fun _ ->
                    let sources = [
                        "https://api.nuget.org.example.com/v3/index.json"
                        "https://api.nuget.org/v3/index.json?redirect=https://example.com"
                        "https://api.nuget.org/v3/index.json#fragment"
                        "https://api.nuget.org/v3/redirect"
                        "https://api.nuget.org:444/v3/index.json"
                        "https://api.nuget.org./v3/index.json"
                        "https://www.nuget.org/api/v2"
                    ]

                    let allRejected =
                        sources
                        |> List.forall (fun source ->
                            match Eligibility.inspect $"source {source}\nnuget Fable.Core" with
                            | Ineligible _ -> true
                            | Eligible -> false)

                    assertThat allRejected isTrue
            )
            test (
                "does not echo credential directives",
                fun _ ->
                    match
                        Eligibility.inspect "source https://api.nuget.org/v3/index.json\npassword repository-secret"
                    with
                    | Ineligible reasons ->
                        assertThat reasons.Head (isEqualTo "unsupported Paket directive: password")
                        assertThat (reasons.Head.Contains("repository-secret")) isFalse
                    | Eligible -> failwith "expected an ineligible repository"
            )
            test (
                "rejects Git dependencies",
                fun _ ->
                    match Eligibility.inspect "source https://api.nuget.org/v3/index.json\ngithub owner/repo" with
                    | Ineligible reasons -> assertThat reasons.Head (isEqualTo "unsupported Paket directive: github")
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

let private filePolicyTests =
    testList (
        "file policy",
        [
            test (
                "accepts a file at its byte ceiling",
                fun _ -> assertThat (PaketFiles.validateSize "paket.lock" 10 10) (isEqualTo (Ok()))
            )
            test (
                "rejects an oversized file",
                fun _ ->
                    assertThat
                        (PaketFiles.validateSize "paket.lock" 10 11)
                        (isEqualTo (Error "paket.lock exceeds the 10-byte limit"))
            )
            test (
                "rejects an invalid negative size",
                fun _ ->
                    assertThat
                        (PaketFiles.validateSize "paket.lock" 10 -1)
                        (isEqualTo (Error "paket.lock has an invalid size"))
            )
            test (
                "rejects a symbolic link before reading",
                fun _ ->
                    assertThat
                        (PaketFiles.validateInput "paket.lock" 10 5 true true)
                        (isEqualTo (Error "paket.lock must be a regular file, not a symbolic link or special file"))
            )
            test (
                "rejects a non-regular special file before reading",
                fun _ ->
                    assertThat
                        (PaketFiles.validateInput "paket.lock" 10 5 false false)
                        (isEqualTo (Error "paket.lock must be a regular file, not a symbolic link or special file"))
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
            test (
                "reports changed dependency requirements with their parent package",
                fun _ ->
                    let previous =
                        "NUGET\n  specs:\n    Fable.Giraffe.Beam (5.4)\n      Fable.TypedJson (>= 5.0.1)\n      Fable.TypedJson.Beam (>= 5.0)"

                    let current =
                        "NUGET\n  specs:\n    Fable.Giraffe.Beam (5.4)\n      Fable.TypedJson (>= 5.1)\n      Fable.TypedJson.Beam (>= 5.1)"

                    assertThat
                        (LockDiff.requirementChanges previous current)
                        (isEqualTo [
                            {
                                Name = "Fable.TypedJson"
                                RequiredBy = "Fable.Giraffe.Beam"
                                Previous = ">= 5.0.1"
                                Current = ">= 5.1"
                            }
                            {
                                Name = "Fable.TypedJson.Beam"
                                RequiredBy = "Fable.Giraffe.Beam"
                                Previous = ">= 5.0"
                                Current = ">= 5.1"
                            }
                        ])
            )
        ]
    )

let private pullRequestTests =
    testList (
        "pull request tracking",
        [
            test (
                "recognizes the PaketaBot marker",
                fun _ -> assertThat (PullRequests.isTrackedBody $"{PullRequests.Marker}\nupdate") isTrue
            )
            test (
                "requires the authenticated publisher identity",
                fun _ ->
                    assertThat (PullRequests.isOwnedBy "paketabot" "PaketaBot" $"{PullRequests.Marker}\nupdate") isTrue
            )
            test (
                "rejects a marker from another identity",
                fun _ ->
                    assertThat
                        (PullRequests.isOwnedBy "paketabot" "maintainer" $"{PullRequests.Marker}\nupdate")
                        isFalse
            )
            test (
                "rejects ordinary pull request bodies",
                fun _ -> assertThat (PullRequests.isTrackedBody "update") isFalse
            )
            test ("rejects missing pull request bodies", fun _ -> assertThat (PullRequests.isTrackedBody null) isFalse)
        ]
    )

let private pullRequestBodyTests =
    testList (
        "pull request body",
        [
            test (
                "lists changed resolved package versions",
                fun _ ->
                    let body =
                        PullRequestBody.render [
                            {
                                Name = "Fable.Core"
                                Previous = "5.1.0"
                                Current = "5.2.0"
                            }
                        ] []

                    assertThat (body.Contains("| Package | From | To |")) isTrue
                    assertThat (body.Contains("| `Fable.Core` | `5.1.0` | `5.2.0` |")) isTrue
            )
            test (
                "lists changed dependency requirements without claiming version updates",
                fun _ ->
                    let body =
                        PullRequestBody.render [] [
                            {
                                Name = "Fable.TypedJson"
                                RequiredBy = "Fable.Giraffe.Beam"
                                Previous = ">= 5.0.1"
                                Current = ">= 5.1"
                            }
                        ]

                    assertThat
                        (body.Contains(
                            "Paket refreshed dependency requirements recorded in `paket.lock` without changing resolved package versions."
                        ))
                        isTrue

                    assertThat (body.Contains("| Package | Required by | From | To |")) isTrue

                    assertThat
                        (body.Contains("| `Fable.TypedJson` | `Fable.Giraffe.Beam` | `>= 5.0.1` | `>= 5.1` |"))
                        isTrue

                    assertThat (body.Contains("| Package | From | To |")) isFalse
                    assertThat (body.Contains("PaketaBot updated the versions")) isFalse
            )
            test (
                "describes an otherwise unsummarized lock refresh without an empty table",
                fun _ ->
                    let body = PullRequestBody.render [] []

                    assertThat
                        (body.Contains("Paket refreshed `paket.lock` without changing resolved package versions."))
                        isTrue

                    assertThat (body.Contains("| Package")) isFalse
                    assertThat (body.Contains("PaketaBot updated the versions")) isFalse
            )
            test (
                "neutralizes and bounds untrusted lock metadata",
                fun _ ->
                    let malicious = "1.0|`<script>" + String.replicate 200 "x"

                    let changes =
                        [ 1..51 ]
                        |> List.map (fun index -> {
                            Name = $"Package{index}"
                            Previous = malicious
                            Current = "2.0.0"
                        })

                    let body = PullRequestBody.render changes []
                    assertThat (body.Contains("1.0|`<script>")) isFalse
                    assertThat (body.Contains("1.0¦ˋ<script>")) isTrue
                    assertThat (body.Contains("first 50 of 51 detected changes")) isTrue
                    assertThat (body.Contains("Package51")) isFalse
            )
        ]
    )

let private checkoutTests =
    testList (
        "checkout validation",
        [
            test (
                "accepts the exact default-branch event revision",
                fun _ -> assertThat (Checkouts.validate "main" "refs/heads/main" "abc" "abc") (isEqualTo (Ok()))
            )
            test (
                "rejects a manual run from another branch",
                fun _ ->
                    assertThat
                        (Checkouts.validate "main" "refs/heads/feature" "abc" "abc")
                        (isEqualTo (Error "PaketaBot must run from the default branch (refs/heads/main)"))
            )
            test (
                "rejects a checkout that differs from the event revision",
                fun _ ->
                    assertThat
                        (Checkouts.validate "main" "refs/heads/main" "abc" "def")
                        (isEqualTo (Error "the resolved commit does not match GITHUB_SHA"))
            )
        ]
    )

let private actionOperationTests =
    testList (
        "action operation",
        [
            test (
                "requires the publisher token only for publish",
                fun _ ->
                    assertThat (ActionOperation.validateToken ResolveOperation false) (isEqualTo (Ok()))
                    assertThat (ActionOperation.validateToken PublishOperation true) (isEqualTo (Ok()))
            )
            test (
                "rejects a publisher token in resolve",
                fun _ ->
                    assertThat
                        (ActionOperation.validateToken ResolveOperation true)
                        (isEqualTo (Error "the resolve operation must not receive a GitHub token"))
            )
            test (
                "requires a publisher token for publish",
                fun _ ->
                    assertThat
                        (ActionOperation.validateToken PublishOperation false)
                        (isEqualTo (Error "the publish operation requires a GitHub token"))
            )
        ]
    )

let private artifactTests =
    testList (
        "resolution artifact",
        [
            test (
                "accepts the caller repository and revision",
                fun _ ->
                    let artifact = {
                        Repository = "example/service"
                        BaseSha = "abc"
                        Result = {
                            Status = NoChange
                            LockFile = None
                            Changes = []
                            RequirementChanges = []
                            Messages = []
                        }
                    }

                    assertThat (ResolutionArtifacts.validate "example/service" "abc" artifact) (isEqualTo (Ok()))
            )
            test (
                "rejects another repository",
                fun _ ->
                    let artifact = {
                        Repository = "other/service"
                        BaseSha = "abc"
                        Result = {
                            Status = NoChange
                            LockFile = None
                            Changes = []
                            RequirementChanges = []
                            Messages = []
                        }
                    }

                    assertThat
                        (ResolutionArtifacts.validate "example/service" "abc" artifact)
                        (isEqualTo (Error "the resolution artifact belongs to another repository"))
            )
            test (
                "rejects another revision",
                fun _ ->
                    let artifact = {
                        Repository = "example/service"
                        BaseSha = "def"
                        Result = {
                            Status = NoChange
                            LockFile = None
                            Changes = []
                            RequirementChanges = []
                            Messages = []
                        }
                    }

                    assertThat
                        (ResolutionArtifacts.validate "example/service" "abc" artifact)
                        (isEqualTo (Error "the resolution artifact belongs to another revision"))
            )
        ]
    )

let private publicationPathTests =
    testList (
        "publication path",
        [
            test ("accepts only the root lock file", fun _ -> assertThat (PaketFiles.isLock "paket.lock") isTrue)
            test ("rejects another path", fun _ -> assertThat (PaketFiles.isLock "src/paket.lock") isFalse)
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
                "creates a refresh commit from the verified head and exact base",
                fun _ ->
                    assertThat
                        (Branches.commitParents "base" (Branches.FastForwardFrom "tracked"))
                        (isEqualTo [ "tracked"; "base" ])
            )
            test (
                "creates a new publication commit directly from its exact base",
                fun _ -> assertThat (Branches.commitParents "base" (Branches.CreateFrom "base")) (isEqualTo [ "base" ])
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

let tests =
    testList (
        "core",
        [
            eligibilityTests
            filePolicyTests
            lockDiffTests
            pullRequestTests
            pullRequestBodyTests
            checkoutTests
            actionOperationTests
            artifactTests
            publicationPathTests
            branchTests
        ]
    )
