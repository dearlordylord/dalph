/* eslint-disable no-restricted-globals -- Controlled requests exercise the real browser HTTP boundary. */
import { it } from "@effect/vitest"
import { Effect, Ref, Stream } from "effect"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"
import { type RunningHostInspection } from "./running-host-inspection.js"

it.live(
  "allows only exact same-origin observation routes, refuses browser controls and serves only fixed packaged assets",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const address = yield* availableLocalHostAddress
        const started = yield* Ref.make(0)
        const refreshed = yield* Ref.make(0)
        const commands = yield* Ref.make(0)
        const state: RunningHostInspection = { _tag: "Loading" }
        const owner = {
          current: Effect.succeed(state),
          changes: Stream.never,
          stop: Effect.void,
          refresh: Ref.update(refreshed, (count) => count + 1)
        }
        const host = yield* serveRunningHost(address, {
          ...probe.observation,
          inspection: Ref.update(started, (count) => count + 1).pipe(Effect.as(owner)),
          executeAttachedCommand: () =>
            Ref.update(commands, (count) => count + 1).pipe(Effect.as({ _tag: "WakeSubmitted" as const }))
        })
        expect(yield* Ref.get(started)).toBe(0)
        yield* Effect.promise(() => fetch(`${address}/dalph/v1/descriptor`))
        expect(yield* Ref.get(started)).toBe(0)
        const post = (operation: string, origin: string) =>
          Effect.promise(async () => {
            const response = await fetch(`${address}/dalph/v1/request`, {
              method: "POST",
              headers: { "content-type": "application/json", origin },
              body: JSON.stringify({
                protocolVersion: 1,
                hostInstanceId: host.descriptor.hostInstanceId,
                runId: probe.runId,
                requestId: "page-request",
                operation: { _tag: operation }
              })
            })
            return response.json()
          })
        expect(yield* post("ReadSnapshot", address)).toMatchObject({
          result: { _tag: "Success", value: { _tag: "NotReady", runId: probe.runId } }
        })
        expect(yield* Ref.get(started)).toBe(0)
        expect(yield* Ref.get(refreshed)).toBe(0)
        expect(yield* post("ReadInspectionSnapshot", address)).toMatchObject({
          result: { _tag: "Success", value: { _tag: "InspectionSnapshot", inspection: { _tag: "Loading" } } }
        })
        expect(yield* post("RefreshInspection", address)).toMatchObject({ result: { _tag: "Success" } })
        expect(yield* Ref.get(refreshed)).toBe(1)
        expect(yield* Ref.get(started)).toBe(1)
        expect(yield* post("StartWork", address)).toMatchObject({
          result: { _tag: "Failure", error: { _tag: "InvalidRequest", code: "BrowserControlForbidden" } }
        })
        expect(yield* post("ReadInspectionSnapshot", "http://foreign.example")).toMatchObject({
          result: { _tag: "Failure", error: { _tag: "InvalidRequest", code: "LocalOriginRequired" } }
        })
        expect(yield* Ref.get(commands)).toBe(0)
        expect(yield* Ref.get(probe.reads)).toBe(0)
        yield* Effect.promise(async () => {
          const page = await fetch(address, { headers: { origin: address } })
          expect(page.headers.get("content-type")).toContain("text/html")
          expect(await page.text()).toContain("<dalph-delivery-graph")
          for (const [route, type] of [
            ["graph.js", "text/javascript"],
            ["graph.css", "text/css"]
          ]) {
            const asset = await fetch(`${address}/dalph/page/${route}`)
            expect(asset.status).toBe(200)
            expect(asset.headers.get("content-type")).toContain(type)
          }
          const outside = await fetch(`${address}/dalph/page/..%2f..%2fREADME.md`)
          expect(outside.status).toBe(400)
          expect(await outside.json()).toMatchObject({
            result: { _tag: "Failure", error: { code: "RouteUnsupported" } }
          })
        })
      })
    )
)
