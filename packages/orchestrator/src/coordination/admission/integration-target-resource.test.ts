import { it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { expect } from "vitest"
import { GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  acquireStartedIntegrationTarget,
  IntegrationTargetResourceUnavailable,
  makeIntegrationTargetResourceController,
  releaseStartedIntegrationTarget
} from "./integration-target-resource.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"

const target = (repository: string) =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

it.effect("publishes only each exact accepted target while serializing and releasing its owner", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const a = { integrationTarget: target("/a.git"), queuedAt: JournalPosition.make(1) }
    const b = { integrationTarget: target("/a.git"), queuedAt: JournalPosition.make(2) }
    const c = { integrationTarget: target("/c.git"), queuedAt: JournalPosition.make(3) }

    yield* controller.acquire(a)
    yield* controller.acquire(a)
    yield* controller.acquire(c)
    yield* controller.publishAcceptedOwnership(c)
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set([c.queuedAt]))
    expect((yield* Effect.exit(controller.publishAcceptedOwnership(b)))._tag).toBe("Failure")
    yield* controller.publishAcceptedOwnership(a)
    expect((yield* Effect.exit(controller.withPermit(b, Effect.void)))._tag).toBe("Failure")
    expect(yield* Effect.flip(controller.acquire(b))).toEqual(
      new IntegrationTargetResourceUnavailable({
        heldBy: a.queuedAt,
        requestedBy: b.queuedAt,
        target: b.integrationTarget
      })
    )
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set([a.queuedAt, c.queuedAt]))

    yield* controller.release(b)
    expect((yield* controller.snapshot).heldResponsibilityPositions).toContain(a.queuedAt)
    yield* controller.release(a)
    yield* controller.acquire(b)
    yield* controller.publishAcceptedOwnership(b)
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set([b.queuedAt, c.queuedAt]))
  })
)

it.effect("publishes exact active ownership only while its target permit is running", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const responsibility = { integrationTarget: target("/active.git"), queuedAt: JournalPosition.make(4) }

    yield* controller.acquire(responsibility)
    yield* controller.publishAcceptedOwnership(responsibility)

    expect(yield* controller.changes.pipe(Stream.take(1), Stream.runHead)).toEqual(
      expect.objectContaining({ _tag: "Some" })
    )
    const during = yield* controller.withPermit(responsibility, controller.snapshot)
    expect(during.activeResponsibilityPositions).toEqual(new Set([responsibility.queuedAt]))
    expect((yield* controller.snapshot).activeResponsibilityPositions).toEqual(new Set())

    yield* controller.releaseAll
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set())
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
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set([responsibility.queuedAt]))

    yield* releaseStartedIntegrationTarget(controller, { _tag: "ReleaseStartedIntegrationTarget", responsibility })
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set())
  })
)
