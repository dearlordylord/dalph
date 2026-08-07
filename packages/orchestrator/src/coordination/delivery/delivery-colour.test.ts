import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Effect, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { delivery } from "./delivery.js"
import { makeJournal, type JournalService, type JournalState } from "./journal.js"
import { makeReactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"
import type {
  BoundedParallelTicketsProjection,
  DeliveryReflectionProjection,
  DeliverySettlementProjection,
  TicketDeliveryProjection,
  TrackerGraphRelation
} from "./relations.js"

const runId = RunId.make("delivery-colour")
const target = FixtureTarget.make("delivery-colour-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

/**
 * The descriptive half of the delivery colour. `delivery` composes projections
 * and nothing else, so its requirements name these five services and no
 * boundary. Widening them is the visible form of a colour violation, and the
 * two assignments below make this an equality rather than a containment:
 * adding a boundary dependency fails the second, dropping a projection fails
 * the first.
 */
type DeliveryProjections =
  | BoundedParallelTicketsProjection
  | DeliveryReflectionProjection
  | DeliverySettlementProjection
  | TicketDeliveryProjection
  | TrackerGraphRelation

type DescriptiveServices = Effect.Services<typeof delivery>

const descriptiveAdmitsEveryProjection = (service: DeliveryProjections): DescriptiveServices => service
const descriptiveAdmitsNothingElse = (service: DescriptiveServices): DeliveryProjections => service

it("requires exactly the projection services and no boundary", () => {
  expect([descriptiveAdmitsEveryProjection, descriptiveAdmitsNothingElse].every((f) => typeof f === "function")).toBe(
    true
  )
})

const makeJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

/** Reads stay real; the one durable write dies, naming itself. */
const withPoisonedAppend = (journal: JournalService): JournalService => ({
  ...journal,
  append: () => Effect.die("colour violation: observing a descriptive signal appended to the journal")
})

const projectionOf = (stateGet: Effect.Effect<JournalState>) => ({
  readDeliveryProjection: stateGet.pipe(
    Effect.map((journalState) => ({
      evidence: {
        _tag: "AvailableDeliveryProjectionEvidence" as const,
        acceptedAt: journalState.position,
        facts: [],
        integrationWaits: []
      },
      frontier: { explanations: [], transitions: [] }
    }))
  ),
  reconstructedPlannedAttemptPositions: []
})

/**
 * The captured half of the colour, which no type can see. A projection may
 * close over a boundary its signature never mentions, so the only way to prove
 * that observing performs no Dalph action is to poison the action and observe.
 */
it.effect("appends nothing while every descriptive signal is observed", () =>
  Effect.gen(function* () {
    const journal = yield* makeJournalService
    const layer = yield* makeReactiveDeliveryRelationsLayer(
      runId,
      target,
      withPoisonedAppend(journal),
      projectionOf(journal.state.get.pipe(Effect.orDie))
    )

    const observed = yield* Effect.gen(function* () {
      const consequences = yield* delivery
      const first = yield* consequences.get
      const streamed = yield* consequences.changes.pipe(Stream.take(1), Stream.runCollect)
      const again = yield* consequences.get
      return { again, first, streamed: Array.from(streamed) }
    }).pipe(Effect.provide(layer))

    expect(observed.streamed).toHaveLength(1)
    expect(observed.first._tag).toBe("DeliveryConsequences")
    expect(observed.again._tag).toBe("DeliveryConsequences")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
