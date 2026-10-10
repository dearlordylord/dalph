/* eslint-disable import/no-nodejs-modules -- The production host fixture consumes the exact built entry. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { serveRunningHost } from "./running-host-http.js"
import { callRunningHost } from "./running-host-client.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))

it.live(
  "the public owner read names a NoRun acquisition owner during Exit without admitting another action",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true, {}, undefined, true)
        const closing = yield* Deferred.make<void>()
        const permit = yield* Deferred.make<void>()
        const graph = {
          ...fixture.graph,
          makeApplicationExit: () =>
            fixture.graph
              .makeApplicationExit()
              .pipe(
                Effect.tap((shell) =>
                  shell.registerProcessLocalDrain({
                    owner: { name: "HostAcquisition", subject: { _tag: "NoRun" } },
                    closeProcessLocalResources: Deferred.succeed(closing, undefined).pipe(
                      Effect.andThen(Deferred.await(permit))
                    )
                  })
                )
              )
        }
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* serveRunningHost(address, observation)
                yield* Effect.addFinalizer(() => Deferred.succeed(permit, undefined))
                const read = callRunningHost(address, observation.selection.runId, { _tag: "ReadExitOwners" })
                const before = yield* read
                expect(before.result._tag).toBe("Success")
                if (before.result._tag !== "Success" || before.result.value._tag !== "ExitOwners")
                  return yield* Effect.die("missing owners")
                const owner = before.result.value.snapshot.owners.find(({ name }) => name === "HostAcquisition")
                expect(owner).toMatchObject({
                  subject: { _tag: "NoRun" },
                  evidence: "DrainRegistered",
                  missingEvidence: "LocalCloseAcknowledgement"
                })
                const request = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
                yield* Deferred.await(closing)
                const during = yield* read
                expect(during.result._tag).toBe("Success")
                if (during.result._tag !== "Success" || during.result.value._tag !== "ExitOwners")
                  return yield* Effect.die("closing owner read refused")
                expect(during.result.value.snapshot.cutoffClosed).toBe(true)
                expect(
                  during.result.value.snapshot.owners.find(({ name }) => name === "HostAcquisition")
                ).toMatchObject({ ownerId: owner?.ownerId, evidence: "DrainPending" })
                yield* Deferred.succeed(permit, undefined)
                const result = yield* Fiber.join(request)
                expect(result._tag).toBe("Succeeded")
                expect(result.owners?.owners.find(({ name }) => name === "HostAcquisition")).toMatchObject({
                  ownerId: owner?.ownerId,
                  evidence: "DrainSucceeded"
                })
                expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
