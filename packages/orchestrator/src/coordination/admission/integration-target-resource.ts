import { Effect, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import { IntegrationTarget } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"

export interface IntegrationTargetResourceResponsibility {
  readonly integrationTarget: IntegrationTarget
  readonly queuedAt: JournalPosition
}

export interface IntegrationTargetResourceSnapshot {
  readonly activeResponsibilityPositions: ReadonlySet<JournalPosition>
  readonly heldResponsibilityPositions: ReadonlySet<JournalPosition>
}

/** A different responsibility already holds the exact process-local integration target. */
export class IntegrationTargetResourceUnavailable extends Schema.TaggedError<IntegrationTargetResourceUnavailable>()(
  "IntegrationTargetResourceUnavailable",
  { heldBy: JournalPosition, requestedBy: JournalPosition, target: IntegrationTarget }
) {}

interface IntegrationTargetResourceLease {
  readonly permit: Semaphore.Semaphore
  readonly queuedAt: JournalPosition
  readonly target: IntegrationTarget
}

export interface IntegrationTargetResourceController {
  readonly acquire: (
    responsibility: IntegrationTargetResourceResponsibility
  ) => Effect.Effect<void, IntegrationTargetResourceUnavailable>
  readonly release: (responsibility: IntegrationTargetResourceResponsibility) => Effect.Effect<void>
  /** Publishes an acquisition only after the action that owns it is accepted. */
  readonly publishAcceptedOwnership: (responsibility: IntegrationTargetResourceResponsibility) => Effect.Effect<void>
  /** Releases every process-local lease when its sole owning runtime closes. */
  readonly releaseAll: Effect.Effect<void>
  readonly snapshot: Effect.Effect<IntegrationTargetResourceSnapshot>
  /** Accepted process-local ownership changes, published by this owning protocol. */
  readonly changes: Stream.Stream<IntegrationTargetResourceSnapshot>
  readonly withPermit: <A, E, R>(
    responsibility: IntegrationTargetResourceResponsibility,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
}

/** The delivery frontier's acquire transition is executed by the resource owner, not by a test projection. */
export const acquireStartedIntegrationTarget = Effect.fn("IntegrationTargetResource.acquireStartedIntegrationTarget")(
  function* (
    resources: IntegrationTargetResourceController,
    transition: {
      readonly _tag: "AcquireStartedIntegrationTarget"
      readonly responsibility: StartedIntegrationResponsibility
    }
  ) {
    yield* resources.acquire(transition.responsibility)
    yield* resources.publishAcceptedOwnership(transition.responsibility)
  }
)

/** The delivery frontier's release transition is executed by the resource owner, not by a test projection. */
export const releaseStartedIntegrationTarget = Effect.fn("IntegrationTargetResource.releaseStartedIntegrationTarget")(
  function* (
    resources: IntegrationTargetResourceController,
    transition: {
      readonly _tag: "ReleaseStartedIntegrationTarget"
      readonly responsibility: StartedIntegrationResponsibility
    }
  ) {
    yield* resources.release(transition.responsibility)
  }
)

const targetKey = (target: IntegrationTarget): string => JSON.stringify([target.repository, target.ref])

/** Creates one process-local owner; restart intentionally creates an empty owner. */
export const makeIntegrationTargetResourceController = Effect.fn("IntegrationTargetResourceController.make")(
  function* (): Effect.fn.Return<IntegrationTargetResourceController> {
    const leases = yield* Ref.make<ReadonlyMap<string, IntegrationTargetResourceLease>>(new Map())
    const accepted = yield* Ref.make<ReadonlySet<JournalPosition>>(new Set())
    const active = yield* Ref.make<ReadonlySet<JournalPosition>>(new Set())
    const changeRevision = yield* SubscriptionRef.make(0)
    const publishChange = SubscriptionRef.update(changeRevision, (current) => current + 1)
    const snapshot = Effect.all({ accepted: Ref.get(accepted), active: Ref.get(active), leases: Ref.get(leases) }).pipe(
      Effect.map(({ accepted, active, leases }) => ({
        activeResponsibilityPositions: new Set([...active].filter((position) => accepted.has(position))),
        heldResponsibilityPositions: new Set(
          [...leases.values()].flatMap(({ queuedAt }) => (accepted.has(queuedAt) ? [queuedAt] : []))
        )
      }))
    )
    const acquire = Effect.fn("IntegrationTargetResourceController.acquire")(function* (
      responsibility: IntegrationTargetResourceResponsibility
    ) {
      const key = targetKey(responsibility.integrationTarget)
      const permit = yield* Semaphore.make(1)
      const conflict = yield* Ref.modify(leases, (current) => {
        const existing = current.get(key)
        if (existing?.queuedAt === responsibility.queuedAt) return [undefined, current] as const
        if (existing !== undefined) return [existing, current] as const
        return [
          undefined,
          new Map(current).set(key, {
            permit,
            queuedAt: responsibility.queuedAt,
            target: responsibility.integrationTarget
          })
        ] as const
      })
      if (conflict !== undefined) {
        return yield* new IntegrationTargetResourceUnavailable({
          heldBy: conflict.queuedAt,
          requestedBy: responsibility.queuedAt,
          target: responsibility.integrationTarget
        })
      }
    })
    const release = Effect.fn("IntegrationTargetResourceController.release")(function* (
      responsibility: IntegrationTargetResourceResponsibility
    ) {
      yield* Ref.update(leases, (current) => {
        const key = targetKey(responsibility.integrationTarget)
        return current.get(key)?.queuedAt === responsibility.queuedAt
          ? new Map([...current].filter(([candidate]) => candidate !== key))
          : current
      })
      yield* Ref.update(
        accepted,
        (current) => new Set([...current].filter((position) => position !== responsibility.queuedAt))
      )
      yield* publishChange
    })
    const publishAcceptedOwnership = Effect.fn("IntegrationTargetResourceController.publishAcceptedOwnership")(
      function* (responsibility: IntegrationTargetResourceResponsibility) {
        const lease = (yield* Ref.get(leases)).get(targetKey(responsibility.integrationTarget))
        if (lease?.queuedAt !== responsibility.queuedAt) {
          return yield* Effect.die("accepted integration ownership requires its exact acquired responsibility")
        }
        yield* Ref.update(accepted, (current) => new Set(current).add(responsibility.queuedAt))
        yield* publishChange
      }
    )
    return {
      acquire,
      changes: SubscriptionRef.changes(changeRevision).pipe(Stream.mapEffect(() => snapshot)),
      publishAcceptedOwnership,
      release,
      releaseAll: Ref.set(leases, new Map()).pipe(
        Effect.andThen(Ref.set(accepted, new Set())),
        Effect.andThen(Ref.set(active, new Set())),
        Effect.andThen(publishChange)
      ),
      snapshot,
      withPermit: (responsibility, effect) =>
        Ref.get(leases).pipe(
          Effect.flatMap((current) => {
            const lease = current.get(targetKey(responsibility.integrationTarget))
            return lease?.queuedAt === responsibility.queuedAt
              ? lease.permit.withPermit(
                  Ref.update(active, (currentActive) => new Set(currentActive).add(responsibility.queuedAt)).pipe(
                    Effect.andThen(publishChange),
                    Effect.andThen(effect),
                    Effect.ensuring(
                      Ref.update(
                        active,
                        (currentActive) =>
                          new Set([...currentActive].filter((position) => position !== responsibility.queuedAt))
                      ).pipe(Effect.andThen(publishChange))
                    )
                  )
                )
              : Effect.die("integration target permit requires its exact held responsibility")
          })
        )
    }
  }
)
