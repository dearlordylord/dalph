import { Schema } from "effect"

const CodexExecutorStoryItem = Schema.TaggedUnion({
  StartOrContinue: {},
  CodexTurnResponseLost: {},
  CodexTurnCompletes: {},
  RequestSuspension: {},
  ExpectReport: { report: Schema.Literals(["Running", "Accepted", "SafelySuspended"]) }
})

export const CodexPlannedAttemptExecutorCassette = Schema.Struct({
  name: Schema.NonEmptyString,
  scenario: Schema.Literals(["FirstTurnRunning", "LostTurnResponse", "AcceptedTerminal", "SafelySuspended"]),
  story: Schema.NonEmptyArray(CodexExecutorStoryItem)
})
export type CodexPlannedAttemptExecutorCassette = typeof CodexPlannedAttemptExecutorCassette.Type

const cassette = (
  name: string,
  scenario: CodexPlannedAttemptExecutorCassette["scenario"],
  story: CodexPlannedAttemptExecutorCassette["story"]
) => CodexPlannedAttemptExecutorCassette.make({ name, scenario, story })

export const maintainedCodexPlannedAttemptExecutorCassetteCatalog = {
  firstTurnRunning: cassette(
    "the concrete Codex executor records one thread before starting one task turn",
    "FirstTurnRunning",
    [{ _tag: "StartOrContinue" }, { _tag: "ExpectReport", report: "Running" }]
  ),
  lostTurnResponseReconciled: cassette(
    "the concrete Codex executor rereads one lost turn response without starting another turn",
    "LostTurnResponse",
    [{ _tag: "StartOrContinue" }, { _tag: "CodexTurnResponseLost" }, { _tag: "ExpectReport", report: "Running" }]
  ),
  acceptedTerminal: cassette(
    "the concrete Codex executor seals one correlated accepted commit and its evidence",
    "AcceptedTerminal",
    [
      { _tag: "StartOrContinue" },
      { _tag: "ExpectReport", report: "Running" },
      { _tag: "CodexTurnCompletes" },
      { _tag: "StartOrContinue" },
      { _tag: "ExpectReport", report: "Accepted" }
    ]
  ),
  safelySuspended: cassette(
    "the concrete Codex executor interrupts its exact turn before reporting safe suspension",
    "SafelySuspended",
    [
      { _tag: "StartOrContinue" },
      { _tag: "ExpectReport", report: "Running" },
      { _tag: "RequestSuspension" },
      { _tag: "ExpectReport", report: "SafelySuspended" }
    ]
  )
} as const
