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
    globalThis.__deliverySurfaceStability = []
    globalThis.__deliveryStableNodes = null
    document.querySelector("#root")?.addEventListener("dalph-cassette-lab:delivery-frame", (event) => {
      const article = document.querySelector("#selected-cassette")
      const workbench = document.querySelector('[data-role="delivery-workbench"]')
      const frameSelector = document.querySelector('[data-role="delivery-workbench"] select')
      globalThis.__deliveryFrameTrace.push({
        catalogKey: event.detail.catalogKey,
        frameCount: event.detail.frameCount,
        optionCount: frameSelector?.options.length ?? 0,
        selectedFrame: frameSelector?.value ?? null,
        state: article?.getAttribute("data-state")
      })
      if (event.detail.frameCount === 2 && frameSelector instanceof HTMLSelectElement) {
        frameSelector.value = "0"
        frameSelector.dispatchEvent(new Event("change"))
        const frame = document.querySelector('[data-role="delivery-frame"]')
        const exact = frame?.querySelector('details[data-role="all-task-facts"]')
        exact?.setAttribute("open", "")
        const anchor = frame?.querySelector('[data-role="selected-task-facts"]')
        anchor?.scrollIntoView({ block: "center" })
        globalThis.__deliveryStableNodes = { article, workbench, frame, exact, anchor }
      } else if (event.detail.frameCount > 2 && globalThis.__deliveryStableNodes !== null) {
        const stable = globalThis.__deliveryStableNodes
        globalThis.__deliverySurfaceStability.push({
          article: stable.article === document.querySelector("#selected-cassette"),
          disclosure: stable.exact?.isConnected === true && stable.exact.open,
          frame: stable.frame === document.querySelector('[data-role="delivery-frame"]'),
          workbench: stable.workbench === workbench
        })
      }
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
  const liveStability = await page.evaluate(() => globalThis.__deliverySurfaceStability)
  assert.ok(liveStability.length > 0)
  assert.ok(liveStability.every(({ article, disclosure, frame, workbench }) => article && disclosure && frame && workbench))

  const workbench = page.locator('[data-role="delivery-workbench"]')
  assert.equal(await workbench.evaluate((element) => element.tagName), "SECTION")
  assert.equal(await workbench.locator(":scope > summary").count(), 0)
  const frameSelector = workbench.getByLabel("Delivery frame")
  await page.waitForFunction(
    () => document.querySelector('[data-role="delivery-workbench"] select')?.options.length > 1,
    undefined,
    { timeout: terminalTimeoutMs }
  )
  const frameCount = await frameSelector.locator("option").count()
  assert.ok(frameCount > 2)
  assert.equal(await frameSelector.inputValue(), "0")
  await workbench.getByRole("button", { name: "Follow live" }).click()
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
  await workbench.getByRole("button", { name: "Previous frame" }).click()
  assert.equal(await graphLocator.locator("#summary").getAttribute("open"), "")
  assert.equal(await graphLocator.locator('button[data-task-id="A"]').getAttribute("aria-current"), "true")
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

  await workbench.getByRole("button", { name: "Follow live" }).click()
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), framedCassette)
  const journalLabels = await page.locator('[data-role="journal-chronology"] td details > summary').allTextContents()
  assert.equal(new Set(journalLabels).size, journalLabels.length)
  assert.ok(journalLabels.every((label) => /^Position \d+ · [A-Za-z]/u.test(label)))
  assert.ok(journalLabels.some((label) => label.includes("taskId=A") && label.includes("attemptId=attempt:A:0")))

  await page.reload({ waitUntil: "networkidle" })
  await selector.selectOption(linkedDeliveryStoryCassette)
  await page.evaluate(() => {
    globalThis.__linkedDeliveryStoryTrace = []
    document.querySelector("#root")?.addEventListener("dalph-cassette-lab:delivery-frame", () => {
      const article = document.querySelector("#selected-cassette")
      const graph = document.querySelector("dalph-delivery-graph")
      if (globalThis.__linkedDeliveryStoryTrace.length === 0) graph?.scrollIntoView({ block: "start" })
      globalThis.__linkedDeliveryStoryTrace.push({
        activation: document.querySelector('[data-role="delivery-frame"]')?.textContent ?? "",
        graphTop: graph?.getBoundingClientRect().top ?? null,
        scrollY: globalThis.scrollY,
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
  assert.ok(linkedTrace.some(({ state, taskCount }) => state === "Running" && taskCount === 7))
  const stableTrace = linkedTrace.filter(({ graphTop }) => graphTop !== null)
  assert.ok(stableTrace.length > 10)
  assert.ok(stableTrace.every(({ graphTop, scrollY }) =>
    Math.abs(graphTop - stableTrace[0].graphTop) <= 2 && Math.abs(scrollY - stableTrace[0].scrollY) <= 2
  ))
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
        edges: (graph.projection?.edges ?? []).map(({ from, to }) => `${from}->${to}`).sort(),
        eligible: [...document.querySelectorAll('tr[data-task-id]')]
          .filter((row) => row.querySelector('[data-label="Graph-only eligibility"]')?.textContent?.startsWith("eligible"))
          .map((row) => row.getAttribute("data-task-id"))
          .filter((taskId) => taskId !== null)
          .sort()
          .join("+"),
        taskCount: graph.projection?.tasks.length ?? 0,
        taskState: document.querySelector('[data-role="delivery-task-state"]')?.textContent ?? ""
      }
    })
  })
  assert.deepEqual(
    linkedFrameTruth.find(({ taskCount }) => taskCount === 7)?.edges,
    ["A->B", "A->C", "B->D", "C->D", "D->E", "D->F", "E->G", "F->G"]
  )
  const eligibleWaves = linkedFrameTruth.map(({ eligible }) => eligible)
  let previousWave = -1
  for (const wave of ["A", "B+C", "D", "E+F", "G", ""]) {
    previousWave = eligibleWaves.indexOf(wave, previousWave + 1)
    assert.ok(previousWave >= 0, `missing rendered frontier wave ${wave || "empty"}`)
  }
  const initialMiddle = linkedFrameTruth.find(({ facts, taskState }) =>
    /Initial activation 1/u.test(facts) && /B/u.test(taskState) && /C/u.test(taskState) && /attempt:B:1/u.test(taskState) && /attempt:C:2/u.test(taskState)
  )
  const laterMiddle = linkedFrameTruth.find(({ facts }) => /Later activation 2/u.test(facts))
  assert.ok(initialMiddle)
  assert.ok(laterMiddle)
  assert.match(laterMiddle.taskState, /attempt:B:1/u)
  assert.match(laterMiddle.taskState, /attempt:C:2/u)
  assert.ok(await linkedFrameSelector.locator("option").count() > 1)
  await linkedFrameSelector.selectOption("0")
  const landmarkWaves = []
  const nextLandmark = linkedWorkbench.getByRole("button", { name: "Next delivery landmark" })
  while (await nextLandmark.isEnabled() && landmarkWaves.length < 12) {
    await nextLandmark.click()
    const wave = await linkedWorkbench.locator('tr[data-task-id]').evaluateAll((rows) => rows
      .filter((row) => row.querySelector('[data-label="Graph-only eligibility"]')?.textContent?.startsWith("eligible"))
      .map((row) => row.getAttribute("data-task-id"))
      .filter((taskId) => taskId !== null)
      .sort()
      .join("+"))
    landmarkWaves.push(`${await linkedFrameSelector.inputValue()}:${wave}:${await linkedFrameSelector.locator("option:checked").textContent()}`)
  }
  for (const wave of ["A", "B+C", "D", "E+F", "G", ""]) assert.ok(landmarkWaves.some((value) => value.includes(`:${wave}:`)))
  for (const activation of ["Initial activation 1", "Later activation 2", "Later activation 3", "Later activation 4"]) {
    assert.ok(landmarkWaves.some((value) => value.includes(activation)), `missing delivery landmark for ${activation}`)
  }
  assert.ok(landmarkWaves.length <= 9, `too many delivery landmarks: ${JSON.stringify(landmarkWaves)}`)
  console.log("✓ drives the double-diamond frontier through every production wave and restart")

  const linkedFrameCount = await linkedFrameSelector.locator("option").count()
  await linkedFrameSelector.selectOption(String(Math.max(0, linkedFrameCount - 28)))
  await page.setViewportSize({ width: 390, height: 844 })
  const compactPlayback = await linkedWorkbench.locator(".delivery-timeline-controls").evaluate((toolbar) => {
    const bounds = toolbar.getBoundingClientRect()
    return {
      background: getComputedStyle(toolbar).backgroundColor,
      buttons: [...toolbar.querySelectorAll("button")].map((button) => {
        const buttonBounds = button.getBoundingClientRect()
        return {
          clientWidth: button.clientWidth,
          left: buttonBounds.left,
          right: buttonBounds.right,
          scrollWidth: button.scrollWidth
        }
      }),
      height: bounds.height,
      left: bounds.left,
      right: bounds.right
    }
  })
  assert.equal(compactPlayback.background, "rgb(247, 243, 233)")
  assert.ok(compactPlayback.height <= 180, `double-diamond playback toolbar is ${compactPlayback.height}px tall`)
  for (const button of compactPlayback.buttons) {
    assert.ok(button.scrollWidth <= button.clientWidth + 1, `playback label is clipped: ${JSON.stringify(button)}`)
    assert.ok(button.left >= compactPlayback.left - 1 && button.right <= compactPlayback.right + 1)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log("✓ keeps late double-diamond playback compact and unclipped at 390px")

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
  assert.equal(await page.locator('details[data-role="all-task-facts"]').getAttribute("open"), null)
  await page.locator('[data-role="selected-task-facts"]').scrollIntoViewIfNeeded()
  const stickyControlTop = await page.locator(".delivery-timeline-controls").evaluate((element) =>
    element.getBoundingClientRect().top
  )
  assert.ok(stickyControlTop >= -1 && stickyControlTop < 844)
  const narrowTruth = await page.locator("dalph-delivery-graph").evaluate((element) => {
    const empty = element.shadowRoot?.querySelector("#empty")
    const frameSelect = document.querySelector('[data-role="cassette-selector"]')
    const timelineControls = document.querySelector(".delivery-timeline-controls")
    return {
      documentWidth: document.documentElement.scrollWidth,
      emptyDisplay: empty === null ? "missing" : getComputedStyle(empty).display,
      emptyWidth: empty?.getBoundingClientRect().width ?? -1,
      selectorWidth: frameSelect?.getBoundingClientRect().width ?? -1,
      toolbarBackground: timelineControls === null ? "missing" : getComputedStyle(timelineControls).backgroundColor,
      toolbarHeight: timelineControls?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY,
      viewportWidth: globalThis.innerWidth
    }
  })
  assert.equal(narrowTruth.emptyDisplay, "none")
  assert.equal(narrowTruth.emptyWidth, 0)
  assert.ok(narrowTruth.selectorWidth <= narrowTruth.viewportWidth)
  assert.ok(narrowTruth.documentWidth <= narrowTruth.viewportWidth)
  assert.equal(narrowTruth.toolbarBackground, "rgb(247, 243, 233)")
  assert.ok(narrowTruth.toolbarHeight <= 180, `mobile playback toolbar is ${narrowTruth.toolbarHeight}px tall`)
  assert.deepEqual(browserErrors, [])

  console.log(
    `✓ browser-smoke drives the real Orb application through every maintained cassette (${maintainedCassetteCount} at ${labUrl})`
  )
} finally {
  await browser.close()
}
