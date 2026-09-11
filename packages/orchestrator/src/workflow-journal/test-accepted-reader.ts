import { Effect, Layer } from "effect"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { AcceptedJournalReader } from "./accepted-reader.js"
import { JournalPosition } from "./identity.js"
import { JournalHistoryInvalid, JournalStore } from "./store.js"

/** Test-only accepted-prefix reader layered over raw storage protocol fixtures. */
export const unpublishedAcceptedJournalReaderTestLayer = Layer.effect(
  AcceptedJournalReader,
  JournalStore.pipe(
    Effect.map((journal) =>
      AcceptedJournalReader.of({
        readAccepted: (runId) =>
          journal.read(runId).pipe(
            Effect.orDie,
            Effect.flatMap((records) => {
              const reduced = reduceWorkflowJournalHistory(runId, records)
              if (reduced._tag === "ValidWorkflowJournalHistory") return Effect.succeed(reduced.prefix)
              const issue = reduced.issues[0]
              return Effect.fail(
                new JournalHistoryInvalid({
                  detail: issue === undefined ? "journal history is invalid" : JSON.stringify(issue),
                  position: issue !== undefined && "position" in issue ? issue.position : JournalPosition.make(1),
                  runId
                })
              )
            })
          )
      })
    )
  )
)
