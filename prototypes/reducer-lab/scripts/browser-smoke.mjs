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
  await page.getByRole("button", { name: `Run all ${maintainedCassetteCount} cassettes` }).click()
  await page.waitForFunction(
    (count) => document.querySelector('[data-role="catalog-summary"]')?.textContent
      === `${count} completed · 0 failed · 0 Lab defects · ${count} total`,
    maintainedCassetteCount,
    { timeout: terminalTimeoutMs }
  )
  assert.equal(await selector.locator("option").count(), maintainedCassetteCount)
  assert.equal(await page.locator('[data-role="problem-links"]:not([hidden])').count(), 0)

  await selector.selectOption(framedCassette)
  const workbench = page.locator('[data-role="delivery-workbench"]')
  await workbench.locator("summary").click()
  const frameSelector = workbench.getByLabel("Delivery frame")
  await page.waitForFunction(
    () => document.querySelector('[data-role="delivery-workbench"] select')?.options.length > 1,
    undefined,
    { timeout: terminalTimeoutMs }
  )
  assert.ok(await frameSelector.locator("option").count() > 1)
  assert.equal(await frameSelector.inputValue(), "0")
  await workbench.getByRole("button", { name: "Next frame" }).click()
  assert.equal(await frameSelector.inputValue(), "1")
  await workbench.getByRole("button", { name: "Previous frame" }).click()
  assert.equal(await frameSelector.inputValue(), "0")
  assert.equal(await workbench.getAttribute("open"), "")
  assert.equal(await page.locator("#selected-cassette").getAttribute("data-catalog-key"), framedCassette)
  assert.deepEqual(browserErrors, [])

  console.log(
    `✓ browser-smoke drives the real Orb application through every maintained cassette (${maintainedCassetteCount} at ${labUrl})`
  )
} finally {
  await browser.close()
}
