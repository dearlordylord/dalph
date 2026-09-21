import { Effect } from "effect"
import {
  runInterruptibleBoundary,
  type InterruptibleWorkflowBoundaryExecution
} from "../../interpretation/interruptible-boundary.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation,
  type RemoteBaselineCorrelation,
  type RemoteBaselineFailure
} from "./baseline-events.js"
import { RemoteBaselineState } from "./baseline-state.js"
import {
  appendLocalTargetCatchUpIntent,
  appendLocalTargetCatchUpObservation,
  appendRemoteBaselineObservation,
  appendRemoteBaselineReadIntent,
  type CurrentRemoteBaselineEvidence,
  readAcceptedRemoteBaselineEvidence,
  validateRemoteBaselineState
} from "./baseline-transition-journal.js"

const retainedObservationFor = (failure: RemoteBaselineFailure) =>
  RemoteBaselineObservation.cases.Unavailable.make({ reason: failure.reason })

const retainedCatchUpFor = (failure: RemoteBaselineFailure) =>
  LocalTargetCatchUpResult.cases.Unavailable.make({ reason: failure.reason })

/** Records one baseline Git boundary per activation; the frontier admits the next step under a fresh owner. */
export const makeRemoteBaselineEngine = <E, R>(readEvidence: CurrentRemoteBaselineEvidence<E, R>) => {
  const establishRemoteBaseline = Effect.fn("RemoteBaseline.establish")(function* (
    correlation: RemoteBaselineCorrelation,
    execution?: InterruptibleWorkflowBoundaryExecution
  ) {
    let state = yield* validateRemoteBaselineState(yield* readEvidence(correlation.runId), correlation)
    if (state._tag === "Absent") {
      yield* appendRemoteBaselineReadIntent(correlation)
      state = RemoteBaselineState.cases.ReadPending.make({ correlation })
    }
    if (state._tag === "ReadPending") {
      const git = yield* RemoteBaselineGit
      const observation = yield* runInterruptibleBoundary(
        execution,
        { _tag: "RemoteBaseline", family: "Git", correlation, phase: "Observe" },
        git
          .observe(correlation)
          .pipe(Effect.catchTag("RemoteBaselineFailure", (failure) => Effect.succeed(retainedObservationFor(failure)))),
        (result) => appendRemoteBaselineObservation(correlation, result).pipe(Effect.as(result))
      )
      if (observation._tag === "Aligned") {
        return RemoteBaselineState.cases.Ready.make({ correlation, remoteHead: observation.remoteHead })
      }
      if (observation._tag !== "LocalAncestor") {
        return RemoteBaselineState.cases.Retained.make({
          cause: { _tag: "UnsafeObservation", observation },
          correlation
        })
      }
      return RemoteBaselineState.cases.CatchUpRequired.make({
        correlation,
        expectedLocalHead: observation.localHead,
        remoteHead: observation.remoteHead
      })
    }
    if (state._tag === "Ready" || state._tag === "Retained") return state
    if (state._tag === "CatchUpRequired") {
      yield* appendLocalTargetCatchUpIntent(correlation, state.expectedLocalHead, state.remoteHead)
      const expectedLocalHead = state.expectedLocalHead
      const remoteHead = state.remoteHead
      const result = yield* runInterruptibleBoundary(
        execution,
        { _tag: "RemoteBaseline", family: "Git", correlation, phase: "CatchUp" },
        (yield* RemoteBaselineGit)
          .catchUp(correlation, expectedLocalHead, remoteHead)
          .pipe(Effect.catchTag("RemoteBaselineFailure", () => Effect.void)),
        (result) =>
          result === undefined
            ? Effect.void
            : appendLocalTargetCatchUpObservation(correlation, expectedLocalHead, remoteHead, result).pipe(
                Effect.as(result)
              )
      )
      if (result === undefined) {
        return RemoteBaselineState.cases.CatchUpPending.make({
          correlation,
          expectedLocalHead: state.expectedLocalHead,
          remoteHead: state.remoteHead
        })
      }
      return yield* validateRemoteBaselineState(yield* readEvidence(correlation.runId), correlation)
    }
    const expectedLocalHead = state.expectedLocalHead
    const remoteHead = state.remoteHead
    const result = yield* runInterruptibleBoundary(
      execution,
      { _tag: "RemoteBaseline", family: "Git", correlation, phase: "ReconcileCatchUp" },
      (yield* RemoteBaselineGit)
        .reconcileCatchUp(correlation, expectedLocalHead, remoteHead)
        .pipe(
          Effect.catchTag("RemoteBaselineFailure", (failure) =>
            failure.reason === "ResponseDeadline" || failure.reason === "SenderStopUnproven"
              ? Effect.void
              : Effect.succeed(retainedCatchUpFor(failure))
          )
        ),
      (result) =>
        result === undefined
          ? Effect.void
          : appendLocalTargetCatchUpObservation(correlation, expectedLocalHead, remoteHead, result).pipe(
              Effect.as(result)
            )
    )
    if (result === undefined) return state
    return yield* validateRemoteBaselineState(yield* readEvidence(correlation.runId), correlation)
  })
  return { establishRemoteBaseline }
}

export const RemoteBaselineEngine = makeRemoteBaselineEngine(readAcceptedRemoteBaselineEvidence)
export const establishRemoteBaseline = RemoteBaselineEngine.establishRemoteBaseline
