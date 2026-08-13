module PaketaBot.Tests.Main

open type Scriptorium.Quill.Runner

[<EntryPoint>]
let main _ =
    runTests [ CoreTests.tests; WorkflowTests.tests ]
