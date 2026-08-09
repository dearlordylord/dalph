import assert from "node:assert/strict"
import { chromium } from "playwright"

const labUrl = process.env.REDUCER_LAB_URL ?? "http://determined_johnson.orb.local:4173/"
const maintainedCassetteCount = 40
const terminalTimeoutMs = 180_000
const insecureOriginCassette = "authored:candidateCorrectionAfterUnreadableGit"
const framedCassette = "authored:dependentTasksCompleteInOneRun"

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
  assert.equal(await selector.locator("option").count(), maintainedCassetteCount)
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
  assert.match(graphRendered.relationships, /A blocks B/u)

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
