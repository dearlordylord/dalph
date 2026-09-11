import { Effect, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import { IntegrationTarget, type RunId } from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  integrationResponsibilityIdentity,
  integrationResponsibilityIdentityKey,
  IntegrationResponsibilityIdentity,
  type StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/responsibility.js"

export interface IntegrationTargetResourceResponsibility {
  readonly integrationTarget: IntegrationTarget
  readonly plannedAttempt: { readonly runId: RunId }
  readonly queuedAt: JournalPosition
}

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

/** One exact integration responsibility was already bound to another process-local target. */
export class IntegrationResponsibilityTargetMismatch extends Schema.TaggedError<IntegrationResponsibilityTargetMismatch>()(
  "IntegrationResponsibilityTargetMismatch",
  { acquiredTarget: IntegrationTarget, identity: IntegrationResponsibilityIdentity, requestedTarget: IntegrationTarget }
) {}

interface IntegrationTargetResourceLease {
  readonly identity: IntegrationResponsibilityIdentity
  readonly permit: Semaphore.Semaphore
  readonly target: IntegrationTarget
}

interface IntegrationTargetResourceLeases {
  readonly byTarget: ReadonlyMap<string, IntegrationTargetResourceLease>
  readonly targetByResponsibility: ReadonlyMap<string, string>
}

interface IntegrationTargetResourceOwnership {
  readonly identity: IntegrationResponsibilityIdentity
  readonly targetKey: string
}

type IntegrationTargetResourceAcquisitionConflict =
  | { readonly _tag: "IdentityTargetMismatch"; readonly acquiredTarget: IntegrationTarget }
  | { readonly _tag: "InvalidBinding" }
  | { readonly _tag: "TargetUnavailable"; readonly lease: IntegrationTargetResourceLease }

export interface IntegrationTargetResourceController {
  readonly acquire: (
    responsibility: IntegrationTargetResourceResponsibility
  ) => Effect.Effect<void, IntegrationTargetResourceUnavailable | IntegrationResponsibilityTargetMismatch>
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

export const integrationTargetResourceSnapshotIncludes = (
  identities: ReadonlyArray<IntegrationResponsibilityIdentity>,
  responsibility: IntegrationTargetResourceResponsibility
): boolean => {
  const key = integrationResponsibilityIdentityKey(integrationResponsibilityIdentity(responsibility))
  return identities.some((identity) => integrationResponsibilityIdentityKey(identity) === key)
}

const emptyLeases = (): IntegrationTargetResourceLeases => ({ byTarget: new Map(), targetByResponsibility: new Map() })

/** Creates one process-local owner; restart intentionally creates an empty owner. */
export const makeIntegrationTargetResourceController = Effect.fn("IntegrationTargetResourceController.make")(
  function* (): Effect.fn.Return<IntegrationTargetResourceController> {
    const leases = yield* Ref.make<IntegrationTargetResourceLeases>(emptyLeases())
    const accepted = yield* Ref.make<ReadonlyMap<string, IntegrationTargetResourceOwnership>>(new Map())
    const active = yield* Ref.make<ReadonlyMap<string, IntegrationTargetResourceOwnership>>(new Map())
    const changeRevision = yield* SubscriptionRef.make(0)
    const publishChange = SubscriptionRef.update(changeRevision, (current) => current + 1)
    const snapshot = Effect.all({ accepted: Ref.get(accepted), active: Ref.get(active), leases: Ref.get(leases) }).pipe(
      Effect.map(({ accepted, active, leases }) => {
        const activeResponsibilities = [...active].flatMap(([key, ownership]) =>
          accepted.get(key)?.targetKey === ownership.targetKey ? [ownership.identity] : []
        )
        const heldResponsibilities = [...leases.byTarget].flatMap(([key, { identity }]) =>
          accepted.get(integrationResponsibilityIdentityKey(identity))?.targetKey === key ? [identity] : []
        )
        return { activeResponsibilities, heldResponsibilities }
      })
    )
    const acquire = Effect.fn("IntegrationTargetResourceController.acquire")(function* (
      responsibility: IntegrationTargetResourceResponsibility
    ) {
      const key = targetKey(responsibility.integrationTarget)
      const identity = integrationResponsibilityIdentity(responsibility)
      const identityKey = integrationResponsibilityIdentityKey(identity)
      const permit = yield* Semaphore.make(1)
      const conflict = yield* Ref.modify(
        leases,
        (
          current
        ): readonly [IntegrationTargetResourceAcquisitionConflict | undefined, IntegrationTargetResourceLeases] => {
          const boundTargetKey = current.targetByResponsibility.get(identityKey)
          if (boundTargetKey !== undefined && boundTargetKey !== key) {
            const boundLease = current.byTarget.get(boundTargetKey)
            return [
              boundLease === undefined
                ? { _tag: "InvalidBinding" as const }
                : { _tag: "IdentityTargetMismatch" as const, acquiredTarget: boundLease.target },
              current
            ] as const
          }
          const existing = current.byTarget.get(key)
          if (existing !== undefined && integrationResponsibilityIdentityKey(existing.identity) === identityKey) {
            return [undefined, current] as const
          }
          if (existing !== undefined) return [{ _tag: "TargetUnavailable" as const, lease: existing }, current] as const
          return [
            undefined,
            {
              byTarget: new Map(current.byTarget).set(key, {
                permit,
                identity,
                target: responsibility.integrationTarget
              }),
              targetByResponsibility: new Map(current.targetByResponsibility).set(identityKey, key)
            }
          ] as const
        }
      )
      if (conflict?._tag === "InvalidBinding") {
        return yield* Effect.die("integration responsibility target binding was invalid")
      }
      if (conflict?._tag === "IdentityTargetMismatch") {
        return yield* new IntegrationResponsibilityTargetMismatch({
          acquiredTarget: conflict.acquiredTarget,
          identity,
          requestedTarget: responsibility.integrationTarget
        })
      }
      if (conflict?._tag === "TargetUnavailable") {
        return yield* new IntegrationTargetResourceUnavailable({
          heldBy: conflict.lease.identity,
          requestedBy: identity,
          target: responsibility.integrationTarget
        })
      }
    })
    const release = Effect.fn("IntegrationTargetResourceController.release")(function* (
      responsibility: IntegrationTargetResourceResponsibility
    ) {
      const identity = integrationResponsibilityIdentity(responsibility)
      const identityKey = integrationResponsibilityIdentityKey(identity)
      const released = yield* Ref.modify(leases, (current) => {
        const key = targetKey(responsibility.integrationTarget)
        const currentIdentity = current.byTarget.get(key)?.identity
        if (
          current.targetByResponsibility.get(identityKey) !== key ||
          currentIdentity === undefined ||
          integrationResponsibilityIdentityKey(currentIdentity) !== identityKey
        ) {
          return [false, current] as const
        }
        return [
          true,
          {
            byTarget: new Map([...current.byTarget].filter(([candidate]) => candidate !== key)),
            targetByResponsibility: new Map(
              [...current.targetByResponsibility].filter(([candidate]) => candidate !== identityKey)
            )
          }
        ] as const
      })
      if (released) {
        yield* Ref.update(accepted, (current) => new Map([...current].filter(([key]) => key !== identityKey)))
        yield* publishChange
      }
    })
    const publishAcceptedOwnership = Effect.fn("IntegrationTargetResourceController.publishAcceptedOwnership")(
      function* (responsibility: IntegrationTargetResourceResponsibility) {
        const current = yield* Ref.get(leases)
        const target = targetKey(responsibility.integrationTarget)
        const lease = current.byTarget.get(target)
        const identity = integrationResponsibilityIdentity(responsibility)
        const identityKey = integrationResponsibilityIdentityKey(identity)
        if (
          current.targetByResponsibility.get(identityKey) !== target ||
          lease === undefined ||
          integrationResponsibilityIdentityKey(lease.identity) !== identityKey
        ) {
          return yield* Effect.die("accepted integration ownership requires its exact acquired responsibility")
        }
        yield* Ref.update(accepted, (current) => new Map(current).set(identityKey, { identity, targetKey: target }))
        yield* publishChange
      }
    )
    return {
      acquire,
      changes: SubscriptionRef.changes(changeRevision).pipe(Stream.mapEffect(() => snapshot)),
      publishAcceptedOwnership,
      isActive: (responsibility) =>
        Effect.all({ accepted: Ref.get(accepted), active: Ref.get(active), leases: Ref.get(leases) }).pipe(
          Effect.map(({ accepted, active, leases }) => {
            const identityKey = integrationResponsibilityIdentityKey(integrationResponsibilityIdentity(responsibility))
            const target = targetKey(responsibility.integrationTarget)
            return (
              accepted.get(identityKey)?.targetKey === target &&
              active.get(identityKey)?.targetKey === target &&
              leases.targetByResponsibility.get(identityKey) === target
            )
          })
        ),
      isHeld: (responsibility) =>
        Effect.all({ accepted: Ref.get(accepted), leases: Ref.get(leases) }).pipe(
          Effect.map(({ accepted, leases }) => {
            const identity = integrationResponsibilityIdentity(responsibility)
            const identityKey = integrationResponsibilityIdentityKey(identity)
            const target = targetKey(responsibility.integrationTarget)
            const lease = leases.byTarget.get(target)
            return (
              accepted.get(identityKey)?.targetKey === target &&
              leases.targetByResponsibility.get(identityKey) === target &&
              lease !== undefined &&
              integrationResponsibilityIdentityKey(lease.identity) === identityKey
            )
          })
        ),
      release,
      releaseAll: Ref.set(leases, emptyLeases()).pipe(
        Effect.andThen(Ref.set(accepted, new Map())),
        Effect.andThen(Ref.set(active, new Map())),
        Effect.andThen(publishChange)
      ),
      snapshot,
      withPermit: (responsibility, effect) =>
        Ref.get(leases).pipe(
          Effect.flatMap((current) => {
            const target = targetKey(responsibility.integrationTarget)
            const lease = current.byTarget.get(target)
            const identity = integrationResponsibilityIdentity(responsibility)
            const identityKey = integrationResponsibilityIdentityKey(identity)
            return lease !== undefined &&
              current.targetByResponsibility.get(identityKey) === target &&
              integrationResponsibilityIdentityKey(lease.identity) === identityKey
              ? lease.permit.withPermit(
                  Ref.update(active, (currentActive) =>
                    new Map(currentActive).set(identityKey, { identity, targetKey: target })
                  ).pipe(
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
