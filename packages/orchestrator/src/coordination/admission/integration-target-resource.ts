import { Effect, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import { IntegrationTarget, RunId } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"

export interface IntegrationTargetResourceResponsibility {
  readonly integrationTarget: IntegrationTarget
  readonly plannedAttempt: { readonly runId: RunId }
  readonly queuedAt: JournalPosition
}

/**
 * Exact Run-local journal position that identifies one integration responsibility across concurrent Runs.
 * The integration target is the separately serialized resource, not part of this identity. The current Quint
 * delivery model is intentionally single-Run and uses globally distinct result ids, so this cross-Run process
 * collision is covered by executable controller and recovery/frontier tests rather than a model transition.
 */
export const IntegrationResponsibilityIdentity = Schema.Struct({ queuedAt: JournalPosition, runId: RunId }).pipe(
  Schema.brand("IntegrationResponsibilityIdentity")
)
export type IntegrationResponsibilityIdentity = typeof IntegrationResponsibilityIdentity.Type

export interface IntegrationTargetResourceSnapshot {
  readonly activeResponsibilities: ReadonlyArray<IntegrationResponsibilityIdentity>
  readonly heldResponsibilities: ReadonlyArray<IntegrationResponsibilityIdentity>
}

/** A different responsibility already holds the exact process-local integration target. */
export class IntegrationTargetResourceUnavailable extends Schema.TaggedError<IntegrationTargetResourceUnavailable>()(
  "IntegrationTargetResourceUnavailable",
  {
    heldBy: IntegrationResponsibilityIdentity,
    requestedBy: IntegrationResponsibilityIdentity,
    target: IntegrationTarget
  }
) {}

interface IntegrationTargetResourceLease {
  readonly identity: IntegrationResponsibilityIdentity
  readonly permit: Semaphore.Semaphore
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
  /** Observes whether this exact Run-local responsibility owns its target. */
  readonly isHeld: (responsibility: IntegrationTargetResourceResponsibility) => Effect.Effect<boolean>
  /** Observes whether this exact Run-local responsibility is using its target permit. */
  readonly isActive: (responsibility: IntegrationTargetResourceResponsibility) => Effect.Effect<boolean>
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
export const integrationResponsibilityIdentity = (
  responsibility: IntegrationTargetResourceResponsibility
): IntegrationResponsibilityIdentity =>
  IntegrationResponsibilityIdentity.make({
    queuedAt: responsibility.queuedAt,
    runId: responsibility.plannedAttempt.runId
  })
const responsibilityKey = (identity: IntegrationResponsibilityIdentity): string =>
  JSON.stringify([identity.runId, identity.queuedAt])

export const integrationTargetResourceSnapshotIncludes = (
  identities: ReadonlyArray<IntegrationResponsibilityIdentity>,
  responsibility: IntegrationTargetResourceResponsibility
): boolean => {
  const key = responsibilityKey(integrationResponsibilityIdentity(responsibility))
  return identities.some((identity) => responsibilityKey(identity) === key)
}

/** Creates one process-local owner; restart intentionally creates an empty owner. */
export const makeIntegrationTargetResourceController = Effect.fn("IntegrationTargetResourceController.make")(
  function* (): Effect.fn.Return<IntegrationTargetResourceController> {
    const leases = yield* Ref.make<ReadonlyMap<string, IntegrationTargetResourceLease>>(new Map())
    const accepted = yield* Ref.make<ReadonlyMap<string, IntegrationResponsibilityIdentity>>(new Map())
    const active = yield* Ref.make<ReadonlyMap<string, IntegrationResponsibilityIdentity>>(new Map())
    const changeRevision = yield* SubscriptionRef.make(0)
    const publishChange = SubscriptionRef.update(changeRevision, (current) => current + 1)
    const snapshot = Effect.all({ accepted: Ref.get(accepted), active: Ref.get(active), leases: Ref.get(leases) }).pipe(
      Effect.map(({ accepted, active, leases }) => {
        const activeResponsibilities = [...active].flatMap(([key, identity]) => (accepted.has(key) ? [identity] : []))
        const heldResponsibilities = [...leases.values()].flatMap(({ identity }) =>
          accepted.has(responsibilityKey(identity)) ? [identity] : []
        )
        return { activeResponsibilities, heldResponsibilities }
      })
    )
    const acquire = Effect.fn("IntegrationTargetResourceController.acquire")(function* (
      responsibility: IntegrationTargetResourceResponsibility
    ) {
      const key = targetKey(responsibility.integrationTarget)
      const identity = integrationResponsibilityIdentity(responsibility)
      const permit = yield* Semaphore.make(1)
      const conflict = yield* Ref.modify(leases, (current) => {
        const existing = current.get(key)
        if (existing !== undefined && responsibilityKey(existing.identity) === responsibilityKey(identity)) {
          return [undefined, current] as const
        }
        if (existing !== undefined) return [existing, current] as const
        return [
          undefined,
          new Map(current).set(key, { permit, identity, target: responsibility.integrationTarget })
        ] as const
      })
      if (conflict !== undefined) {
        return yield* new IntegrationTargetResourceUnavailable({
          heldBy: conflict.identity,
          requestedBy: identity,
          target: responsibility.integrationTarget
        })
      }
    })
    const release = Effect.fn("IntegrationTargetResourceController.release")(function* (
      responsibility: IntegrationTargetResourceResponsibility
    ) {
      const identity = integrationResponsibilityIdentity(responsibility)
      const identityKey = responsibilityKey(identity)
      yield* Ref.update(leases, (current) => {
        const key = targetKey(responsibility.integrationTarget)
        const currentIdentity = current.get(key)?.identity
        return currentIdentity !== undefined && responsibilityKey(currentIdentity) === identityKey
          ? new Map([...current].filter(([candidate]) => candidate !== key))
          : current
      })
      yield* Ref.update(accepted, (current) => new Map([...current].filter(([key]) => key !== identityKey)))
      yield* publishChange
    })
    const publishAcceptedOwnership = Effect.fn("IntegrationTargetResourceController.publishAcceptedOwnership")(
      function* (responsibility: IntegrationTargetResourceResponsibility) {
        const lease = (yield* Ref.get(leases)).get(targetKey(responsibility.integrationTarget))
        const identity = integrationResponsibilityIdentity(responsibility)
        const identityKey = responsibilityKey(identity)
        if (lease === undefined || responsibilityKey(lease.identity) !== identityKey) {
          return yield* Effect.die("accepted integration ownership requires its exact acquired responsibility")
        }
        yield* Ref.update(accepted, (current) => new Map(current).set(identityKey, identity))
        yield* publishChange
      }
    )
    return {
      acquire,
      changes: SubscriptionRef.changes(changeRevision).pipe(Stream.mapEffect(() => snapshot)),
      publishAcceptedOwnership,
      isActive: (responsibility) =>
        Effect.all({ accepted: Ref.get(accepted), active: Ref.get(active) }).pipe(
          Effect.map(({ accepted, active }) => {
            const key = responsibilityKey(integrationResponsibilityIdentity(responsibility))
            return accepted.has(key) && active.has(key)
          })
        ),
      isHeld: (responsibility) =>
        Effect.all({ accepted: Ref.get(accepted), leases: Ref.get(leases) }).pipe(
          Effect.map(({ accepted, leases }) => {
            const identity = integrationResponsibilityIdentity(responsibility)
            const identityKey = responsibilityKey(identity)
            const lease = leases.get(targetKey(responsibility.integrationTarget))
            return accepted.has(identityKey) && lease !== undefined && responsibilityKey(lease.identity) === identityKey
          })
        ),
      release,
      releaseAll: Ref.set(leases, new Map()).pipe(
        Effect.andThen(Ref.set(accepted, new Map())),
        Effect.andThen(Ref.set(active, new Map())),
        Effect.andThen(publishChange)
      ),
      snapshot,
      withPermit: (responsibility, effect) =>
        Ref.get(leases).pipe(
          Effect.flatMap((current) => {
            const lease = current.get(targetKey(responsibility.integrationTarget))
            const identity = integrationResponsibilityIdentity(responsibility)
            const identityKey = responsibilityKey(identity)
            return lease !== undefined && responsibilityKey(lease.identity) === identityKey
              ? lease.permit.withPermit(
                  Ref.update(active, (currentActive) => new Map(currentActive).set(identityKey, identity)).pipe(
                    Effect.andThen(publishChange),
                    Effect.andThen(effect),
                    Effect.ensuring(
                      Ref.update(
                        active,
                        (currentActive) => new Map([...currentActive].filter(([key]) => key !== identityKey))
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
