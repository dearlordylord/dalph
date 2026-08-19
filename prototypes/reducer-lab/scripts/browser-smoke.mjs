import assert from "node:assert/strict"
import { chromium } from "playwright"

const labUrl = process.env.REDUCER_LAB_URL ?? "http://determined_johnson.orb.local:4173/"
const terminalTimeoutMs = 180_000
const insecureOriginCassette = "authored:unreadableTaskUnpauseRejected"
const applicationExitCassette = "application-exit:drainFailure"
const codexExecutorCassette = "codex-executor:lostTurnResponseReconciled"
const framedCassette = "authored:dependentTasksCompleteInOneRun"
const acceptedIntegrationCassette = "authored:acceptedResultRestartsIntoIntegration"
const linkedDeliveryStoryCassette = "authored:deliveryInvariantStory"

const selectCassette = async (page, catalogKey) => {
  const search = page.locator('[data-role="cassette-selector"]')
  await search.fill(catalogKey)
  await search.dispatchEvent("change")
}

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
  const cassetteOptions = page.locator('[data-role="cassette-options"] option')
  const maintainedCassetteCount = await cassetteOptions.count()
  assert.ok(maintainedCassetteCount > 0)
  assert.equal(await selector.getAttribute("type"), "search")
  assert.equal(await selector.getAttribute("aria-label"), "Find cassette by ID or title")
  assert.equal(await page.locator('input[type="search"]').count(), 1)
  const optionLabels = await cassetteOptions.evaluateAll((options) => options.map(({ label }) => label))
  for (const category of [
    "Authored coordinator stories",
    "Application Exit lifecycle",
    "Concrete Codex executor",
    "Target promotion protocol",
    "Integration finality protocol"
  ]) assert.ok(optionLabels.some((label) => label.includes(category)))
  const prototypeTitle = await page
    .locator(`[data-role="cassette-options"] option[value="${linkedDeliveryStoryCassette}"]`)
    .getAttribute("label")
  const humanPrototypeTitle = prototypeTitle?.split(" · ")[0]
  if (humanPrototypeTitle === undefined) throw new Error("The prototype cassette title is missing")
  await selector.fill("deliveryInvariantStory")
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), linkedDeliveryStoryCassette)
  await selector.fill(humanPrototypeTitle)
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), linkedDeliveryStoryCassette)
  await selector.fill("no cassette has this title or id")
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), linkedDeliveryStoryCassette)
  assert.match(await page.locator('[data-role="cassette-search-status"]').textContent() ?? "", /No maintained cassette matches/u)
  console.log("✓ searches cassette IDs, suffixes, and human titles without losing the last valid selection")

  await selectCassette(page, insecureOriginCassette)
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

  for (const [catalogKey, expectedEvidence] of [
    [applicationExitCassette, ["outside every Run journal", "Process-end decision"]],
    [codexExecutorCassette, ["private behind the generic executor boundary", "Generic executor reports"]]
  ]) {
    await page.reload({ waitUntil: "networkidle" })
    await selectCassette(page, catalogKey)
    await page.getByRole("button", { name: /Run selected cassette:/u }).click()
    await page.waitForFunction(
      (selectedKey) => document.querySelector("#selected-cassette")?.getAttribute("data-catalog-key") === selectedKey
        && document.querySelector("#selected-cassette")?.getAttribute("data-state") === "Completed",
      catalogKey,
      { timeout: terminalTimeoutMs }
    )
    const evidence = await page.locator('[data-role="execution-evidence"]').textContent() ?? ""
    for (const expected of expectedEvidence) assert.match(evidence, new RegExp(expected, "u"))
  }

  await page.reload({ waitUntil: "networkidle" })
  await selectCassette(page, framedCassette)
  assert.equal(
    await page.locator('[data-role="delivery-workbench"] .delivery-capacity-note').textContent(),
    "Desired tickets are not held capacity."
  )
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
  const readingGuide = workbench.locator(".delivery-reading-guide")
  assert.equal(await readingGuide.evaluate((element) => element.tagName), "DETAILS")
  assert.equal(await readingGuide.evaluate((element) => element.hasAttribute("open")), false)
  assert.equal(await readingGuide.locator(".delivery-provenance").count(), 1)
  assert.equal(await readingGuide.locator(".delivery-layer-chain").count(), 1)
  assert.equal(await readingGuide.locator(".delivery-graph-legend").count(), 1)
  assert.equal(await readingGuide.locator(".delivery-direct-protocol-note").isVisible(), false)
  assert.equal(
    await workbench.locator(".delivery-capacity-note").textContent(),
    "Desired tickets are not held capacity."
  )
  assert.equal(
    await workbench.locator(".delivery-playback-shortcuts").textContent(),
    "Moment = one captured story, Delivery, or runtime observation · Jump = graph, responsibility, integration, restart, or terminal landmark · Live = follow newest · Keys: ←/→ and [/]."
  )
  const prototypeInstrument = await workbench.locator(".delivery-instrument-layout").evaluate((layout) => {
    const source = layout.querySelector(".delivery-source-explanation")
    const graph = layout.querySelector(".delivery-graph-instrument")
    const sourceBounds = source?.getBoundingClientRect()
    const graphBounds = graph?.getBoundingClientRect()
    return {
      cells: source?.querySelectorAll("[data-source-stage] .delivery-data-rectangle").length ?? 0,
      graphInCanvas: graph?.querySelector(".delivery-graph-canvas > dalph-delivery-graph") !== null,
      peerPanels: layout.querySelectorAll(":scope > .delivery-instrument").length,
      sideBySide: sourceBounds !== undefined && graphBounds !== undefined && Math.abs(sourceBounds.top - graphBounds.top) <= 2,
      sourceText: source?.textContent ?? ""
    }
  })
  assert.equal(prototypeInstrument.peerPanels, 2)
  assert.equal(prototypeInstrument.graphInCanvas, true)
  assert.equal(prototypeInstrument.sideBySide, true)
  assert.ok(prototypeInstrument.cells > 0)
  assert.match(prototypeInstrument.sourceText, /export const delivery = Effect\.gen\(function\* \(\) \{/u)
  assert.match(prototypeInstrument.sourceText, /const trackerGraph = yield\* TrackerGraphRelation/u)
  assert.match(prototypeInstrument.sourceText, /return yield\* reflectDeliverySettlements\(settlements\)/u)
  console.log("✓ renders the prototype code and graph instrument from captured Delivery facts")
  const primaryBeforeGuide = await workbench.evaluate((element) => {
    const controls = element.querySelector(".delivery-timeline-controls")
    const graph = element.querySelector("dalph-delivery-graph")
    const guide = element.querySelector(".delivery-reading-guide")
    return controls !== null && graph !== null && guide !== null
      && Boolean(controls.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(graph.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  assert.equal(primaryBeforeGuide, true)
  const frameSelector = workbench.getByLabel("Observed moment")
  await frameSelector.selectOption("0")
  assert.equal(
    await workbench.locator(".delivery-settlement-coverage").textContent(),
    "Established settlements in this timeline: 0."
  )
  await page.waitForFunction(
    () => document.querySelector('[data-role="delivery-workbench"] select')?.options.length > 1,
    undefined,
    { timeout: terminalTimeoutMs }
  )
  const frameCount = await frameSelector.locator("option").count()
  assert.ok(frameCount > 2)
  const containedMomentTruth = await page.evaluate(() => {
    const frame = document.querySelector('[data-role="delivery-frame"]')
    const selector = document.querySelector('[data-role="delivery-workbench"] select')
    const moment = frame?.querySelector(".delivery-moment-evidence")
    if (!(selector instanceof HTMLSelectElement) || !(moment instanceof HTMLElement)) return null
    const selected = selector.value
    const heights = [...selector.options].map((option) => {
      selector.value = option.value
      selector.dispatchEvent(new Event("change"))
      return moment.getBoundingClientRect().height
    })
    selector.value = selected
    selector.dispatchEvent(new Event("change"))
    return {
      bottommost: frame?.lastElementChild === moment,
      heightRange: Math.max(...heights) - Math.min(...heights),
      overflowY: getComputedStyle(moment).overflowY
    }
  })
  assert.deepEqual(containedMomentTruth, { bottommost: true, heightRange: 0, overflowY: "auto" })
  console.log("✓ contains changing observed-moment evidence at the bottom of the frame")
  assert.equal(await frameSelector.inputValue(), "0")
  await workbench.getByRole("button", { name: "Follow live" }).click()
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  await workbench.getByRole("button", { name: "Previous moment" }).click()
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
  const graphLocator = page.locator("dalph-delivery-graph")
  const graphCanvas = graphLocator.locator("#canvas")
  const resetGraphView = workbench.getByRole("button", { name: "Reset graph view" })
  await resetGraphView.click()
  const fittedGraph = await graphCanvas.screenshot()
  const canvasBounds = await graphCanvas.boundingBox()
  if (canvasBounds === null) throw new Error("The delivery graph canvas is not visible")
  await page.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + canvasBounds.height / 2)
  await page.mouse.wheel(0, 420)
  await page.waitForTimeout(100)
  const zoomedGraph = await graphCanvas.screenshot()
  assert.equal(zoomedGraph.equals(fittedGraph), false, "Pointer zoom must change the rendered graph")
  await resetGraphView.click()
  await page.waitForTimeout(100)
  assert.equal((await graphCanvas.screenshot()).equals(fittedGraph), true, "Reset must restore fitted zoom and pan")
  const panBounds = await graphCanvas.boundingBox()
  if (panBounds === null) throw new Error("The delivery graph canvas disappeared before panning")
  await page.mouse.move(panBounds.x + panBounds.width - 18, panBounds.y + panBounds.height - 18)
  await page.mouse.down()
  await page.mouse.move(panBounds.x + panBounds.width - 78, panBounds.y + panBounds.height - 48, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  assert.equal((await graphCanvas.screenshot()).equals(fittedGraph), false, "Pointer drag must pan the rendered graph")
  await resetGraphView.click()
  await page.waitForTimeout(100)
  assert.equal((await graphCanvas.screenshot()).equals(fittedGraph), true, "Reset must restore the deterministic graph layout")
  console.log("✓ supports graph pan zoom and deterministic reset")
  await frameSelector.selectOption("0")
  await graphLocator.focus()
  await page.keyboard.press("ArrowRight")
  assert.equal(await frameSelector.inputValue(), "1")
  await page.keyboard.press("ArrowLeft")
  assert.equal(await frameSelector.inputValue(), "0")
  await page.keyboard.press("]")
  assert.ok(Number(await frameSelector.inputValue()) > 0)
  await page.keyboard.press("[")
  assert.equal(await frameSelector.inputValue(), "0")
  await workbench.getByRole("button", { name: /Run selected cassette:/u }).focus()
  await page.keyboard.press("ArrowRight")
  assert.equal(await frameSelector.inputValue(), "1")
  const playbackControls = workbench.getByRole("group", { name: "Delivery playback controls" })
  const nextFrameButton = workbench.getByRole("button", { name: "Next moment" })
  await frameSelector.selectOption("1")
  await nextFrameButton.click()
  assert.equal(await frameSelector.inputValue(), "2")
  assert.equal(await nextFrameButton.evaluate((element) => document.activeElement === element), true)
  await page.keyboard.press("Enter")
  assert.equal(await frameSelector.inputValue(), "3")
  assert.equal(await nextFrameButton.evaluate((element) => document.activeElement === element), true)
  await frameSelector.selectOption(String(frameCount - 2))
  await nextFrameButton.click()
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  assert.equal(await playbackControls.evaluate((element) => document.activeElement === element), true)
  await page.keyboard.press("ArrowLeft")
  assert.equal(await frameSelector.inputValue(), String(frameCount - 2))
  await frameSelector.selectOption("1")
  await workbench.getByRole("button", { name: "Previous moment" }).click()
  assert.equal(await frameSelector.inputValue(), "0")
  assert.equal(await playbackControls.evaluate((element) => document.activeElement === element), true)
  await page.keyboard.press("ArrowRight")
  assert.equal(await frameSelector.inputValue(), "1")
  await frameSelector.selectOption("3")
  await workbench.getByRole("button", { name: "Previous moment" }).focus()
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  assert.equal(await frameSelector.inputValue(), "0")
  assert.equal(await playbackControls.evaluate((element) => document.activeElement === element), true)
  await page.keyboard.press("ArrowRight")
  assert.equal(await frameSelector.inputValue(), "1")
  await frameSelector.selectOption(String(frameCount - 4))
  await nextFrameButton.focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  assert.equal(await playbackControls.evaluate((element) => document.activeElement === element), true)
  await page.keyboard.press("ArrowLeft")
  assert.equal(await frameSelector.inputValue(), String(frameCount - 2))
  await frameSelector.selectOption(String(frameCount - 2))
  console.log("✓ navigates exact frames with arrows and landmarks with brackets")
  assert.match(graphRendered.relationships, /Graph summary · 2 tasks · 1 relationship/u)
  assert.match(graphRendered.relationships, /A blocks B/u)
  await graphLocator.locator("#summary > summary").click()
  const beforeSelection = await graphLocator.screenshot()
  await graphLocator.locator('button[data-task-id="A"]').click()
  const afterSelection = await graphLocator.screenshot()
  assert.equal(beforeSelection.equals(afterSelection), false)
  assert.equal(await page.locator('tr[data-task-id="A"]').getAttribute("aria-current"), "true")
  await workbench.getByRole("button", { name: "Previous moment" }).click()
  assert.equal(await graphLocator.locator("#summary").getAttribute("open"), "")
  assert.equal(await graphLocator.locator('button[data-task-id="A"]').getAttribute("aria-current"), "true")
  console.log("✓ keeps selected-task feedback separate from delivery encodings")

  const synchronizedSelection = await page.evaluate(() => {
    const timeline = document.querySelector('[data-role="delivery-workbench"] select')
    const graph = document.querySelector("dalph-delivery-graph")
    if (!(timeline instanceof HTMLSelectElement) || graph === null) return null
    for (const option of timeline.options) {
      timeline.value = option.value
      timeline.dispatchEvent(new Event("change"))
      const storyTask = document.querySelector(".delivery-moment-evidence .delivery-source-task-buttons button")
      if (!(storyTask instanceof HTMLButtonElement)) continue
      const taskId = storyTask.textContent ?? ""
      const incident = graph.projection?.edges.some(({ from, to }) => from === taskId || to === taskId) === true
      if (!incident) continue
      storyTask.click()
      const storySelected = graph.selectedTaskId === taskId
      const incidentEdgeSelected = graph.shadowRoot?.querySelector("li[data-edge-from].selection-related") !== null
      const sourceStage = [...document.querySelectorAll("[data-source-stage]")].find((row) =>
        row.getAttribute("data-task-ids")?.split(",").includes(taskId)
      )
      const stageButton = sourceStage?.querySelector(":scope > button")
      if (!(stageButton instanceof HTMLButtonElement)) continue
      stageButton.click()
      const stageHighlightsTask = graph.highlightedTaskIds?.includes(taskId) === true
      const dataTask = sourceStage.querySelector(".delivery-data-rectangle[data-cell-task]")
      if (!(dataTask instanceof HTMLButtonElement)) continue
      dataTask.click()
      return {
        dataSelected: graph.selectedTaskId === dataTask.textContent,
        incidentEdgeSelected,
        sourceRowsSelected: document.querySelector("[data-source-stage].source-selection-related") !== null,
        stageHighlightsTask,
        storySelected
      }
    }
    return null
  })
  assert.deepEqual(synchronizedSelection, {
    dataSelected: true,
    incidentEdgeSelected: true,
    sourceRowsSelected: true,
    stageHighlightsTask: true,
    storySelected: true
  })
  console.log("✓ keeps the graph primary and synchronizes story source data tasks and incident edges")

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

  if (await graphLocator.locator("#summary").getAttribute("open") !== null) {
    await graphLocator.locator("#summary > summary").click()
  }
  const populatedGraphHeight = await page.locator("dalph-delivery-graph").evaluate((element) =>
    element.getBoundingClientRect().height
  )
  await frameSelector.selectOption("0")
  const emptyGraphTruth = await page.locator("dalph-delivery-graph").evaluate((element) => {
    const summary = element.shadowRoot?.querySelector("#summary")
    return {
      height: element.getBoundingClientRect().height,
      empty: element.hasAttribute("data-empty"),
      summaryHidden: summary?.hasAttribute("hidden") ?? false
    }
  })
  assert.equal(emptyGraphTruth.empty, true)
  assert.equal(emptyGraphTruth.summaryHidden, true)
  assert.ok(
    Math.abs(emptyGraphTruth.height - populatedGraphHeight) <= 2,
    `graph viewport changed from ${populatedGraphHeight}px to ${emptyGraphTruth.height}px`
  )
  assert.doesNotMatch(
    await workbench.locator('[data-role="selected-task-facts"]').textContent() ?? "",
    /Select a task in the graph summary/u
  )
  assert.equal(await resetGraphView.isDisabled(), true)
  assert.match(await workbench.locator(".delivery-graph-view-controls").textContent() ?? "", /Drag to pan · pinch, wheel, or trackpad to zoom/u)
  console.log("✓ keeps graph-not-established frames dimensionally stable and truthful")
  await frameSelector.selectOption(String(frameCount - 2))
  assert.equal(await resetGraphView.isEnabled(), true)

  await workbench.getByRole("button", { name: "Follow live" }).click()
  assert.equal(await frameSelector.inputValue(), String(frameCount - 1))
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), framedCassette)
  const journalLabels = await page.locator('[data-role="journal-chronology"] td details > summary').allTextContents()
  assert.equal(new Set(journalLabels).size, journalLabels.length)
  assert.ok(journalLabels.every((label) => /^Position \d+ · [A-Za-z]/u.test(label)))
  assert.ok(journalLabels.some((label) => label.includes("taskId=A") && label.includes("attemptId=attempt:A:0")))

  await page.evaluate(() => {
    globalThis.__singleRerunSettled = new Promise((resolve) => {
      document.querySelector("#root")?.addEventListener("dalph-cassette-lab:single-settled", resolve, { once: true })
    })
  })
  await workbench.getByRole("button", { name: /Run selected cassette:/u }).click()
  await page.evaluate(() => globalThis.__singleRerunSettled)
  const rerunFrameSelector = workbench.getByLabel("Observed moment")
  await rerunFrameSelector.selectOption("0")
  await workbench.getByRole("button", { name: /Run selected cassette:/u }).focus()
  await page.keyboard.press("ArrowRight")
  assert.equal(await rerunFrameSelector.inputValue(), "1")
  await rerunFrameSelector.selectOption(String(await rerunFrameSelector.locator("option").count() - 1))
  await workbench.locator("dalph-delivery-graph").focus()
  const repeatedBracketDuration = await page.evaluate(() => {
    const started = performance.now()
    for (let index = 0; index < 5_000; index += 1) {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "["
      }))
    }
    return performance.now() - started
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  assert.equal(await rerunFrameSelector.inputValue(), "0")
  assert.ok(repeatedBracketDuration < 1_000, `repeated landmark input took ${repeatedBracketDuration}ms`)
  const disabledCursor = await workbench.getByRole("button", { name: "Previous moment" }).evaluate((button) =>
    getComputedStyle(button).cursor
  )
  assert.equal(disabledCursor, "not-allowed")
  console.log("✓ keeps exactly one keyboard playback handler after rerun")

  await page.reload({ waitUntil: "networkidle" })
  await selectCassette(page, acceptedIntegrationCassette)
  await page.getByRole("button", { name: /Run selected cassette:/u }).click()
  await page.waitForFunction(
    (catalogKey) => document.querySelector("#selected-cassette")?.getAttribute("data-catalog-key") === catalogKey
      && document.querySelector("#selected-cassette")?.getAttribute("data-state") === "Completed",
    acceptedIntegrationCassette,
    { timeout: terminalTimeoutMs }
  )
  const integrationFrameSelector = page.getByLabel("Observed moment")
  const integrationOrderFrames = await page.evaluate(() => {
    const select = document.querySelector('[data-role="delivery-workbench"] select')
    if (!(select instanceof HTMLSelectElement)) return []
    return [...select.options].map((option) => {
      select.value = option.value
      select.dispatchEvent(new Event("change"))
      return {
        capacity: document.querySelector('[data-role="delivery-capacity-positions"]')?.textContent ?? "",
        order: document.querySelector('[data-role="delivery-integration-order"]')?.textContent ?? "",
        value: option.value
      }
    })
  })
  assert.ok(integrationOrderFrames.some(({ order }) => order.includes("0 ordered · 1 awaiting responsibility")))
  assert.ok(integrationOrderFrames.some(({ order }) =>
    order.includes("#1 · Task A · queued before integration cutoff")
    && order.includes("/dalph/cassettes/integration.git · refs/heads/master")
  ))
  const startedIntegrationFrame = integrationOrderFrames.find(({ order }) =>
    order.includes("#1 · Task A · started past integration cutoff at journal")
  )
  assert.ok(startedIntegrationFrame)
  assert.match(startedIntegrationFrame.order, /not a persisted queue row or proof that this process holds/u)
  assert.match(startedIntegrationFrame.capacity, /held of capacity 1/u)
  await integrationFrameSelector.selectOption(startedIntegrationFrame.value)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => document.documentElement.scrollWidth <= globalThis.innerWidth)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth))
  const narrowInstrument = await page.locator(".delivery-instrument-layout").evaluate((layout) => {
    const source = layout.querySelector(".delivery-source-explanation")
    const graph = layout.querySelector(".delivery-graph-instrument")
    const sourceBounds = source?.getBoundingClientRect()
    const graphBounds = graph?.getBoundingClientRect()
    return {
      cells: source?.querySelectorAll(".delivery-data-rectangle").length ?? 0,
      graphVisible: graphBounds !== undefined && graphBounds.height > 0,
      sourceVisible: sourceBounds !== undefined && sourceBounds.height > 0,
      stacked: sourceBounds !== undefined && graphBounds !== undefined && graphBounds.top >= sourceBounds.bottom - 2
    }
  })
  assert.equal(narrowInstrument.graphVisible, true)
  assert.equal(narrowInstrument.sourceVisible, true)
  assert.equal(narrowInstrument.stacked, true)
  assert.ok(narrowInstrument.cells > 0)
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log("✓ shows the accepted result enter and start its journal-derived integration order")

  await page.reload({ waitUntil: "networkidle" })
  await selectCassette(page, linkedDeliveryStoryCassette)
  assert.match(
    await page.locator("#selected-cassette .delivery-story-scope").textContent() ?? "",
    /one outer Integrator session.*supporting delivery evidence/u
  )
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
  assert.ok(linkedTrace.some(({ state, taskCount }) => state === "Running" && taskCount === 10))
  const stableTrace = linkedTrace.filter(({ graphTop }) => graphTop !== null)
  assert.ok(stableTrace.length > 10)
  assert.ok(stableTrace.every(({ graphTop, scrollY }) =>
    Math.abs(graphTop - stableTrace[0].graphTop) <= 2 && Math.abs(scrollY - stableTrace[0].scrollY) <= 2
  ))
  const linkedWorkbench = page.locator('[data-role="delivery-workbench"]')
  const linkedFrameSelector = linkedWorkbench.getByLabel("Observed moment")
  const linkedFrameTruth = await page.evaluate(() => {
    const select = document.querySelector('[data-role="delivery-workbench"] select')
    const graph = document.querySelector("dalph-delivery-graph")
    if (!(select instanceof HTMLSelectElement) || graph === null) return []
    return [...select.options].map((option, index) => {
      select.value = option.value
      select.dispatchEvent(new Event("change"))
      return {
        index,
        facts: document.querySelector('[data-role="delivery-frame"]')?.textContent ?? "",
        edges: (graph.projection?.edges ?? []).map(({ from, to }) => `${from}->${to}`).sort(),
        eligible: [...document.querySelectorAll('tr[data-task-id]')]
          .filter((row) => row.querySelector('[data-label="Graph-only eligibility"]')?.textContent?.startsWith("eligible"))
          .map((row) => row.getAttribute("data-task-id"))
          .filter((taskId) => taskId !== null)
          .sort()
          .join("+"),
        held: [...document.querySelectorAll('[data-role="delivery-capacity-positions"] [data-task-id]')]
          .map((item) => item.getAttribute("data-task-id"))
          .filter((taskId) => taskId !== null)
          .sort()
          .join("+"),
        offGraph: document.querySelector('[data-role="delivery-off-graph-responsibilities"]')?.textContent ?? "",
        capacity: document.querySelector('[data-role="delivery-capacity-positions"]')?.textContent ?? "",
        taskCount: graph.projection?.tasks.length ?? 0,
        taskState: document.querySelector('[data-role="delivery-task-state"]')?.textContent ?? ""
      }
    })
  })
  assert.deepEqual(
    linkedFrameTruth.find(({ taskCount }) => taskCount === 10)?.edges,
    ["A->B", "A->C", "A->X", "B->D", "C->D", "D->E", "D->F", "E->H", "F->I", "H->G", "I->G", "X->G"]
  )
  const eligibleWaves = linkedFrameTruth.map(({ eligible }) => eligible)
  let previousWave = -1
  for (const wave of ["A", "B+C", "D+X", "E+F", "H+I", "G", ""]) {
    previousWave = eligibleWaves.indexOf(wave, previousWave + 1)
    assert.ok(previousWave >= 0, `missing rendered frontier wave ${wave || "empty"}`)
  }
  const initialMiddle = linkedFrameTruth.find(({ taskState }) =>
    /B/u.test(taskState) && /C/u.test(taskState) && /attempt:B:0/u.test(taskState) && /attempt:C:1/u.test(taskState)
  )
  const laterMiddle = initialMiddle === undefined
    ? undefined
    : linkedFrameTruth.find(({ index, offGraph }) =>
        index > initialMiddle.index
        && /Task B · graph not established/u.test(offGraph)
        && /Task C · graph not established/u.test(offGraph)
      )
  assert.ok(initialMiddle)
  assert.ok(laterMiddle)
  assert.match(laterMiddle.taskState, /attempt:B:0/u)
  assert.match(laterMiddle.taskState, /attempt:C:1/u)
  assert.match(laterMiddle.capacity, /2 held of capacity 2/u)
  assert.match(laterMiddle.capacity, /Anonymous process-local positions/u)
  assert.match(laterMiddle.offGraph, /Task B · graph not established/u)
  assert.match(laterMiddle.offGraph, /Task C · graph not established/u)
  assert.match(laterMiddle.offGraph, /placement GraphNotEstablished/u)
  assert.match(laterMiddle.offGraph, /occupies capacity · Run .+ · attempt attempt:B:0/u)
  assert.match(laterMiddle.offGraph, /planned-attempt executor responsibility/u)
  await linkedFrameSelector.selectOption(String(laterMiddle.index))
  await page.setViewportSize({ width: 390, height: 844 })
  const restartNarrowTruth = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    restartWidth: document.querySelector(".delivery-restart-boundary")?.scrollWidth ?? 0,
    viewportWidth: globalThis.innerWidth,
    workbenchWidth: document.querySelector('[data-role="delivery-workbench"]')?.getBoundingClientRect().width ?? 0
  }))
  assert.ok(
    restartNarrowTruth.documentWidth <= restartNarrowTruth.viewportWidth,
    `restart correlations overflow the mobile viewport: ${JSON.stringify(restartNarrowTruth)}`
  )
  assert.ok(restartNarrowTruth.restartWidth <= restartNarrowTruth.workbenchWidth)
  await page.setViewportSize({ width: 1440, height: 900 })
  const heldSequence = ["B+C", "C", "D+X", "X", "E+F", "F", "H+I", "I", "G"]
  let previousHeld = -1
  for (const held of heldSequence) {
    previousHeld = linkedFrameTruth.findIndex(({ held: value }, index) => index > previousHeld && value === held)
    assert.ok(previousHeld >= 0, `missing rendered held-position state ${held}`)
  }
  assert.ok(await linkedFrameSelector.locator("option").count() > 1)
  await linkedFrameSelector.selectOption("0")
  const landmarkWaves = []
  const nextLandmark = linkedWorkbench.getByRole("button", { name: "Next delivery landmark" })
  while (await nextLandmark.isEnabled() && landmarkWaves.length < 64) {
    await nextLandmark.click()
    const wave = await linkedWorkbench.locator('tr[data-task-id]').evaluateAll((rows) => rows
      .filter((row) => row.querySelector('[data-label="Graph-only eligibility"]')?.textContent?.startsWith("eligible"))
      .map((row) => row.getAttribute("data-task-id"))
      .filter((taskId) => taskId !== null)
      .sort()
      .join("+"))
    landmarkWaves.push(`${await linkedFrameSelector.inputValue()}:${wave}:${await linkedFrameSelector.locator("option:checked").textContent()}`)
  }
  for (const wave of ["A", "B+C", "B+C+X", "D+X", "E+F", "H+I", "G", ""]) {
    assert.ok(
      landmarkWaves.some((value) => value.includes(`:${wave}:`)),
      `missing landmark frontier ${wave || "empty"}: ${JSON.stringify(landmarkWaves)}`
    )
  }
  const activationLabels = [...new Set(linkedFrameTruth.flatMap(({ facts }) =>
    facts.match(/(?:Initial|Later) activation \d+/gu) ?? []
  ))]
  for (const activation of activationLabels) {
    assert.ok(landmarkWaves.some((value) => value.includes(activation)), `missing delivery landmark for ${activation}`)
  }
  for (const held of heldSequence.filter((value) => value !== "G")) {
    assert.ok(
      landmarkWaves.some((value) => value.includes(`held task-work positions ${held}`)),
      `missing held-position landmark ${held}: ${JSON.stringify(landmarkWaves)}`
    )
  }
  assert.ok(landmarkWaves.length <= 24, `too many delivery landmarks: ${JSON.stringify(landmarkWaves)}`)
  console.log("✓ drives the staggered double-diamond frontier through every production wave, held-position release, and restart")

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
  assert.equal(await page.locator('[data-role="cassette-options"] option').count(), maintainedCassetteCount)
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
