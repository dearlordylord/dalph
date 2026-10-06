import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Schema } from "effect"
import { AuthoredCausalWindow, AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { activeWorkF2SafelySuspendsAuthoredCassette } from "../../src/cassettes/catalog.js"
import { runAuthoredScenarioCassette } from "../../src/cassettes/authored-runner.js"

const rewriteForLaterNotification = (
  item: (typeof activeWorkF2SafelySuspendsAuthoredCassette.story)[number]
): ReadonlyArray<unknown> => {
  if (item._tag === "CoordinatorProcessDies") return []
  if (item._tag === "CassettePublishesCurrentTrackerNotification") {
    return [
      { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      {
        _tag: "TrackerGraphReadReturned",
        graph: activeWorkF2SafelySuspendsAuthoredCassette.startingFacts.trackerGraph
      },
      { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } }
    ]
  }
  return [item]
}
const windowIndexShift = (startIndex: number) =>
  activeWorkF2SafelySuspendsAuthoredCassette.story.slice(0, startIndex).flatMap(rewriteForLaterNotification).length -
  startIndex
const explicitLaterNotification = {
  ...activeWorkF2SafelySuspendsAuthoredCassette,
  story: activeWorkF2SafelySuspendsAuthoredCassette.story.flatMap(rewriteForLaterNotification),
  causalWindows: (activeWorkF2SafelySuspendsAuthoredCassette.causalWindows ?? []).map((window) => ({
    ...window,
    startIndex: window.startIndex + windowIndexShift(window.startIndex),
    endIndex: window.endIndex + windowIndexShift(window.startIndex),
    occurrences: window.occurrences.map((occurrence) => ({
      ...occurrence,
      storyIndex: occurrence.storyIndex + windowIndexShift(window.startIndex)
    }))
  }))
}

it.effect("installs one owner before a later explicit notification without inventing a startup notification", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(explicitLaterNotification)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.cassette.story.some((item) => item._tag === "CoordinatorProcessDies")).toBe(false)
    const hints = run.observationCaptures.filter(
      (capture) =>
        capture._tag === "AuthoredStoryOccurrenceCaptured" &&
        capture.occurrence._tag === "CassetteOffersRunReactivationHints"
    )
    expect(hints).toHaveLength(2)
    expect(run.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("propagates an unrelated authored boundary failure without restarting its owner", () =>
  Effect.gen(function* () {
    const broken = {
      ...explicitLaterNotification,
      story: explicitLaterNotification.story.map((item, index) =>
        index === 2 ? { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "wrong-target" } } : item
      )
    }
    const exit = yield* Effect.exit(runAuthoredScenarioCassette(broken))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("TraceOutput.TraceOutputError")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("consumes each idle-boundary process death once before installing the next owner", () =>
  Effect.gen(function* () {
    const startingCassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(explicitLaterNotification)
    const restart = [
      { _tag: "CoordinatorProcessDies" },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: startingCassette.startingFacts.trackerGraph },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: startingCassette.startingFacts.trackerGraph },
      { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } }
    ]
    const restartReconfirmationItemOffset = 3
    const recoveredStory = {
      ...explicitLaterNotification,
      causalWindows: explicitLaterNotification.causalWindows.filter(
        (window) =>
          window.endIndex <= startingCassette.story.findIndex((item) => item._tag === "CoordinatorActivationReturned")
      ),
      story: [
        ...startingCassette.story.slice(
          0,
          startingCassette.story.findIndex((item) => item._tag === "CoordinatorActivationReturned") + 1
        ),
        ...restart,
        ...restart.slice(0, restartReconfirmationItemOffset),
        { _tag: "CassetteOffersRunReactivationHints", hints: ["Timer"] },
        ...restart.slice(restartReconfirmationItemOffset),
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: startingCassette.startingFacts.trackerGraph },
        ...startingCassette.startingFacts.taskWorkSpecifications.flatMap((specification) => [
          { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: specification.taskId } },
          { _tag: "TaskWorkSpecificationReadReturned", ...specification },
          { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: specification.taskId } },
          { _tag: "TaskClaimCurrentReadReturned", taskId: specification.taskId },
          {
            _tag: "DalphSelects",
            operation: {
              _tag: "ReadTaskWorktree",
              taskId: specification.taskId,
              attemptId: `attempt:${specification.taskId}:0`
            }
          },
          {
            _tag: "DalphSelects",
            operation: {
              _tag: "ReadTargetLineage",
              taskId: specification.taskId,
              attemptId: `attempt:${specification.taskId}:0`
            }
          }
        ]),
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: startingCassette.startingFacts.trackerGraph },
        { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
        { _tag: "ExpectedBehavior", orchestration: null, protocol: null, taskWork: { absences: [], results: [] } }
      ]
    }
    const recovered = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(recoveredStory)
    const recoveredReadsStart = recovered.story.findLastIndex(
      (item) =>
        item._tag === "DalphSelects" &&
        item.operation._tag === "ReadTaskWorkSpecification" &&
        item.operation.taskId === startingCassette.startingFacts.taskWorkSpecifications[0]?.taskId
    )
    const recoveredReadSteps = ["specification", "specification-result", "claim", "claim-result", "worktree", "lineage"]
    const recoveredWindow = Schema.decodeUnknownSync(AuthoredCausalWindow)({
      startIndex: recoveredReadsStart,
      endIndex:
        recoveredReadsStart + startingCassette.startingFacts.taskWorkSpecifications.length * recoveredReadSteps.length,
      occurrences: startingCassette.startingFacts.taskWorkSpecifications.flatMap(({ taskId }, taskIndex) =>
        recoveredReadSteps.map((step, stepIndex) => ({
          id: `recovered-${taskId}-${step}`,
          storyIndex: recoveredReadsStart + taskIndex * recoveredReadSteps.length + stepIndex,
          predecessorIds: stepIndex === 0 ? [] : [`recovered-${taskId}-${recoveredReadSteps[stepIndex - 1]}`],
          ...(step === "specification-result" ? { ownerRole: `recovered-${taskId}-specification` } : {}),
          ...(step === "claim-result" ? { ownerRole: `recovered-${taskId}-claim` } : {})
        }))
      )
    })
    const cassette = { ...recovered, causalWindows: [...(recovered.causalWindows ?? []), recoveredWindow] }
    const run = yield* runAuthoredScenarioCassette(cassette)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    const deaths = run.observationCaptures.filter(
      (capture) =>
        capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === "CoordinatorProcessDies"
    )
    expect(deaths).toHaveLength(2)
    expect(run.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    // Each process may admit its owed trailing entry before the authored death
    // or terminal cut closes it. Only four entries select authored boundaries.
    expect(run.activationOrdinals).toEqual([1, 2, 3, 4, 5, 6, 7])
    const selectedActivationOrdinals = run.observationCaptures.flatMap((capture) =>
      capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === "DalphSelects"
        ? [capture.activationOrdinal]
        : []
    )
    expect([...new Set(selectedActivationOrdinals)]).toEqual([1, 3, 5, 6])
    expect(deaths.map(({ activationOrdinal }) => activationOrdinal)).toEqual([1, 3])
  }).pipe(Effect.provide(NodeCrypto.layer))
)
