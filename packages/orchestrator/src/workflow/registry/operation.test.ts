import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { OperationId } from "../identity.js"
import { makeTrackerGraphObservationOperation, TaskClaimReleaseAuthority, WorkflowOperation } from "./operation.js"
import { AttemptChoiceRequestId } from "../protocols/attempt-choice/events.js"
import {
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequestOrdinal
} from "../protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"

const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("operation-test-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId: TaskId.make("operation-test-task"),
  token: ClaimToken.make("operation-test-token")
})
const release = TaskClaimRelease.make({ claim, operationId: OperationId.make("operation-test-release") })
const authority = TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({})

it.effect("requires a claim release to follow its acquisition without naming itself", () =>
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownEffect(WorkflowOperation)
    expect(
      (yield* decode({
        _tag: "ReleaseTaskClaim",
        authority,
        predecessorOperationIds: [release.operationId, claim.operationId],
        release
      }).pipe(Effect.flip))._tag
    ).toBe("SchemaError")
    expect(
      (yield* decode({ _tag: "ReleaseTaskClaim", authority, predecessorOperationIds: [], release }).pipe(Effect.flip))
        ._tag
    ).toBe("SchemaError")
    expect(
      yield* decode({ _tag: "ReleaseTaskClaim", authority, predecessorOperationIds: [claim.operationId], release })
    ).toEqual({ _tag: "ReleaseTaskClaim", authority, predecessorOperationIds: [claim.operationId], release })
  })
)

it.effect("requires a stopped-attempt claim release to name its focused claim observation", () =>
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownEffect(WorkflowOperation)
    const observationOperationId = OperationId.make("operation-test-focused-claim-read")
    const stoppedAuthority = TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
      observationOperationId,
      requestId: AttemptChoiceRequestId.make({ nonce: "operation-test-stop", runId: RunId.make("operation-test-run") })
    })

    expect(
      (yield* decode({
        _tag: "ReleaseTaskClaim",
        authority: stoppedAuthority,
        predecessorOperationIds: [claim.operationId],
        release
      }).pipe(Effect.flip))._tag
    ).toBe("SchemaError")
    expect(
      yield* decode({
        _tag: "ReleaseTaskClaim",
        authority: stoppedAuthority,
        predecessorOperationIds: [claim.operationId, observationOperationId],
        release
      })
    ).toMatchObject({ authority: stoppedAuthority })
  })
)

it.effect("requires a completion facts read to use its deterministic operation identity", () =>
  Effect.gen(function* () {
    const purpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
    })
    const failure = yield* Schema.decodeUnknownEffect(WorkflowOperation)({
      _tag: "ReadCompletionTaskFacts",
      operationId: OperationId.make("foreign-completion-facts-read"),
      predecessorOperationIds: [],
      purpose,
      request: integrationFinalityFixture.completionRequest,
      target: integrationFinalityFixture.target
    }).pipe(Effect.flip)
    expect(failure._tag).toBe("SchemaError")
  })
)

it.effect("decodes one ordinary complete graph-read operation", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("operation-test-graph-target")
    const predecessor = OperationId.make("operation-test-graph-predecessor")
    const ordinary = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("operation-test-ordinary-graph"),
      target,
      [predecessor]
    )
    const decode = Schema.decodeUnknownEffect(WorkflowOperation)
    const decoded = yield* decode({
      _tag: "ReadTrackerGraph",
      cause: ordinary.cause,
      operationId: ordinary.operationId,
      predecessorOperationIds: ordinary.predecessorOperationIds,
      readShape: ordinary.readShape,
      target: ordinary.target
    })
    expect(decoded).toEqual(ordinary)
  })
)

it.effect("requires a post-quiescence graph read to name its distinct causal graph predecessor", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("operation-test-post-quiescence-target")
    const currentGraphOperationId = OperationId.make("operation-test-current-graph")
    const decode = Schema.decodeUnknownEffect(WorkflowOperation)
    const candidate = {
      _tag: "ReadTrackerGraph",
      cause: { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: currentGraphOperationId },
      operationId: OperationId.make("operation-test-post-quiescence-graph"),
      predecessorOperationIds: [] as ReadonlyArray<OperationId>,
      readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [] },
      target
    } as const

    expect((yield* decode(candidate).pipe(Effect.flip))._tag).toBe("SchemaError")
    expect(
      (yield* decode({
        ...candidate,
        cause: { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: candidate.operationId },
        predecessorOperationIds: [candidate.operationId]
      }).pipe(Effect.flip))._tag
    ).toBe("SchemaError")
    expect(yield* decode({ ...candidate, predecessorOperationIds: [currentGraphOperationId] })).toMatchObject({
      cause: candidate.cause,
      operationId: candidate.operationId,
      predecessorOperationIds: [currentGraphOperationId]
    })
  })
)
