import { Effect, Ref, Schema, Semaphore } from "effect"
import { IntegrationTarget } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"

export interface IntegrationTargetResourceResponsibility {
  readonly integrationTarget: IntegrationTarget
  readonly queuedAt: JournalPosition
}

export interface IntegrationTargetResourceSnapshot {
  readonly activeResponsibilityPositions: ReadonlySet<JournalPosition>
  readonly heldResponsibilityPositions: ReadonlySet<JournalPosition>
}

/** A different responsibility already holds the exact process-local integration target. */
export class IntegrationTargetResourceUnavailable extends Schema.TaggedErrorClass<IntegrationTargetResourceUnavailable>()(
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
  readonly snapshot: Effect.Effect<IntegrationTargetResourceSnapshot>
  readonly withPermit: <A, E, R>(
    responsibility: IntegrationTargetResourceResponsibility,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
}

const targetKey = (target: IntegrationTarget): string => JSON.stringify([target.repository, target.ref])

/** Creates one process-local owner; restart intentionally creates an empty owner. */
export const makeIntegrationTargetResourceController = Effect.fn("IntegrationTargetResourceController.make")(
  function* (): Effect.fn.Return<IntegrationTargetResourceController> {
    const leases = yield* Ref.make<ReadonlyMap<string, IntegrationTargetResourceLease>>(new Map())
    const active = yield* Ref.make<ReadonlySet<JournalPosition>>(new Set())
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
    const release = Effect.fn("IntegrationTargetResourceController.release")(
      (responsibility: IntegrationTargetResourceResponsibility) =>
        Ref.update(leases, (current) => {
          const key = targetKey(responsibility.integrationTarget)
          return current.get(key)?.queuedAt === responsibility.queuedAt
            ? new Map([...current].filter(([candidate]) => candidate !== key))
            : current
        })
    )
    return {
      acquire,
      release,
      snapshot: Ref.get(leases).pipe(
        Effect.flatMap((current) =>
          Ref.get(active).pipe(
            Effect.map((activePositions) => ({
              activeResponsibilityPositions: activePositions,
              heldResponsibilityPositions: new Set([...current.values()].map(({ queuedAt }) => queuedAt))
            }))
          )
        )
      ),
      withPermit: (responsibility, effect) =>
        Ref.get(leases).pipe(
          Effect.flatMap((current) => {
            const lease = current.get(targetKey(responsibility.integrationTarget))
            return lease?.queuedAt === responsibility.queuedAt
              ? lease.permit.withPermit(
                  Ref.update(active, (currentActive) => new Set(currentActive).add(responsibility.queuedAt)).pipe(
                    Effect.andThen(effect),
                    Effect.ensuring(
                      Ref.update(
                        active,
                        (currentActive) =>
                          new Set([...currentActive].filter((position) => position !== responsibility.queuedAt))
                      )
                    )
                  )
                )
              : Effect.die("integration target permit requires its exact held responsibility")
          })
        )
    }
  }
)
