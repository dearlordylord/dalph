import { it } from "@effect/vitest"
import { currentSignalFromCurrentFirstStream, projectTrackerSnapshot, type DeliveryRuntimeObservationState } from "@dalph/orchestrator"
import { Effect, Exit, Ref, Scope, SubscriptionRef } from "effect"
import { chromium } from "playwright"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../../packages/dalph/test-support/running-host-read-probe.js"
import { runningHostPageObservation } from "../../../packages/dalph/test-support/running-host-page-observation.js"
import { serveRunningHost } from "../../../packages/dalph/src/application/running-host-http.js"

it.live("shows Run graph updates in two browsers without starting inspection or commands", () =>
  Effect.scoped(Effect.gen(function* () {
    const probe = yield* makeRunningHostReadProbe()
    const address = yield* availableLocalHostAddress
    const normalized = projectTrackerSnapshot({ revision: "browser-graph", rootTaskId: "root", tasks: [
      { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["dependency"] },
      { id: "child", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] },
      { id: "dependency", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
    ] })
    if (normalized._tag !== "Valid") return expect.fail("requires complete graph")
    const initial = yield* runningHostPageObservation(probe.runId, normalized.snapshot, { paused: true })
    const state = yield* SubscriptionRef.make<DeliveryRuntimeObservationState>(initial)
    const inspections = yield* Ref.make(0)
    const commands = yield* Ref.make(0)
    const observation = { ...probe.observation,
      current: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state)),
      executeAttachedCommand: () => Ref.update(commands, (count) => count + 1).pipe(Effect.andThen(Effect.die("browser controls forbidden"))),
      inspection: Ref.update(inspections, (count) => count + 1).pipe(Effect.andThen(Effect.die("page must not read GitHub"))) }
    const firstHostScope = yield* Scope.fork(yield* Scope.Scope)
    yield* serveRunningHost(address, observation).pipe(Effect.provideService(Scope.Scope, firstHostScope))
    const browser = yield* Effect.acquireRelease(Effect.promise(() => chromium.launch()),
      (owned) => Effect.promise(() => owned.close()))
    const pages = yield* Effect.promise(() => Promise.all([browser.newPage(), browser.newPage()]))
    yield* Effect.promise(async () => {
      for (const page of pages) {
        page.setDefaultTimeout(3000)
        await page.goto(address)
        await page.locator('#connection[data-state="connected"]').waitFor()
        const widget = page.locator("dalph-delivery-graph")
        await widget.locator("summary").click()
        await widget.locator('button[data-task-id="dependency"]').click()
        await page.locator("#task").getByText("CompletedSuccessfully", { exact: false }).waitFor()
        expect(await widget.locator('button[data-task-id="child"]').count()).toBeGreaterThan(0)
        expect(await widget.locator('li[data-edge-from="dependency"][data-edge-to="root"]').count()).toBeGreaterThan(0)
        expect(await widget.locator('li[data-edge-from="root"][data-edge-to="child"]').count()).toBeGreaterThan(0)
        expect(await page.locator("#refresh").count()).toBe(0)
        expect(await page.locator("#freshness").innerText()).toContain("when the Run reads GitHub")
      }
    })
    expect(yield* Ref.get(inspections)).toBe(0)
    const later = projectTrackerSnapshot({ revision: "browser-later", rootTaskId: "root", tasks: [
      ...normalized.snapshot.toWire().tasks,
      { id: "new-child", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] }
    ] })
    if (later._tag !== "Valid") return expect.fail("requires complete later graph")
    yield* SubscriptionRef.set(state, yield* runningHostPageObservation(probe.runId, later.snapshot, { phase: "Executing" }))
    yield* Effect.promise(async () => {
      for (const page of pages) {
        const widget = page.locator("dalph-delivery-graph")
        await widget.locator('button[data-task-id="new-child"]').waitFor()
        await widget.locator('button[data-task-id="root"]').click()
        await page.locator("#task").getByText("Executing", { exact: false }).waitFor()
      }
    })
    // Local execution publication changes diagnostics while retaining the same tracker graph.
    yield* SubscriptionRef.set(state, yield* runningHostPageObservation(probe.runId, later.snapshot, { phase: "Delivered" }))
    yield* Effect.promise(async () => {
      for (const page of pages) await page.locator("#task").getByText("Delivered", { exact: false }).waitFor()
      await pages[0]?.reload()
      await pages[0]?.locator('#connection[data-state="connected"]').waitFor()
      const foreign = await browser.newPage()
      await foreign.goto("data:text/html,foreign")
      const refused = await foreign.evaluate(async (origin) => {
        try { await fetch(`${origin}/dalph/v1/descriptor`); return false } catch { return true }
      }, address)
      expect(refused).toBe(true)
    })
    yield* Scope.close(firstHostScope, Exit.succeed(undefined))
    yield* serveRunningHost(address, { ...probe.observation, inspection: observation.inspection })
    yield* Effect.promise(async () => {
      for (const page of pages) {
        await page.locator("#freshness").filter({ hasText: "The Run has not published an observed task graph." }).waitFor({ timeout: 5000 })
        await page.locator('#connection[data-state="connected"]').waitFor()
        expect(await page.locator("dalph-delivery-graph").locator("button[data-task-id]").count()).toBe(0)
      }
      // The second page kept a selection across reconnect, which must lose its old task facts.
      expect(await pages[1]?.locator("#task").innerText()).toContain("Task no longer appears")
    })
    expect(yield* Ref.get(inspections)).toBe(0)
    expect(yield* Ref.get(commands)).toBe(0)
    expect(yield* Ref.get(probe.reads)).toBe(0)
  }))
)
