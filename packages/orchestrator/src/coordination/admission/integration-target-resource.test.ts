import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { expect } from "vitest"
import { GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef, RunId } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  acquireStartedIntegrationTarget,
  IntegrationResponsibilityTargetMismatch,
  IntegrationTargetResourceUnavailable,
  makeIntegrationTargetResourceController,
  releaseStartedIntegrationTarget
} from "./integration-target-resource.js"
import { integrationResponsibilityIdentity } from "../../workflow/protocols/integration-admission/responsibility.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"

const target = (repository: string) =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

const resourceResponsibility = (repository: string, queuedAt: number, runId: string) => ({
  integrationTarget: target(repository),
  plannedAttempt: { runId: RunId.make(runId) },
  queuedAt: JournalPosition.make(queuedAt)
})

it.effect("publishes only each exact accepted target while serializing and releasing its owner", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const a = resourceResponsibility("/a.git", 1, "run-a")
    const b = resourceResponsibility("/a.git", 2, "run-b")
    const c = resourceResponsibility("/c.git", 3, "run-c")

    yield* controller.acquire(a)
    yield* controller.acquire(a)
    yield* controller.acquire(c)
    yield* controller.publishAcceptedOwnership(c)
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([
      { queuedAt: c.queuedAt, runId: c.plannedAttempt.runId }
    ])
    expect((yield* Effect.exit(controller.publishAcceptedOwnership(b)))._tag).toBe("Failure")
    yield* controller.publishAcceptedOwnership(a)
    expect((yield* Effect.exit(controller.withPermit(b, Effect.void)))._tag).toBe("Failure")
    expect(yield* Effect.flip(controller.acquire(b))).toEqual(
      new IntegrationTargetResourceUnavailable({
        heldBy: integrationResponsibilityIdentity(a),
        requestedBy: integrationResponsibilityIdentity(b),
        target: b.integrationTarget
      })
    )
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([
      { queuedAt: a.queuedAt, runId: a.plannedAttempt.runId },
      { queuedAt: c.queuedAt, runId: c.plannedAttempt.runId }
    ])

    yield* controller.release(b)
    expect(yield* controller.isHeld(a)).toBe(true)
    yield* controller.release(a)
    yield* controller.acquire(b)
    yield* controller.publishAcceptedOwnership(b)
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([
      { queuedAt: c.queuedAt, runId: c.plannedAttempt.runId },
      { queuedAt: b.queuedAt, runId: b.plannedAttempt.runId }
    ])
  })
)

it.effect("publishes exact active ownership only while its target permit is running", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const responsibility = resourceResponsibility("/active.git", 4, "active-run")

    yield* controller.acquire(responsibility)
    yield* controller.publishAcceptedOwnership(responsibility)

    expect(yield* controller.changes.pipe(Stream.take(1), Stream.runHead)).toEqual(
      expect.objectContaining({ _tag: "Some" })
    )
    const during = yield* controller.withPermit(responsibility, controller.snapshot)
    expect(during.activeResponsibilities).toEqual([
      { queuedAt: responsibility.queuedAt, runId: responsibility.plannedAttempt.runId }
    ])
    expect((yield* controller.snapshot).activeResponsibilities).toEqual([])

    yield* controller.releaseAll
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([])
  })
)

it.effect("binds one exact responsibility to only its originally acquired target", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const acquired = resourceResponsibility("/bound.git", 8, "bound-run")
    const wrongTarget = { ...acquired, integrationTarget: target("/other.git") }

    yield* controller.acquire(acquired)
    yield* controller.acquire(acquired)
    yield* controller.publishAcceptedOwnership(acquired)

    expect(yield* Effect.flip(controller.acquire(wrongTarget))).toEqual(
      new IntegrationResponsibilityTargetMismatch({
        acquiredTarget: acquired.integrationTarget,
        identity: integrationResponsibilityIdentity(acquired),
        requestedTarget: wrongTarget.integrationTarget
      })
    )
    expect(yield* controller.isHeld(acquired)).toBe(true)
    expect(yield* controller.isHeld(wrongTarget)).toBe(false)
  })
)

it.effect("does not release accepted ownership through the right identity and wrong target", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const acquired = resourceResponsibility("/release-bound.git", 9, "release-bound-run")
    const wrongTarget = { ...acquired, integrationTarget: target("/wrong-release.git") }
    const enteredPermit = yield* Deferred.make<void>()
    const releasePermit = yield* Deferred.make<void>()

    yield* controller.acquire(acquired)
    yield* controller.publishAcceptedOwnership(acquired)
    const permitFiber = yield* controller
      .withPermit(
        acquired,
        Deferred.succeed(enteredPermit, undefined).pipe(Effect.andThen(Deferred.await(releasePermit)))
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(enteredPermit)
    expect(yield* controller.isActive(acquired)).toBe(true)

    yield* controller.release(wrongTarget)

    expect(yield* controller.isHeld(acquired)).toBe(true)
    expect(yield* controller.isActive(acquired)).toBe(true)
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([integrationResponsibilityIdentity(acquired)])
    expect((yield* controller.snapshot).activeResponsibilities).toEqual([integrationResponsibilityIdentity(acquired)])

    yield* Deferred.succeed(releasePermit, undefined)
    yield* Fiber.join(permitFiber)
    expect(yield* controller.isActive(acquired)).toBe(false)
    expect(yield* controller.isHeld(acquired)).toBe(true)
  })
)

it.effect("executes accepted frontier acquire and release transitions through the resource owner", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const session = integrationFinalityFixture.qualifiedCandidate.run.session
    const responsibility = StartedIntegrationResponsibility.make({
      acceptedResult: session.acceptedResult,
      integrationTarget: session.integrationTarget,
      plannedAttempt: session.plannedAttempt,
      queuedAt: session.queuedAt,
      startedAt: session.startedAt
    })

    yield* acquireStartedIntegrationTarget(controller, { _tag: "AcquireStartedIntegrationTarget", responsibility })
    expect(yield* controller.isHeld(responsibility)).toBe(true)

    yield* releaseStartedIntegrationTarget(controller, { _tag: "ReleaseStartedIntegrationTarget", responsibility })
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([])
  })
)

it.effect("keeps same-position responsibilities distinct across Runs and prevents cross-Run release", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const r1 = resourceResponsibility("/one.git", 17, "run-one")
    const r2 = resourceResponsibility("/two.git", 17, "run-two")
    const sameTargetR2 = { ...r2, integrationTarget: r1.integrationTarget }
    const active = yield* Deferred.make<void>()
    const releaseActive = yield* Deferred.make<void>()

    yield* controller.acquire(r1)
    yield* controller.acquire(r1)
    yield* controller.publishAcceptedOwnership(r1)
    const fiber = yield* controller
      .withPermit(r1, Deferred.succeed(active, undefined).pipe(Effect.andThen(Deferred.await(releaseActive))))
      .pipe(Effect.forkChild)
    yield* Deferred.await(active)

    expect(yield* Effect.flip(controller.acquire(sameTargetR2))).toEqual(
      new IntegrationTargetResourceUnavailable({
        heldBy: integrationResponsibilityIdentity(r1),
        requestedBy: integrationResponsibilityIdentity(sameTargetR2),
        target: r1.integrationTarget
      })
    )
    yield* controller.release(sameTargetR2)
    expect(yield* controller.isHeld(r1)).toBe(true)
    expect(yield* controller.isActive(r1)).toBe(true)

    yield* controller.acquire(r2)
    yield* controller.publishAcceptedOwnership(r2)
    expect((yield* controller.snapshot).heldResponsibilities).toEqual([
      { queuedAt: r1.queuedAt, runId: r1.plannedAttempt.runId },
      { queuedAt: r2.queuedAt, runId: r2.plannedAttempt.runId }
    ])
    yield* controller.release(r2)
    expect(yield* controller.isHeld(r1)).toBe(true)
    expect(yield* controller.isActive(r1)).toBe(true)

    yield* Deferred.succeed(releaseActive, undefined)
    yield* Fiber.join(fiber)
  })
)
