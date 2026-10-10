import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { OperationId } from "../../workflow/identity.js"
import { makeProductionHostApplicationExitShell, ApplicationExitDrainFailure } from "./application-shell.js"
import { ApplicationExitDiagnostic, publicApplicationExitResult } from "./lifecycle-decision.js"

const runId = RunId.make("owner-run")

it.effect("names the exact produced boundary and missing Journal acknowledgement without exposing its result", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const owner = yield* shell.admission.acquireForwardOwner("InterruptibleBoundary", { _tag: "Run", runId })
      if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
      const produced = yield* Deferred.make<void>()
      const acknowledge = yield* Deferred.make<void>()
      const operationId = OperationId.make("exact-operation")
      const work = yield* owner
        .run(
          { _tag: "AuthorityRequest", family: "TaskTracker", operationId },
          Effect.succeed({ token: "private-provider-token", prompt: "private-prompt" }),
          () => Deferred.succeed(produced, undefined).pipe(Effect.andThen(Deferred.await(acknowledge)))
        )
        .pipe(Effect.ensuring(owner.release), Effect.forkChild)
      yield* Deferred.await(produced)
      const before = yield* shell.readOwners
      expect(before.owners).toEqual([
        {
          ownerId: 0,
          family: "ForwardOwner",
          kind: "InterruptibleBoundary",
          name: "ForwardProgress",
          subject: { _tag: "Run", runId },
          evidence: "BoundaryResultProduced",
          boundary: { family: "TaskTracker", operationIds: [operationId], baseline: null },
          missingEvidence: "JournalAcknowledgement",
          nextAction: "AwaitJournalAcknowledgement"
        }
      ])
      const first = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* shell.awaitExitRequested
      const joined = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* TestClock.adjust("5 seconds")
      const result = yield* Fiber.join(first)
      expect(result._tag).toBe("TimedOut")
      expect(yield* Fiber.join(joined)).toEqual(result)
      expect(result.owners?.owners).toEqual(before.owners)
      expect(JSON.stringify(publicApplicationExitResult(result))).not.toContain("private-")
      expect((yield* shell.readOwners).owners).toHaveLength(1)
      yield* Deferred.succeed(acknowledge, undefined)
      yield* Fiber.await(work)
      expect((yield* shell.readOwners).owners).toEqual([])
    })
  )
)

it.effect(
  "derives provider NoRun and local-action ownership from existing registrations and removes a retired owner",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* makeProductionHostApplicationExitShell()
        const scope = yield* Scope.make()
        yield* shell
          .registerProcessLocalDrain({
            owner: { name: "CodexProvider", subject: { _tag: "NoRun" } },
            closeProcessLocalResources: Effect.void
          })
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* shell.registerProcessLocalDrain({
          owner: { name: "ArchiveMaintenance", subject: { _tag: "Run", runId } },
          closeProcessLocalResources: Effect.void
        })
        const before = yield* shell.readOwners
        expect(before.cutoffClosed).toBe(false)
        expect(
          before.owners.map(({ evidence, name, ownerId, subject }) => ({ ownerId, name, subject, evidence }))
        ).toEqual([
          { ownerId: 0, name: "CodexProvider", subject: { _tag: "NoRun" }, evidence: "DrainRegistered" },
          { ownerId: 1, name: "ArchiveMaintenance", subject: { _tag: "Run", runId }, evidence: "DrainRegistered" }
        ])
        yield* Scope.close(scope, Exit.void)
        expect((yield* shell.readOwners).owners.map(({ ownerId }) => ownerId)).toEqual([1])
        const result = yield* shell.requestBoundary.requestExit
        expect(result._tag).toBe("Succeeded")
        expect(result.owners?.owners[0]).toMatchObject({
          ownerId: 1,
          evidence: "DrainSucceeded",
          missingEvidence: "None"
        })
      })
    )
)

it.effect(
  "retains unresolved executor correlation and redacts a sibling provider failure at the original fifth second",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* makeProductionHostApplicationExitShell()
        const registered = yield* Deferred.make<void>()
        yield* shell.registerExecutorDrain({
          owner: { name: "ExecutorWork", subject: { _tag: "Run", runId } },
          suspendExecutingExecutorWork: Deferred.succeed(registered, undefined).pipe(Effect.andThen(Effect.never))
        })
        yield* shell.registerProcessLocalDrain({
          owner: { name: "CodexProvider", subject: { _tag: "NoRun" } },
          closeProcessLocalResources: new ApplicationExitDrainFailure({
            diagnostics: [ApplicationExitDiagnostic.make("secret credential and provider prompt")]
          })
        })
        const request = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* Deferred.await(registered)
        const during = yield* shell.readOwners
        expect(during.owners[0]).toMatchObject({
          family: "ExecutorDrain",
          ownerId: 0,
          subject: { _tag: "Run", runId },
          evidence: "DrainPending",
          missingEvidence: "CorrelatedExecutorSettlement"
        })
        yield* TestClock.adjust("5 seconds")
        const result = yield* Fiber.join(request)
        expect(result._tag).toBe("TimedOut")
        expect(result.owners?.owners[1]).toMatchObject({
          name: "CodexProvider",
          evidence: "DrainFailed",
          nextAction: "InspectDrainFailure"
        })
        expect(JSON.stringify(publicApplicationExitResult(result))).not.toContain("secret")
      })
    )
)
