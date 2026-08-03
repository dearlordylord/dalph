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
  type AcceptedTrackerGraphObservation,
  type DeliveryGraphPublication
} from "./relations.js"
import { makeTestAcceptedTrackerGraphObservation } from "../../../test/accepted-graph-observation.js"
import {
  boundedParallelTicketsOf,
  frontierOf,
  selectedTicketIds,
  ticketDeliveriesOf
} from "./ticket-delivery-projection.js"

const fixtureObservation = (snapshot: TaskDagSnapshot): AcceptedTrackerGraphObservation => {
  const operationId = OperationId.make(`fixture:${snapshot.revision}`)
  return makeTestAcceptedTrackerGraphObservation({ snapshot, operationId, acceptedAt: JournalPosition.make(1) })
}

const publication = (graph: TrackerGraphState, policy: RunControlPolicy): DeliveryGraphPublication => ({
  exactEvidence: [],
  graph,
  policy
})

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

        expect(selectedTicketIds(boundedParallelTicketsOf(frontierOf(publication(graph, policy))))).toEqual(
          ids.toSorted().slice(0, capacity)
        )
      }
    )
  )
})

it("retains an exact planned-attempt obligation across every graph placement and exclusion reason", () => {
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
      fc.constantFrom(
        "selected",
        "eligibleOutsideBound",
        "prerequisitesIncomplete",
        "successfulCompletion",
        "terminalWithoutSuccess",
        "absent"
      ),
      fc.array(fc.stringMatching(/^[A-Y]$/), { maxLength: 8 }),
      (capacity, placement, generatedNeighbours) => {
        const neighbours =
          placement === "eligibleOutsideBound"
            ? [
                ...new Set([
                  ...generatedNeighbours,
                  ...Array.from({ length: capacity }, (_, index) => String.fromCharCode(65 + index))
                ])
              ]
            : placement === "prerequisitesIncomplete"
              ? ["P"]
              : placement === "absent"
                ? generatedNeighbours
                : []
        const retained =
          placement === "absent"
            ? []
            : [
                {
                  id: retainedTaskId,
                  lifecycle:
                    placement === "selected" ||
                    placement === "eligibleOutsideBound" ||
                    placement === "prerequisitesIncomplete"
                      ? TaskLifecycle.cases.Open.make({})
                      : placement === "successfulCompletion"
                        ? TaskLifecycle.cases.CompletedSuccessfully.make({})
                        : TaskLifecycle.cases.TerminalWithoutSuccess.make({}),
                  parentTaskId: null,
                  prerequisiteIds: placement === "prerequisitesIncomplete" ? [TaskId.make("P")] : []
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
        const currentPolicy = RunControlPolicy.make({
          revision: initialRunPolicyRevision,
          taskExecutionCapacity: TaskWorkCapacity.make(capacity)
        })
        const projected = ticketDeliveriesOf(boundedParallelTicketsOf(frontierOf(publication(graph, currentPolicy))), [
          evidence
        ])

        const retainedDelivery = projected.deliveries.find(({ taskId }) => taskId === retainedTaskId)
        expect(retainedDelivery).toBeDefined()
        expect(retainedDelivery?.obligations).toHaveLength(1)
        expect(retainedDelivery?.standings[0]?._tag).toBe("ResponsibilitySituation")

        const expectedPlacement =
          placement === "selected"
            ? "Selected"
            : placement === "eligibleOutsideBound"
              ? "EligibleOutsideBound"
              : placement === "absent"
                ? "AbsentFromCurrentGraph"
                : "GraphExcluded"
        expect(retainedDelivery?.placement._tag).toBe(expectedPlacement)
        if (placement === "prerequisitesIncomplete") {
          expect(retainedDelivery?.placement).toMatchObject({
            _tag: "GraphExcluded",
            reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [TaskId.make("P")] }]
          })
        }
        if (placement === "successfulCompletion") {
          expect(retainedDelivery?.placement).toMatchObject({
            _tag: "GraphExcluded",
            reasons: [{ _tag: "SuccessfulCompletion" }]
          })
        }
        if (placement === "terminalWithoutSuccess") {
          expect(retainedDelivery?.placement).toMatchObject({
            _tag: "GraphExcluded",
            reasons: [{ _tag: "TerminalWithoutSuccess" }]
          })
        }
      }
    )
  )
})
