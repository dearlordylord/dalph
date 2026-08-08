import { maintainedAuthoredCassetteCatalog } from "../../../packages/dalph/src/cassettes/catalog.ts"
import { maintainedIntegrationFinalityProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts"
import { maintainedTargetPromotionProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/target-promotion-protocol-cassette-domain.ts"
import { parseHTML } from "linkedom"
import {
  controlledBoundaryProvenance,
  maintainedCassetteKeys,
  maintainedCassetteRows,
  runAuthoredCassetteInput,
  runEveryMaintainedCassette,
  runMaintainedCassette
} from "./cassette-lab.ts"
import { resultEvidenceText, resultStatusText, runAllSummaryText } from "./cassette-lab-view.ts"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const scenario = async (name: string, body: () => void | Promise<void>): Promise<void> => {
  await body()
  console.log(`✓ ${name}`)
}

const expectedCatalogSize = Object.keys(maintainedAuthoredCassetteCatalog).length
  + Object.keys(maintainedTargetPromotionProtocolCassetteCatalog).length
  + Object.keys(maintainedIntegrationFinalityProtocolCassetteCatalog).length

let everyResult = await runEveryMaintainedCassette()

await scenario("runs every maintained cassette through production to its declared end", () => {
  assert(maintainedCassetteKeys.length === expectedCatalogSize, "The Lab must enumerate all three exact catalogs")
  assert(everyResult.length === expectedCatalogSize, "Every catalog entry must retain one terminal result")
  const failures = everyResult.filter((result) => result._tag === "Failed")
  assert(
    failures.length === 0,
    `Every cassette must reach its declared end through production: ${failures
      .map((failure) => `${failure.catalogKey}: ${failure.detail}`)
      .join("\n")}`
  )
  for (const result of everyResult) {
    assert(result._tag === "Completed", `${result.catalogKey} must complete`)
    if (result._tag !== "Completed") continue
    assert(result.consumedItemCount === result.totalItemCount, `${result.catalogKey} must consume its whole story`)
    assert(result.journalRecordCount > 0, `${result.catalogKey} must return production journal evidence`)
    if (result.category === "Authored") {
      assert(result.activations.length > 0, `${result.catalogKey} must invoke the production coordinator`)
    }
  }
})

await scenario("reports the exact authored item when production cannot complete a cassette", async () => {
  const singleton = maintainedAuthoredCassetteCatalog.singletonTaskCompletes
  const story: Array<unknown> = [...singleton.story]
  const selection = story[2]
  const graphRead = story[3]
  assert(selection !== undefined && graphRead !== undefined, "The mismatch fixture requires two story items")
  story[2] = graphRead
  story[3] = selection
  const mismatched = await runAuthoredCassetteInput("singletonTaskCompletes", { ...singleton, story })
  assert(mismatched._tag === "Failed", "An out-of-order boundary item must fail visibly")
  if (mismatched._tag !== "Failed") return
  assert(mismatched.location._tag === "Known", "The interaction mismatch must have a known story location")
  if (mismatched.location._tag !== "Known") return
  assert(mismatched.location.storyPosition === 2, "The failure must identify the exact zero-based cursor position")
  assert(mismatched.location.consumedItemCount === 2, "The failure must retain the actual consumed-item count")
  assert(
    mismatched.location.failedItemTag === "TrackerGraphReadReturned",
    "The failure must name the unconsumed story item"
  )
  assert(resultStatusText(mismatched).includes("stopped at 2:TrackerGraphReadReturned"), "The browser status must expose the failed item")
})

await scenario("accepts successful recovered completion at the terminal assertion boundary", async () => {
  const recovered = await runMaintainedCassette("authored:runPauseRestartsPassively")
  assert(recovered._tag === "Completed", "The maintained recovery story must complete")
  if (recovered._tag !== "Completed") return
  assert(recovered.activations.join(",") === "Fresh,Recovered", "The story must execute both coordinator activations")
  assert(recovered.consumedItemCount === recovered.totalItemCount, "Terminal assertions must still be consumed")
})

await scenario("formats maintained cassette rows and summaries", () => {
  assert(maintainedCassetteRows.length === expectedCatalogSize, "The browser model must contain every catalog row")
  assert(
    maintainedCassetteRows.map(({ catalogKey }) => catalogKey).join("|") === maintainedCassetteKeys.join("|"),
    "The browser model must preserve catalog order"
  )
  assert(
    controlledBoundaryProvenance.includes("controlled in memory")
      && controlledBoundaryProvenance.includes("production cassette runners"),
    "The browser must distinguish controlled boundaries from production execution"
  )
  for (const result of everyResult) {
    assert(resultStatusText(result).includes(`${result.totalItemCount}/${result.totalItemCount}`), `${result.catalogKey} must render complete progress`)
    assert(resultEvidenceText(result).length > 2, `${result.catalogKey} must render execution evidence`)
  }
  assert(everyResult.length === maintainedCassetteRows.length, "Run all must retain one result per rendered row")
  assert(
    runAllSummaryText(everyResult) === `${expectedCatalogSize} completed · 0 failed · ${expectedCatalogSize} total`,
    "Run all must render the exact completed, failed, and total counts"
  )
})

let runAllBrowserCommand: (() => Promise<{ readonly everyRowCompleted: boolean; readonly everyRowHasEvidence: boolean; readonly summaryText: string | null }>) | undefined

await scenario("renders every maintained cassette and its production execution evidence", async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>')
  Object.assign(globalThis, {
    document,
    Event: window.Event,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLDetailsElement: window.HTMLDetailsElement,
    HTMLElement: window.HTMLElement,
    HTMLOutputElement: window.HTMLOutputElement,
    HTMLPreElement: window.HTMLPreElement
  })
  const { everyCassetteSettledEvent, singleCassetteSettledEvent } = await import("./entry.ts")
  const buttons = [...document.querySelectorAll("button")]
  const runAll = buttons[0]
  const runOne = buttons[1]
  if (runAll === undefined || runOne === undefined) throw new Error("The browser commands are missing")
  assert(runAll?.textContent === "Run all cassettes", "The browser must expose the Run all command")
  assert(runOne?.textContent === "Run cassette", "Each rendered row must expose its single-run command")
  assert(document.querySelectorAll("article").length === expectedCatalogSize, "The entry must render every catalog row")
  const root = document.getElementById("root")
  if (root === null) throw new Error("The browser root is missing")

  const settled = (eventName: string): Promise<void> =>
    new Promise((resolve) => root.addEventListener(eventName, () => resolve(), { once: true }))

  const singleSettled = settled(singleCassetteSettledEvent)
  runOne.click()
  await singleSettled
  const oneRow = runOne.closest("article")
  const oneStatus = oneRow?.querySelector("output")
  assert(oneStatus?.textContent?.includes("items") === true, "The single-run command must render consumed progress")
  assert((oneRow?.querySelector("pre")?.textContent?.length ?? 0) > 2, "The single-run command must render production evidence")

  runAllBrowserCommand = async () => {
    const everySettled = settled(everyCassetteSettledEvent)
    runAll.click()
    await everySettled
    return {
      everyRowCompleted: [...document.querySelectorAll("article output")].every(({ textContent }) =>
        textContent?.startsWith("completed")
      ),
      everyRowHasEvidence: [...document.querySelectorAll("article pre")].every(({ textContent }) =>
        (textContent?.length ?? 0) > 2
      ),
      summaryText: document.querySelector(".controls output")?.textContent ?? null
    }
  }
})

await scenario("the Run all command retains one terminal result for every catalog entry", async () => {
  if (runAllBrowserCommand === undefined) throw new Error("The browser Run all command is missing")
  const rendered = await runAllBrowserCommand()
  const expectedSummary = `${expectedCatalogSize} completed · 0 failed · ${expectedCatalogSize} total`
  assert(rendered.summaryText === expectedSummary, "Run all must retain the exact terminal summary")
  assert(rendered.everyRowCompleted, "Run all must render one completed terminal result in every row")
  assert(rendered.everyRowHasEvidence, "Run all must retain production execution evidence in every row")
})

await scenario("reruns one maintained cassette with fresh production identity", async () => {
  const first = everyResult.find(({ catalogKey }) => catalogKey === "authored:singletonTaskCompletes")
  const repeated = await runMaintainedCassette("authored:singletonTaskCompletes")
  assert(first?._tag === "Completed" && repeated._tag === "Completed", "The maintained authored cassette must rerun")
  if (first?._tag === "Completed" && repeated._tag === "Completed") {
    assert(first.runId !== repeated.runId, "A repeat must allocate a fresh production Run identity")
  }
})

console.log(`Reducer Lab ran ${everyResult.length} maintained cassettes through production.`)

// Drop the retained evidence after all browser-command assertions have inspected it.
everyResult = []
