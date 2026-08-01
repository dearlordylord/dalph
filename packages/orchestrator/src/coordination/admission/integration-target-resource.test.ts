import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  IntegrationTargetResourceUnavailable,
  makeIntegrationTargetResourceController
} from "./integration-target-resource.js"

const target = (repository: string) =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

it.effect("serializes one exact target while allowing another target and releases only its owner", () =>
  Effect.gen(function* () {
    const controller = yield* makeIntegrationTargetResourceController()
    const a = { integrationTarget: target("/a.git"), queuedAt: JournalPosition.make(1) }
    const b = { integrationTarget: target("/a.git"), queuedAt: JournalPosition.make(2) }
    const c = { integrationTarget: target("/c.git"), queuedAt: JournalPosition.make(3) }

    yield* controller.acquire(a)
    yield* controller.acquire(a)
    yield* controller.acquire(c)
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
    expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set([b.queuedAt, c.queuedAt]))
  })
)
