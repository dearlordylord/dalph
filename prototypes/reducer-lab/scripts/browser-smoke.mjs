import assert from "node:assert/strict"
import { chromium } from "playwright"

const labUrl = process.env.REDUCER_LAB_URL ?? "http://determined_johnson.orb.local:4173/"
const terminalTimeoutMs = 180_000
const insecureOriginCassette = "authored:candidateCorrectionAfterUnreadableGit"
const framedCassette = "authored:dependentTasksCompleteInOneRun"
const linkedDeliveryStoryCassette = "authored:deliveryInvariantStory"

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const browserErrors = []
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text())
  })
  page.on("pageerror", (error) => browserErrors.push(String(error)))

  await page.goto(labUrl, { waitUntil: "networkidle" })
  const selector = page.locator('[data-role="cassette-selector"]')
  const maintainedCassetteCount = await selector.locator("option").count()
  assert.ok(maintainedCassetteCount > 0)
  assert.equal(await selector.locator("optgroup").count(), 3)
  assert.equal(await page.locator('input[type="search"]').count(), 0)

  await selector.selectOption(insecureOriginCassette)
  await page.getByRole("button", { name: /Run selected cassette:/u }).click()
  await page.waitForFunction(
    (catalogKey) => {
      const article = document.querySelector("#selected-cassette")
      return article?.getAttribute("data-catalog-key") === catalogKey
        && article.getAttribute("data-state") !== "Running"
    },
    insecureOriginCassette,
    { timeout: terminalTimeoutMs }
  )
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-state"), "Completed")

  await page.reload({ waitUntil: "networkidle" })
  await selector.selectOption(framedCassette)
  await page.evaluate(() => {
    globalThis.__deliveryFrameTrace = []
    document.querySelector("#root")?.addEventListener("dalph-cassette-lab:delivery-frame", (event) => {
      const article = document.querySelector("#selected-cassette")
      const frameSelector = document.querySelector('[data-role="delivery-workbench"] select')
      globalThis.__deliveryFrameTrace.push({
        catalogKey: event.detail.catalogKey,
        frameCount: event.detail.frameCount,
        optionCount: frameSelector?.options.length ?? 0,
        selectedFrame: frameSelector?.value ?? null,
        state: article?.getAttribute("data-state")
      })
    })
  })
  await page.getByRole("button", { name: /Run selected cassette:/u }).click()
  await page.waitForFunction(
    (catalogKey) => document.querySelector("#selected-cassette")?.getAttribute("data-catalog-key") === catalogKey
      && document.querySelector("#selected-cassette")?.getAttribute("data-state") === "Completed",
    framedCassette,
    { timeout: terminalTimeoutMs }
  )
  const liveTrace = await page.evaluate(() => globalThis.__deliveryFrameTrace)
  assert.ok(liveTrace.length > 1)
  assert.equal(liveTrace[0].state, "Running")
  assert.equal(liveTrace[0].optionCount, 1)
  assert.equal(liveTrace[1].state, "Running")
  assert.ok(liveTrace[1].optionCount > liveTrace[0].optionCount)
  assert.equal(liveTrace[1].selectedFrame, String(liveTrace[1].optionCount - 1))

  const workbench = page.locator('[data-role="delivery-workbench"]')
  const workbenchDisclosure = workbench.locator(":scope > summary")
  const frameSelector = workbench.getByLabel("Delivery frame")
  await page.waitForFunction(
    () => document.querySelector('[data-role="delivery-workbench"] select')?.options.length > 1,
    undefined,
    { timeout: terminalTimeoutMs }
  )
  const frameCount = await frameSelector.locator("option").count()
  assert.ok(frameCount > 2)
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  await workbench.getByRole("button", { name: "Previous frame" }).click()
  assert.equal(await frameSelector.inputValue(), String(frameCount - 2))
  const graphRendered = await page.locator("dalph-delivery-graph").evaluate((element) => {
    const shadow = element.shadowRoot
    const taskIds = [...(shadow?.querySelectorAll("button[data-task-id]") ?? [])]
      .map((button) => button.getAttribute("data-task-id"))
    return {
      canvasChildren: shadow?.querySelector("#canvas")?.childElementCount ?? 0,
      relationships: shadow?.querySelector("#summary")?.textContent ?? "",
      taskIds
    }
  })
  assert.ok(graphRendered.canvasChildren > 0)
  assert.deepEqual(graphRendered.taskIds, ["A", "B"])
  assert.match(graphRendered.relationships, /Graph summary · 2 tasks · 1 relationship/u)
  assert.match(graphRendered.relationships, /A blocks B/u)
  const graphLocator = page.locator("dalph-delivery-graph")
  await graphLocator.locator("#summary > summary").click()
  const beforeSelection = await graphLocator.screenshot()
  await graphLocator.locator('button[data-task-id="A"]').click()
  const afterSelection = await graphLocator.screenshot()
  assert.equal(beforeSelection.equals(afterSelection), false)
  assert.equal(await page.locator('tr[data-task-id="A"]').getAttribute("aria-current"), "true")
  console.log("✓ keeps selected-task feedback separate from delivery encodings")

  const desktopTaskTruth = await page.locator('[data-role="delivery-task-state"]').evaluate((table) => {
    const tableRect = table.getBoundingClientRect()
    const lastCell = table.querySelector("tbody tr td:last-child")?.getBoundingClientRect()
    return {
      clientWidth: table.clientWidth,
      lastCellRight: lastCell?.right ?? Number.POSITIVE_INFINITY,
      scrollWidth: table.scrollWidth,
      tableRight: tableRect.right
    }
  })
  assert.ok(desktopTaskTruth.scrollWidth <= desktopTaskTruth.clientWidth + 1)
  assert.ok(desktopTaskTruth.lastCellRight <= desktopTaskTruth.tableRight + 1)
  console.log("✓ keeps every per-task meaning visible at desktop width")

  const combinedEncoding = await page.evaluate(() => {
    const selector = document.querySelector('[data-role="delivery-workbench"] select')
    const graph = document.querySelector("dalph-delivery-graph")
    if (!(selector instanceof HTMLSelectElement) || graph === null) return false
    for (const option of selector.options) {
      selector.value = option.value
      selector.dispatchEvent(new Event("change"))
      if (graph.projection?.tasks.some(({ display }) =>
        display?.classes?.includes("placement") && display.classes.includes("standing")
      )) return true
    }
    return false
  })
  assert.equal(combinedEncoding, true)
  console.log("✓ composes simultaneous graph ticket held and delivery encodings")

  await frameSelector.selectOption("0")
  const emptyGraphTruth = await page.locator("dalph-delivery-graph").evaluate((element) => {
    const summary = element.shadowRoot?.querySelector("#summary")
    return {
      compactHeight: element.getBoundingClientRect().height,
      empty: element.hasAttribute("data-empty"),
      summaryHidden: summary?.hasAttribute("hidden") ?? false
    }
  })
  assert.equal(emptyGraphTruth.empty, true)
  assert.equal(emptyGraphTruth.summaryHidden, true)
  assert.ok(emptyGraphTruth.compactHeight < 200)
  assert.doesNotMatch(
    await workbench.locator('[data-role="selected-task-facts"]').textContent() ?? "",
    /Select a task in the graph summary/u
  )
  console.log("✓ keeps graph-not-established recovery frames compact and truthful")
  await frameSelector.selectOption(String(frameCount - 2))

  await workbenchDisclosure.click()
  assert.equal(await workbench.getAttribute("open"), null)
  await workbenchDisclosure.click()
  assert.equal(await workbench.getAttribute("open"), "")
  assert.equal(await frameSelector.inputValue(), String(frameCount - 2))
  await workbench.getByRole("button", { name: "Follow live" }).click()
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  assert.equal(await workbench.getAttribute("open"), "")
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), framedCassette)

  await page.reload({ waitUntil: "networkidle" })
  await selector.selectOption(linkedDeliveryStoryCassette)
  await page.evaluate(() => {
    globalThis.__linkedDeliveryStoryTrace = []
    document.querySelector("#root")?.addEventListener("dalph-cassette-lab:delivery-frame", () => {
      const article = document.querySelector("#selected-cassette")
      const graph = document.querySelector("dalph-delivery-graph")
      globalThis.__linkedDeliveryStoryTrace.push({
        activation: document.querySelector('[data-role="delivery-frame"]')?.textContent ?? "",
        state: article?.getAttribute("data-state"),
        taskCount: graph?.projection?.tasks.length ?? 0
      })
    })
  })
  await page.getByRole("button", { name: /Run selected cassette:/u }).click()
  await page.waitForFunction(
    (catalogKey) => document.querySelector("#selected-cassette")?.getAttribute("data-catalog-key") === catalogKey
      && document.querySelector("#selected-cassette")?.getAttribute("data-state") === "Completed",
    linkedDeliveryStoryCassette,
    { timeout: terminalTimeoutMs }
  )
  const linkedTrace = await page.evaluate(() => globalThis.__linkedDeliveryStoryTrace)
  assert.ok(linkedTrace.some(({ state, taskCount }) => state === "Running" && taskCount === 5))
  assert.ok(linkedTrace.some(({ state, taskCount }) => state === "Running" && taskCount === 7))
  const linkedWorkbench = page.locator('[data-role="delivery-workbench"]')
  const linkedFrameSelector = linkedWorkbench.getByLabel("Delivery frame")
  const linkedFrameTruth = await page.evaluate(() => {
    const select = document.querySelector('[data-role="delivery-workbench"] select')
    const graph = document.querySelector("dalph-delivery-graph")
    if (!(select instanceof HTMLSelectElement) || graph === null) return []
    return [...select.options].map((option) => {
      select.value = option.value
      select.dispatchEvent(new Event("change"))
      return {
        facts: document.querySelector('[data-role="delivery-frame"]')?.textContent ?? "",
        taskCount: graph.projection?.tasks.length ?? 0
      }
    })
  })
  assert.ok(linkedFrameTruth.some(({ facts, taskCount }) => taskCount === 7 && /Recovered/u.test(facts)))
  assert.match(
    await linkedWorkbench.locator(".delivery-settlement-coverage").textContent() ?? "",
    /1 distinct established delivery settlement across \d+ production publications/u
  )
  assert.ok(await linkedFrameSelector.locator("option").count() > 1)
  console.log("✓ drives the linked five-to-seven task delivery story through restart and completion finality")

  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("button", { name: `Run all ${maintainedCassetteCount} cassettes` }).click()
  await page.waitForFunction(
    (count) => document.querySelector('[data-role="catalog-summary"]')?.textContent
      === `${count} completed · 0 failed · 0 Lab defects · ${count} total`,
    maintainedCassetteCount,
    { timeout: terminalTimeoutMs }
  )
  assert.equal(await page.locator('[data-role="cassette-selector"] option').count(), maintainedCassetteCount)
  assert.equal(await page.locator('[data-role="problem-links"]:not([hidden])').count(), 0)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: "networkidle" })
  await page.locator('[data-role="delivery-workbench"] > summary').click()
  const narrowTruth = await page.locator("dalph-delivery-graph").evaluate((element) => {
    const empty = element.shadowRoot?.querySelector("#empty")
    const frameSelect = document.querySelector('[data-role="cassette-selector"]')
    return {
      documentWidth: document.documentElement.scrollWidth,
      emptyDisplay: empty === null ? "missing" : getComputedStyle(empty).display,
      emptyWidth: empty?.getBoundingClientRect().width ?? -1,
      selectorWidth: frameSelect?.getBoundingClientRect().width ?? -1,
      viewportWidth: globalThis.innerWidth
    }
  })
  assert.equal(narrowTruth.emptyDisplay, "none")
  assert.equal(narrowTruth.emptyWidth, 0)
  assert.ok(narrowTruth.selectorWidth <= narrowTruth.viewportWidth)
  assert.ok(narrowTruth.documentWidth <= narrowTruth.viewportWidth)
  assert.deepEqual(browserErrors, [])

  console.log(
    `✓ browser-smoke drives the real Orb application through every maintained cassette (${maintainedCassetteCount} at ${labUrl})`
  )
} finally {
  await browser.close()
}
