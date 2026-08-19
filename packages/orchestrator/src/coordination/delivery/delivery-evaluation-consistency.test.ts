/* eslint-disable import/no-nodejs-modules -- This test also guards the deleted process-revision seam. */
import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  currentSignalFromCurrentFirstStream,
  type DeliveryRelationInputBundle,
  TrackerGraphState
} from "./relations.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const runId = RunId.make("coherent-runtime-evaluation")
const target = FixtureTarget.make("coherent-runtime-evaluation-target")
const proposal = trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })

const bundle = (graph: DeliveryRelationInputBundle["publication"]["graph"]): DeliveryRelationInputBundle => ({
  actionInputs: {
    proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt: graph._tag === "GraphEstablished" ? graph.observation.recordedAt : null,
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
    },
    trackerGraphProposals: graph._tag === "GraphNotEstablished" ? [proposal] : []
  },
  publication: { exactEvidence: [], graph, policy }
})

it.effect("publishes graph and planned frontier as one coherent runtime evaluation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const projected = projectTrackerSnapshot({ revision: "accepted-G1", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("fixture graph must be valid")
      const established = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("accepted-G1-read"),
          recordedAt: JournalPosition.make(2),
          snapshot: projected.snapshot
        })
      })
      const state = yield* SubscriptionRef.make(bundle(TrackerGraphState.cases.GraphNotEstablished.make({})))
      const layer = makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      })
      const evaluations = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const firstSeen = yield* Deferred.make<void>()
      const collected = yield* evaluations.changes.pipe(
        Stream.tap(() => Deferred.succeed(firstSeen, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(firstSeen)
      yield* SubscriptionRef.set(state, bundle(established))
      const [before, after] = Array.from(yield* Fiber.join(collected))

      expect(before?.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(before?.proposedActions).toMatchObject({ proposals: [{ id: proposal.id }] })
      expect(before?.pauseCoverage).toEqual({
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      })
      expect(after?.current.trackerGraph).toEqual(established)
      expect(after?.proposedActions).toEqual({ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] })
    })
  )
)

it("removes process revisions and general invalidation from runtime assembly", () => {
  const sources = ["./relations.ts", "./in-memory-relations.ts", "./delivery-runtime-adapter.ts"].map((path) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
  )
  expect(sources.join("\n")).not.toMatch(/DeliveryRelationRevision|currentRevision|withStableRevision|invalidate/)
})
