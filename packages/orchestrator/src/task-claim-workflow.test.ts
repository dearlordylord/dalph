import { it } from "@effect/vitest"
import { Effect, Layer, Ref, Schema } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  ClaimOwner,
  ClaimToken,
  controlledTrackerMutationLayer,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  deterministicTestWorkflowInterpreterLayer,
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  GitCommitSha,
  MatchingTaskWorkSessionReported,
  OperationId,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  runWorkflow,
  TaskClaimAcquisition,
  TaskExecutorLocator,
  TaskId,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TrackerGraphReader,
  trackerGraphReaderFileLayer,
  TrackerMutation,
  WorkflowOperation,
  workflowOperationId,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import type { TraceItem } from "./workflow.js"

const target = FixtureTarget.make(
  new URL("../fixtures/singleton.json", import.meta.url).pathname
)
const claimPlanningLayer = deterministicTaskClaimAcquisitionPlannerLayer({
  owner: ClaimOwner.make("workflow-claim-owner"),
  tokenPrefix: "workflow-claim"
})
const attemptPlanningLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  executor: TaskExecutorLocator.make("executor:claim-workflow"),
  runId: RunId.make("claim-workflow"),
  sessionRoot: TaskWorkSessionLocator.make("session:claim-workflow"),
  worktreeRoot: WorktreeLocator.make("/tmp/dalph-claim-workflow")
})
const taskRunnerLayer = Layer.succeed(
  TaskRunner,
  TaskRunner.of({
    lookupTaskWorkSession: Effect.fn("TaskRunner.ClaimWorkflow.lookup")(
      function*(lookup) {
        return MatchingTaskWorkSessionReported.make({
          observationId: ProviderObservationId.make(`lookup:${lookup.operationId}`),
          sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
          work: { _tag: "NoProviderWorkReported" }
        })
      }
    ),
    requestTaskWorkStart: Effect.fn("TaskRunner.ClaimWorkflow.request")(
      function*(request) {
        return {
          observationId: ProviderObservationId.make(`request:${request.operationId}`),
          providerRequestId: ProviderRequestId.make(`provider:${request.operationId}`)
        }
      }
    )
  })
)

const collectTrace = (
  interpreterLayer: typeof deterministicTestWorkflowInterpreterLayer
) =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    yield* runWorkflow(target, TaskWorkCapacity.make(1)).pipe(
      Effect.provide(interpreterLayer),
      Effect.provide(controlledTrackerMutationLayer),
      Effect.provide(taskRunnerLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(claimPlanningLayer),
      Effect.provide(attemptPlanningLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("claim-workflow")),
      Effect.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({
          emit: (item) => Ref.update(items, (current) => [...current, item])
        })
      ))
    )
    return yield* Ref.get(items)
  })

it.effect("admits tracker execution only after an authoritative post-claim read", () =>
  Effect.gen(function*() {
    const items = yield* collectTrace(deterministicTestWorkflowInterpreterLayer)
    const tags = items.map((item) => item._tag)
    const claimIndex = tags.indexOf("TaskClaimAcquired")
    const postClaimReadIndex = tags.lastIndexOf("TrackerGraphOutcomeObserved")
    const admissionIndex = tags.indexOf("TrackerExecutionAdmitted")

    expect(claimIndex).toBeGreaterThan(-1)
    expect(postClaimReadIndex).toBeGreaterThan(claimIndex)
    expect(admissionIndex).toBeGreaterThan(postClaimReadIndex)
    expect(tags).toContain("TaskExecutionAdmitted")
    expect(tags).not.toContain("TaskExecutionStarted")
  }))

it.effect("dry-run emits claim intent without tracker mutation or admission", () =>
  Effect.gen(function*() {
    const mutations = yield* Ref.make(0)
    const deniedMutationLayer = Layer.succeed(
      TrackerMutation,
      TrackerMutation.of({
        acquireTaskClaim: () =>
          Ref.update(mutations, (count) => count + 1).pipe(Effect.andThen(Effect.die("dry mutation"))),
        readTaskClaim: () => Effect.die("dry claim read"),
        releaseTaskClaim: () => Effect.die("dry release")
      })
    )
    const items = yield* collectTrace(dryRunWorkflowInterpreterLayer).pipe(
      Effect.provide(deniedMutationLayer)
    )
    const tags = items.map((item) => item._tag)

    expect(yield* Ref.get(mutations)).toBe(0)
    expect(tags).toContain("TaskClaimAcquisitionIntended")
    expect(tags).not.toContain("TaskClaimAcquired")
    expect(tags).not.toContain("TrackerExecutionAdmitted")
  }))

it.effect("does not admit a claimed task missing from the post-claim tracker read", () =>
  Effect.gen(function*() {
    const reads = yield* Ref.make(0)
    const starts = yield* Ref.make(0)
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const inScope = validSnapshot({
      revision: "in-scope",
      tasks: [{
        id: "task-leaves-scope",
        lifecycle: { _tag: "Open" },
        parentTaskId: null,
        prerequisiteIds: []
      }]
    })
    const outOfScope = validSnapshot({ revision: "out-of-scope", tasks: [] })
    const readerLayer = Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: () =>
          Ref.getAndUpdate(reads, (count) => count + 1).pipe(
            Effect.map((ordinal) => ordinal < 2 ? inScope : outOfScope)
          )
      })
    )
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("out-of-scope lookup"),
        requestTaskWorkStart: () =>
          Ref.update(starts, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("out-of-scope start"))
          )
      })
    )

    yield* runWorkflow(
      FixtureTarget.make("out-of-scope-target"),
      TaskWorkCapacity.make(1)
    ).pipe(
      Effect.provide(deterministicTestWorkflowInterpreterLayer),
      Effect.provide(readerLayer),
      Effect.provide(runnerLayer),
      Effect.provide(claimPlanningLayer),
      Effect.provide(attemptPlanningLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("out-of-scope")),
      Effect.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({
          emit: (item) => Ref.update(items, (current) => [...current, item])
        })
      ))
    )

    const tags = (yield* Ref.get(items)).map((item) => item._tag)
    expect(tags).toContain("TaskClaimAcquired")
    expect(tags).not.toContain("TrackerExecutionAdmitted")
    expect(yield* Ref.get(starts)).toBe(0)
    expect(yield* Ref.get(reads)).toBe(3)
  }))

it.effect("rejects self-preceding claim operations and projects their identity", () =>
  Effect.gen(function*() {
    const operationId = OperationId.make("claim-operation-identity")
    const acquisition = TaskClaimAcquisition.make({
      operationId,
      owner: ClaimOwner.make("claim-operation-owner"),
      taskId: TaskId.make("claim-operation-task"),
      token: ClaimToken.make("claim-operation-token")
    })
    const decoded = yield* Schema.decodeUnknownEffect(WorkflowOperation)({
      _tag: "AcquireTaskClaim",
      acquisition,
      predecessorOperationIds: []
    })
    expect(workflowOperationId(decoded)).toBe(operationId)

    const failure = yield* Schema.decodeUnknownEffect(WorkflowOperation)({
      _tag: "AcquireTaskClaim",
      acquisition,
      predecessorOperationIds: [operationId]
    }).pipe(Effect.flip)
    expect(String(failure)).toContain("cannot causally precede itself")
  }))
