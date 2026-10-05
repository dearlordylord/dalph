import { ExecutorGuidanceSelection } from "@dalph/contracts"
import { Effect, Schedule } from "effect"

/** Qualification first establishes readable native custody before its single
 * steering effect. These bounded reads neither retry steering nor alter the
 * production executor's fail-closed selection behavior. */
export const awaitQualificationGuidanceSelection = (
  select: Effect.Effect<ExecutorGuidanceSelection>,
  census: Effect.Effect<string>
): Effect.Effect<ExecutorGuidanceSelection> =>
  select.pipe(
    Effect.repeat({
      times: 4,
      schedule: Schedule.spaced("100 millis"),
      while: (selection) =>
        selection._tag === "Refused" && selection.reason === "CustodyUnproved"
          ? census.pipe(Effect.map((diagnostic) => diagnostic.startsWith("Unreadable/")))
          : false
    }),
    Effect.timeoutOrElse({
      duration: "1 second",
      orElse: () => Effect.succeed(ExecutorGuidanceSelection.cases.Refused.make({ reason: "CustodyUnproved" }))
    })
  )
