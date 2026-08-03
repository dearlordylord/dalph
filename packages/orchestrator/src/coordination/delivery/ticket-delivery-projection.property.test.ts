import { expect, it } from "vitest"
import * as fc from "fast-check"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import {
  TrackerGraphState,
  type ExactTicketDeliveryEvidence,
  type AcceptedTrackerGraphObservation
} from "./relations.js"
import {
  boundedParallelTicketsOf,
  frontierOf,
  selectedTicketIds,
  ticketDeliveriesOf
} from "./ticket-delivery-projection.js"

const fixtureObservation = (snapshot: TaskDagSnapshot): AcceptedTrackerGraphObservation => {
  const operationId = OperationId.make(`fixture:${snapshot.revision}`)
  return {
    _tag: "AcceptedTrackerGraphObservation",
    snapshot,
    operationId,
    contentIdentity: snapshot.revision,
    acceptedAt: JournalPosition.make(1),
    freshness: { _tag: "ObservedDuringLogicalRead", operationId }
  }
}

it("keeps bounded selection invariant under tracker task permutation", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.stringMatching(/^[A-Z][A-Z0-9]{0,4}$/), { minLength: 1, maxLength: 8 }),
      fc.integer({ min: 1, max: 8 }),
      fc.integer(),
      (ids, capacity, seed) => {
        const shuffled = fc.sample(fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length }), {
          seed,
          numRuns: 1
        })[0]
        const projected = TaskDagSnapshot.project(
          TrackerSnapshot.make({
            revision: TrackerRevision.make("property-graph"),
            tasks: (shuffled ?? ids).map((id) => ({
              id: TaskId.make(id),
              lifecycle: TaskLifecycle.cases.Open.make({}),
              parentTaskId: null,
              prerequisiteIds: []
            }))
          })
        )
        if (projected._tag === "Invalid") return expect.fail("generated graph must be valid")
        const graph = TrackerGraphState.cases.GraphEstablished.make({
          observation: fixtureObservation(projected.snapshot)
        })
        const policy = RunControlPolicy.make({
          revision: initialRunPolicyRevision,
          taskExecutionCapacity: TaskWorkCapacity.make(capacity)
        })

        expect(selectedTicketIds(boundedParallelTicketsOf(frontierOf(graph), policy))).toEqual(
          ids.toSorted().slice(0, capacity)
        )
      }
    )
  )
})

it("retains an exact planned-attempt obligation under every graph placement and policy ceiling", () => {
  const retainedTaskId = TaskId.make("Z")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("attempt:Z"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/Z"),
    executor: TaskExecutorLocator.make("executor:fake"),
    runId: RunId.make("run-property"),
    taskId: retainedTaskId,
    taskRevision: TaskRevision.make("revision:Z"),
    worktree: WorktreeLocator.make("/worktrees/Z")
  })
  const evidence: ExactTicketDeliveryEvidence = {
    _tag: "ResponsibilityFacts",
    facts: {
      _tag: "PlannedAttemptExecutorFreshFacts",
      disposition: ResponsibilityDisposition.Ready(),
      responsibility: {
        _tag: "PlannedAttemptExecutorWorkResponsibility",
        beganAt: JournalPosition.make(2),
        plannedAttempt
      }
    }
  }
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }),
      fc.constantFrom("eligible", "completed", "failed", "absent"),
      fc.array(fc.stringMatching(/^[A-Y]$/), { maxLength: 8 }),
      (capacity, placement, neighbours) => {
        const retained =
          placement === "absent"
            ? []
            : [
                {
                  id: retainedTaskId,
                  lifecycle:
                    placement === "eligible"
                      ? TaskLifecycle.cases.Open.make({})
                      : placement === "completed"
                        ? TaskLifecycle.cases.CompletedSuccessfully.make({})
                        : TaskLifecycle.cases.TerminalWithoutSuccess.make({}),
                  parentTaskId: null,
                  prerequisiteIds: []
                }
              ]
        const graphResult = TaskDagSnapshot.project(
          TrackerSnapshot.make({
            revision: TrackerRevision.make(`property-${placement}`),
            tasks: [
              ...[...new Set(neighbours)].map((id) => ({
                id: TaskId.make(id),
                lifecycle: TaskLifecycle.cases.Open.make({}),
                parentTaskId: null,
                prerequisiteIds: []
              })),
              ...retained
            ]
          })
        )
        if (graphResult._tag === "Invalid") return expect.fail("generated graph must be valid")
        const graph = TrackerGraphState.cases.GraphEstablished.make({
          observation: fixtureObservation(graphResult.snapshot)
        })
        const projected = ticketDeliveriesOf(
          boundedParallelTicketsOf(
            frontierOf(graph),
            RunControlPolicy.make({
              revision: initialRunPolicyRevision,
              taskExecutionCapacity: TaskWorkCapacity.make(capacity)
            })
          ),
          [evidence]
        )

        expect(projected.deliveries.some(({ taskId }) => taskId === retainedTaskId)).toBe(true)
      }
    )
  )
})
