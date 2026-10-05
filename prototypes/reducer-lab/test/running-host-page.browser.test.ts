import { it } from "@effect/vitest"
import { projectTrackerSnapshot } from "@dalph/orchestrator"
import { Effect, Exit, Ref, Scope, Stream, SubscriptionRef } from "effect"
import { chromium } from "playwright"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../../packages/dalph/test-support/running-host-read-probe.js"
import { serveRunningHost } from "../../../packages/dalph/src/application/running-host-http.js"
import { InspectionObservedAt, type RunningHostInspection } from "../../../packages/dalph/src/application/running-host-inspection.js"

it.live("renders the common graph widget from actual host observations in two browsers and refuses foreign origins", () =>
  Effect.scoped(Effect.gen(function* () {
    const probe = yield* makeRunningHostReadProbe()
    const address = yield* availableLocalHostAddress
    const normalized = projectTrackerSnapshot({ revision: "browser-graph", rootTaskId: "root", tasks: [
      { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["dependency"] },
      { id: "child", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] },
      { id: "dependency", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
    ] })
    if (normalized._tag !== "Valid") return expect.fail("requires complete graph")
    const value = { graph: normalized.snapshot.toWire(), observedAt: InspectionObservedAt.make(Date.now()) }
    const state = yield* SubscriptionRef.make<RunningHostInspection>({ _tag: "Ready", value })
    const refreshes = yield* Ref.make(0)
    const commands = yield* Ref.make(0)
    const firstHostScope = yield* Scope.fork(yield* Scope.Scope)
    yield* serveRunningHost(address, { ...probe.observation,
      executeAttachedCommand: () => Ref.update(commands, (count) => count + 1).pipe(Effect.andThen(Effect.die("browser controls forbidden"))),
      inspection: Effect.succeed({ current: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state),
        refresh: Ref.update(refreshes, (count) => count + 1), stop: Effect.void }) }).pipe(Effect.provideService(Scope.Scope, firstHostScope))
    const browser = yield* Effect.acquireRelease(Effect.promise(() => chromium.launch()),
      (owned) => Effect.promise(() => owned.close()))
    const pages = yield* Effect.promise(() => Promise.all([browser.newPage(), browser.newPage()]))
    yield* Effect.promise(async () => {
      for (const page of pages) {
        page.setDefaultTimeout(3000)
        page.on("pageerror", (error) => console.error("live-host-pageerror", error.message))
        await page.goto(address)
        await page.locator('#connection[data-state="connected"]').waitFor()
        const widget = page.locator("dalph-delivery-graph")
        await widget.locator("summary").click()
        await widget.locator('button[data-task-id="dependency"]').waitFor()
        await widget.locator('button[data-task-id="dependency"]').click()
        await page.locator("#task").getByText("CompletedSuccessfully", { exact: false }).waitFor()
        expect(await widget.locator('button[data-task-id="child"]').count()).toBeGreaterThan(0)
        expect(await widget.locator('li[data-edge-from="dependency"][data-edge-to="root"]').count()).toBeGreaterThan(0)
        expect(await widget.locator('li[data-edge-from="root"][data-edge-to="child"]').count()).toBeGreaterThan(0)
      }
      await pages[0]?.locator("#refresh").click()
    })
    expect(yield* Ref.get(refreshes)).toBe(1)
    yield* SubscriptionRef.set(state, { _tag: "Stale", value, failedAt: InspectionObservedAt.make(Date.now()), reason: "IncompleteGraph" })
    yield* Effect.promise(async () => {
      for (const page of pages) {
        await page.locator("#freshness").filter({ hasText: "Refresh failed: IncompleteGraph." }).waitFor()
        expect(await page.locator("dalph-delivery-graph").locator('button[data-task-id="dependency"]').count()).toBeGreaterThan(0)
      }
      const foreign = await browser.newPage()
      await foreign.goto("data:text/html,foreign")
      const refused = await foreign.evaluate(async (origin) => {
        try { await fetch(`${origin}/dalph/v1/descriptor`); return false } catch { return true }
      }, address)
      expect(refused).toBe(true)
    })
    yield* Scope.close(firstHostScope, Exit.succeed(undefined))
    const restarted: RunningHostInspection = { _tag: "Unavailable", failedAt: InspectionObservedAt.make(Date.now()), reason: "RestartReadFailed" }
    yield* serveRunningHost(address, { ...probe.observation,
      inspection: Effect.succeed({ current: Effect.succeed(restarted), changes: Stream.never,
        refresh: Effect.void, stop: Effect.void }) })
    yield* Effect.promise(async () => {
      for (const page of pages) {
        await page.locator("#freshness").filter({ hasText: "Graph unavailable: RestartReadFailed." }).waitFor({ timeout: 5000 })
        await page.locator('#connection[data-state="connected"]').waitFor()
        expect(await page.locator("dalph-delivery-graph").locator("button[data-task-id]").count()).toBe(0)
      }
    })
    expect(yield* Ref.get(commands)).toBe(0)
  }))
)
