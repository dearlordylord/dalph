import { maintainedAuthoredCassetteCatalog } from "../../../packages/dalph/src/cassettes/catalog.ts"
import { maintainedIntegrationFinalityProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts"
import { maintainedTargetPromotionProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/target-promotion-protocol-cassette-domain.ts"
import { parseHTML } from "linkedom"
import {
  cassetteRowSettledEvent,
  everyCassetteSettledEvent,
  mountCassetteLab,
  shownCassettesSettledEvent,
  singleCassetteSettledEvent
} from "./cassette-lab-browser.ts"
import {
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
let mismatchedResult: Awaited<ReturnType<typeof runAuthoredCassetteInput>> | undefined

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
      assert(
        result.deliveryFrames !== null && result.deliveryFrames.length > 0,
        `${result.catalogKey} must retain production delivery publications`
      )
    } else {
      assert(result.deliveryFrames === null, `${result.catalogKey} must not fabricate graph-level delivery frames`)
    }
  }
})

await scenario("captures every authored delivery frame from the real production publication and delivery composition", () => {
  const authored = everyResult.filter((result) => result._tag === "Completed" && result.category === "Authored")
  assert(authored.length === Object.keys(maintainedAuthoredCassetteCatalog).length, "Every authored catalog entry must complete")
  for (const result of authored) {
    if (result._tag !== "Completed" || result.deliveryFrames === null) continue
    assert(result.deliveryFrames[0]?.graph._tag === "NotEstablished", `${result.catalogKey} must retain the current-first production publication`)
    assert(
      result.deliveryFrames.some(({ graph }) => graph._tag === "Established"),
      `${result.catalogKey} must retain a production-established graph publication`
    )
    assert(
      result.deliveryFrames.every(({ settlements, trackerReflection }) =>
        trackerReflection._tag === "DeliveryReflection"
        && trackerReflection.settlementCount === settlements.length
      ),
      `${result.catalogKey} must retain the final tracker-reflection layer`
    )
  }
})

await scenario("keeps a dependant blocked after executor completion until a later tracker observation", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The dependant story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const heldA = result.deliveryFrames.findIndex(({ heldPositions }) => heldPositions.some(({ taskId }) => taskId === "A"))
  const releasedButBlocked = result.deliveryFrames.findIndex((frame, index) =>
    index > heldA
    && !frame.heldPositions.some(({ taskId }) => taskId === "A")
    && frame.frontier.some(({ reasons, standing, taskId }) =>
      taskId === "B" && standing === "Excluded" && reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
    )
  )
  const dependantEligible = result.deliveryFrames.findIndex((frame, index) =>
    index > releasedButBlocked
    && frame.frontier.some(({ standing, taskId }) => taskId === "B" && standing === "Eligible")
  )
  assert(heldA >= 0, "A must visibly hold the exact task-work position")
  assert(releasedButBlocked > heldA, "B must remain blocked after A releases its process-local position")
  assert(dependantEligible > releasedButBlocked, "Only the later completed tracker graph may release B")
})

await scenario("separates desired tickets from exact held task-work positions", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The bounded story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  assert(
    result.deliveryFrames.some((frame) =>
      frame.tickets.some(({ placement, taskId }) => taskId === "A" && placement.kind === "Selected")
      && !frame.heldPositions.some(({ taskId }) => taskId === "A")
    ),
    "A desired ticket must be visible before a process-local position is held"
  )
  assert(
    result.deliveryFrames.some((frame) => frame.heldPositions.some(({ taskId }) => taskId === "A")),
    "The later exact A position must remain a separate runtime fact"
  )
})

await scenario("separates Fresh and Recovered delivery frames across authored coordinator death", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:runPauseRestartsPassively")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The recovery story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const firstRecovered = result.deliveryFrames.findIndex(({ activation }) => activation === "Recovered")
  assert(firstRecovered > 0, "Recovered publications must follow Fresh publications")
  assert(result.deliveryFrames.slice(0, firstRecovered).every(({ activation }) => activation === "Fresh"), "Activation frames must retain their boundary")
})

await scenario("keeps a paused task held until the exact safe-suspension report", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:taskPauseLetsIndependentTaskContinue")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The task-pause story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const safeSuspensionPosition = maintainedAuthoredCassetteCatalog.taskPauseLetsIndependentTaskContinue.story
    .findIndex((item) =>
      item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "SafelySuspended"
    )
  assert(safeSuspensionPosition >= 0, "The maintained pause story must declare safe suspension")
  const beforeSafeSuspension = result.deliveryFrames.find(({ storyPosition }) =>
    storyPosition === safeSuspensionPosition
  )
  const afterSafeSuspension = result.deliveryFrames.find(({ storyPosition }) =>
    storyPosition === safeSuspensionPosition + 1
  )
  assert(
    beforeSafeSuspension?.heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0") === true,
    "Pause direction and a Running report must leave A holding its exact position"
  )
  assert(
    afterSafeSuspension?.heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0") === false,
    "Only the exact SafelySuspended report may release A's position"
  )
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
  mismatchedResult = mismatched
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
  assert(
    resultStatusText(mismatched).includes("item 3 (TrackerGraphReadReturned, index 2)"),
    "The browser status must expose human and zero-based failure positions"
  )
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
    maintainedCassetteRows.every(({ controlledBoundaries, runnerName }) =>
      controlledBoundaries.length > 0 && runnerName.startsWith("run")
    ),
    "Every browser row must identify controlled boundaries and its production runner"
  )
  for (const result of everyResult) {
    assert(resultStatusText(result).includes(`${result.totalItemCount}/${result.totalItemCount}`), `${result.catalogKey} must render complete progress`)
    assert(resultEvidenceText(result).length > 2, `${result.catalogKey} must render execution evidence`)
  }
  assert(everyResult.length === maintainedCassetteRows.length, "Run all must retain one result per rendered row")
  assert(
    runAllSummaryText(everyResult)
      === `${expectedCatalogSize} completed · 0 failed · 0 Lab defects · ${expectedCatalogSize} total`,
    "Run all must render the exact completed, failed, and total counts"
  )
})

const installDom = () => {
  const { document, window } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>')
  Object.assign(globalThis, {
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    document,
    Event: window.Event,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLDetailsElement: window.HTMLDetailsElement,
    HTMLElement: window.HTMLElement,
    HTMLOutputElement: window.HTMLOutputElement,
    HTMLPreElement: window.HTMLPreElement
  })
  const root = document.getElementById("root")
  if (root === null) throw new Error("The browser root is missing")
  const settled = (eventName: string): Promise<void> =>
    new Promise((resolve) => root.addEventListener(eventName, () => resolve(), { once: true }))
  return { document, root, settled }
}

const resultByKey = new Map(everyResult.map((result) => [result.catalogKey, result]))
const cannedRunner = async (catalogKey: (typeof maintainedCassetteKeys)[number]) => {
  const result = resultByKey.get(catalogKey)
  if (result === undefined) throw new Error(`Missing real production result for ${catalogKey}`)
  return result
}

await scenario("shows only information that selects, explains, or diagnoses a maintained cassette", () => {
  const { document, root } = installDom()
  mountCassetteLab({ revision: "acceptance-revision+dirty", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  assert(document.title === "Dalph reducer lab", "The tab title must name the reducer Lab")
  assert(
    document.querySelector("[data-role='safety-context']")?.textContent?.includes("no GitHub issue, Git repository, executor process, or durable journal is changed") === true,
    "The Lab must state the concrete safety boundary"
  )
  assert(document.querySelector("[data-role='source-revision']")?.textContent?.includes("acceptance-revision+dirty") === true, "The Lab must identify its source revision")
  assert(
    document.querySelectorAll("[data-role='catalog-group']").length === 3,
    "The maintained rows must be grouped by their three production runners"
  )
  assert(
    document.querySelector("article [data-role='execution-evidence']") === null,
    "An unrun cassette must not expose an empty evidence panel"
  )
  assert(document.querySelectorAll("article").length === expectedCatalogSize, "The entry must render every catalog row")
  const first = document.querySelector("article")
  assert(first?.querySelector("h3")?.textContent === maintainedCassetteRows[0]?.storyName, "The human story name must be primary")
  assert(first?.querySelector("h3")?.textContent?.includes("authored:") === false, "The prefixed key must not duplicate category in the heading")
  assert(first?.querySelector(".catalog-key")?.textContent?.includes("authored:") === true, "Each row must retain its exact lookup key")
  const groupFacts = document.querySelector(".group-facts")?.textContent ?? ""
  assert(groupFacts.includes("Production runner") && groupFacts.includes("Controlled boundaries"), "Catalog-level facts must explain execution and safety once")
  assert(first?.querySelector("[data-role='declared-chronology']")?.textContent?.includes("not observed execution evidence") === true, "Declared input must be labelled separately from observed output")
  assert(document.querySelectorAll("[data-role='exact-declared-input'] pre").length === expectedCatalogSize, "Exact declared input must be available for every cassette")
  assert(document.querySelector("[data-role='completion-legend']")?.textContent?.includes("matched the declared end") === true, "Completion must not imply that the modeled operation succeeded")
  assert(document.querySelector("input[type='search']") !== null && document.querySelectorAll("select").length === 2, "Selection controls must include catalog and status")
})

await scenario("shows an authored cassette declared graph only as input before production observes it", () => {
  const { document, root } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  const authoredCount = maintainedCassetteRows.filter(({ category }) => category === "Authored").length
  assert(document.querySelectorAll("[data-role='delivery-workbench']").length === authoredCount, "Every authored row must expose the delivery workbench")
  assert(document.querySelector("[data-role='delivery-frame']") === null, "Declared input must not become an observed delivery frame")
  const closed = document.querySelector<HTMLDetailsElement>("[data-role='delivery-workbench']")
  assert(closed?.querySelector("dalph-delivery-graph") === null, "A closed workbench must not eagerly construct a graph")
  if (closed === null) throw new Error("The authored workbench is missing")
  closed.open = true
  closed.dispatchEvent(new Event("toggle"))
  const first = document.querySelector("[data-role='delivery-workbench']")
  assert(first?.textContent?.includes("not yet observed") === true, "Derived delivery facts must remain explicitly unobserved")
  const graph = first?.querySelector("dalph-delivery-graph") as (HTMLElement & { projection?: { readonly key: string } }) | null
  assert(graph?.projection?.key.startsWith("declared:") === true, "The pre-run graph must identify itself as controlled declared input")
})

await scenario("shows the production-observed graph frontier bounded tickets and held positions", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  if (row === undefined) throw new Error("The dependant delivery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .row-controls button") as HTMLButtonElement | null)?.click()
  await done
  const workbench = document.querySelector("[data-role='delivery-workbench']")
  const result = resultByKey.get(row.catalogKey)
  if (result?._tag !== "Completed" || result.deliveryFrames === null) throw new Error("The real delivery frames are missing")
  const establishedIndex = result.deliveryFrames.findIndex((frame) =>
    frame.graph._tag === "Established"
    && frame.heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0")
  )
  const timeline = workbench?.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null || establishedIndex < 0) throw new Error("The production delivery timeline is missing")
  for (const option of timeline.options) {
    if (option.value === String(establishedIndex)) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  timeline.dispatchEvent(new Event("change"))
  const graph = workbench?.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly key: string; readonly tasks: ReadonlyArray<{ readonly id: string }> }
  }) | null
  assert(graph?.projection?.key.startsWith("observed:") === true, "The selected graph must come from a production delivery frame")
  assert(graph?.projection?.tasks.some(({ id }) => id === "A") === true, "The observed graph must render its production tasks")
  assert(graph?.projection?.tasks.every((task) => !("title" in task)) === true, "Observed graph nodes must not borrow declared task text")
  const stateTable = workbench?.querySelector("[data-role='delivery-task-state']")
  assert(stateTable?.textContent?.includes("PrerequisitesIncomplete") === true, "The exhaustive frontier must explain B's exclusion")
  assert(stateTable?.textContent?.includes("prerequisiteTaskIds") === true, "The exact frontier exclusion must retain its prerequisite payload")
  assert(stateTable?.textContent?.includes("Selected #0") === true, "The bounded ticket placement must be visible")
  assert(workbench?.textContent?.includes("tracker reflection") === true, "The workbench must expose the complete production layer chain")
  const headers = [...stateTable?.querySelectorAll("th") ?? []].map(({ textContent }) => textContent)
  assert(headers.includes("Desired bounded ticket") && headers.includes("Actual held position"), "Desired tickets and exact held positions must have distinct columns")
  assert(headers.includes("Ticket-delivery evidence / standing / obligation"), "Every ticket-delivery layer must remain visible")
  assert(
    [...workbench?.querySelectorAll("[data-role='delivery-frame'] pre") ?? []].some(({ textContent }) =>
      textContent?.includes("attempt:A:0")
    ),
    "Exact responsibility evidence must retain its attempt correlation"
  )
  assert(workbench?.querySelector(".delivery-frame-change")?.textContent?.includes("held positions changed for A") === true, "The selected frame must explain its change from the prior publication")
  graph?.dispatchEvent(new CustomEvent("task-selected", { detail: { taskId: "A" } }))
  assert(workbench?.querySelector("tr[data-task-id='A']")?.classList.contains("selected-task-row") === true, "Graph task selection must highlight the matching exact task row")
  ;([...workbench?.querySelectorAll("button") ?? []].find(({ textContent }) => textContent === "Next frame") as HTMLButtonElement | undefined)?.click()
  assert(workbench?.querySelector("tr[data-task-id='A']")?.getAttribute("aria-current") === "true", "Task selection must remain synchronized across frame navigation")

  const search = document.querySelector("input[type='search']") as HTMLInputElement | null
  if (search === null) throw new Error("The delivery search control is missing")
  search.value = "PrerequisitesIncomplete"
  search.dispatchEvent(new Event("input"))
  assert(document.querySelector(".search-match-reason")?.textContent?.includes("returned production delivery evidence") === true, "Search must explain matches in returned delivery evidence")
})

await scenario("does not fabricate a graph workbench for direct protocol cassettes", () => {
  const { document, root } = installDom()
  const protocolRows = maintainedCassetteRows.filter(({ category }) => category !== "Authored")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: protocolRows, runCassette: cannedRunner })
  assert(document.querySelector("[data-role='delivery-workbench']") === null, "Direct protocol runners must not display invented graph-level delivery state")
  assert(document.querySelector(".group-facts")?.textContent?.includes("does not publish the graph-level delivery relation") === true, "The direct protocol group must explain why no graph workbench applies")
})

await scenario("shows grouping relationships exact obligations and settlement state", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:taskPauseCoversGroupingChild")
  if (row === undefined) throw new Error("The grouping delivery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .row-controls button") as HTMLButtonElement | null)?.click()
  await done
  const result = resultByKey.get(row.catalogKey)
  if (result?._tag !== "Completed" || result.deliveryFrames === null) throw new Error("Grouping frames are missing")
  const groupingIndex = result.deliveryFrames.findIndex((frame) =>
    frame.graph._tag === "Established"
    && frame.graph.tasks.some(({ parentTaskId }) => parentTaskId !== null)
    && frame.deliveries.some(({ obligations }) => obligations.length > 0)
  )
  const workbench = document.querySelector("[data-role='delivery-workbench']")
  const select = workbench?.querySelector("select") as HTMLSelectElement | null
  if (select === null || groupingIndex < 0) throw new Error("Grouping timeline controls are missing")
  for (const option of select.options) {
    if (option.value === String(groupingIndex)) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  select.dispatchEvent(new Event("change"))
  const graph = workbench?.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly edges: ReadonlyArray<{ readonly kind: string }> }
  }) | null
  assert(graph?.projection?.edges.some(({ kind }) => kind === "Grouping") === true, "The production-observed parent relation must render as a grouping edge")
  assert(workbench?.textContent?.includes("Exact obligations") === true, "Ticket-delivery obligations must be explicitly inspectable")
  assert(workbench?.textContent?.includes("Settlement") === true, "Every task must expose its current delivery-settlement state")
})

await scenario("searches declared behavior without changing the maintained run-all catalog", async () => {
  const { document, root, settled } = installDom()
  const calls: Array<string> = []
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: maintainedCassetteRows,
    runCassette: async (key) => {
      calls.push(key)
      return cannedRunner(key)
    }
  })
  const search = document.querySelector("input[type='search']") as HTMLInputElement | null
  const category = document.querySelector("select") as HTMLSelectElement | null
  if (search === null || category === null) throw new Error("Search controls are missing")
  search.value = "expected behavior"
  search.dispatchEvent(new Event("input"))
  const visibleAfterTag = [...document.querySelectorAll("article")].filter((article) => !article.hasAttribute("hidden")).length
  assert(
    visibleAfterTag > 0 && visibleAfterTag < expectedCatalogSize,
    `Story-item tags must narrow the catalog: value=${search.value}; tags=${maintainedCassetteRows[0]?.storyItemTags.join(",")}; visible=${visibleAfterTag}; ${document.querySelector("[data-role='visibility-summary']")?.textContent}`
  )
  const firstRow = maintainedCassetteRows[0]
  const visibleFirstRowText = [
    firstRow?.storyName,
    firstRow?.catalogKey,
    firstRow?.categoryLabel,
    firstRow?.runnerName,
    firstRow?.controlledBoundaries,
    ...(firstRow?.storyItemSummaries ?? [])
  ].join(" ").toLocaleLowerCase()
  const hiddenInputToken = firstRow?.declaredInputText.match(/[A-Za-z][A-Za-z0-9_-]{8,}/gu)
    ?.find((token) => !visibleFirstRowText.includes(token.toLocaleLowerCase()))
  if (hiddenInputToken === undefined) throw new Error("The search fixture needs a value present only in exact input")
  search.value = hiddenInputToken
  search.dispatchEvent(new Event("input"))
  assert(
    [...document.querySelectorAll(".search-match-reason")].some((reason) => !reason.hasAttribute("hidden") && reason.textContent?.toLocaleLowerCase().includes(hiddenInputToken.toLocaleLowerCase())),
    "A match found only in exact input must explain why the row is visible"
  )
  search.value = ""
  search.dispatchEvent(new Event("input"))
  assert(document.querySelector("[data-role='run-announcement']")?.textContent === `Showing all ${expectedCatalogSize} maintained cassettes`, "Clearing the final filter must announce restoration of the complete catalog")
  category.querySelector("option[value='All']")?.removeAttribute("selected")
  category.querySelector("option[value='IntegrationFinality']")?.setAttribute("selected", "")
  category.dispatchEvent(new Event("change"))
  const finalityCount = maintainedCassetteRows.filter(({ category }) => category === "IntegrationFinality").length
  assert(
    [...document.querySelectorAll("article")].filter((article) => !article.hasAttribute("hidden")).length
      === finalityCount,
    "The category filter must show the exact owning catalog"
  )
  const shownSettled = settled(shownCassettesSettledEvent)
  const runShown = [...document.querySelectorAll("button")].find(({ textContent }) => textContent === `Run shown (${finalityCount})`)
  const aggregate = document.querySelector("[data-role='catalog-summary']") as HTMLOutputElement | null
  let aggregateFocused = false
  if (aggregate !== null) aggregate.focus = () => { aggregateFocused = true }
  runShown?.click()
  await shownSettled
  assert(calls.length === finalityCount, "Run shown must execute exactly the currently visible catalog subset")
  assert(aggregateFocused, "Run shown must move focus to its terminal aggregate before it can disappear")
  const finalityRow = maintainedCassetteRows.find(({ category }) => category === "IntegrationFinality")
  const finalityResult = finalityRow === undefined ? undefined : resultByKey.get(finalityRow.catalogKey)
  if (finalityRow === undefined || finalityResult?._tag !== "Completed") {
    throw new Error("A completed direct-protocol result is required")
  }
  const visibleFinalityText = `${finalityRow.storyName} ${finalityRow.catalogKey} ${finalityRow.declaredInputText}`
    .toLocaleLowerCase()
  const returnedOnlyToken = resultEvidenceText(finalityResult).match(/[A-Za-z][A-Za-z0-9_-]{8,}/gu)
    ?.find((token) => !visibleFinalityText.includes(token.toLocaleLowerCase()))
  if (returnedOnlyToken === undefined) throw new Error("The direct-protocol search fixture needs a returned-only fact")
  search.value = returnedOnlyToken
  search.dispatchEvent(new Event("input"))
  assert(
    [...document.querySelectorAll(".search-match-reason")].some((reason) =>
      !reason.hasAttribute("hidden") && reason.textContent?.includes("returned production delivery evidence")
    ),
    "Returned direct-protocol facts must be searchable and explain their source"
  )
  search.value = ""
  search.dispatchEvent(new Event("input"))
  const allSettled = settled(everyCassetteSettledEvent)
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  await allSettled
  assert(calls.length === finalityCount + expectedCatalogSize, "Run all must execute the full catalog independently of filtering")
})

await scenario("keeps batch progress concise for keyboard and nonvisual maintainers", () => {
  const { document, root } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  const rowButtons = [...document.querySelectorAll("article button")]
  const rowActionNames = rowButtons.map((button) => button.getAttribute("aria-label"))
  assert(rowActionNames.every((name) => name !== null && name.length > 0), "Every repeated row action must have an accessible name")
  assert(new Set(rowActionNames).size === expectedCatalogSize, "Every repeated row action must have a unique accessible name")
  assert(document.querySelector("[data-role='catalog-summary']")?.getAttribute("aria-live") === null, "Per-row batch settlements must not create a live-region announcement storm")
  assert(document.querySelector("[data-role='visibility-summary']")?.getAttribute("aria-live") === null, "Filter counts must not announce once per batch settlement")
  assert(document.querySelector("[data-role='run-announcement'][aria-live='polite']") !== null, "Batch start and finish must have one dedicated announcement channel")
})

await scenario("replaces stale evidence with live per-row progress and settles rows independently", async () => {
  const { document, root, settled } = installDom()
  const rows = maintainedCassetteRows.slice(0, 2)
  const results = rows.map(({ catalogKey }) => resultByKey.get(catalogKey))
  if (results[0] === undefined || results[1] === undefined) throw new Error("Two real results are required")
  const firstResult = results[0]
  const secondResult = results[1]
  let resolveFirst: ((result: typeof firstResult) => void) | undefined
  let resolveSecond: ((result: typeof secondResult) => void) | undefined
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows,
    runCassette: (key) => new Promise((resolve) => {
      if (key === rows[0]?.catalogKey) resolveFirst = resolve
      else resolveSecond = resolve
    })
  })
  const statusFilter = document.querySelectorAll("select")[1] as HTMLSelectElement | undefined
  if (statusFilter === undefined) throw new Error("The status filter is missing")
  statusFilter.querySelector("option[value='All']")?.removeAttribute("selected")
  statusFilter.querySelector("option[value='Running']")?.setAttribute("selected", "")
  statusFilter.dispatchEvent(new Event("change"))
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  assert([...document.querySelectorAll("article")].every(({ dataset }) => dataset.state === "Running"), "Every affected row must become running immediately")
  assert([...document.querySelectorAll("article")].every((article) => !article.hasAttribute("hidden")), "The Running status filter must reveal newly running rows immediately")
  assert([...document.querySelectorAll("article output")].every((output) => output.getAttribute("aria-live") === "off"), "Batch row updates must use the single aggregate announcement channel")
  assert(document.querySelector("[data-role='execution-evidence']") === null, "Previous evidence must be absent while rerunning")
  const firstSettled = settled(cassetteRowSettledEvent)
  resolveFirst?.(firstResult)
  await firstSettled
  const articles = [...document.querySelectorAll("article")]
  assert(articles[0]?.dataset.state === "Completed", "The first row must render as soon as it settles")
  assert(articles[0]?.hasAttribute("hidden") === true, "A settled row must immediately leave the Running status view")
  assert(articles[1]?.dataset.state === "Running", "The slower row must remain visibly running")
  const everySettled = settled(everyCassetteSettledEvent)
  resolveSecond?.(secondResult)
  await everySettled
})

await scenario("presents concise execution proof before chronological journal and raw output", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:runPauseRestartsPassively")
  if (row === undefined) throw new Error("The recovery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: runMaintainedCassette })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article button") as HTMLButtonElement | null)?.click()
  await done
  const evidence = document.querySelector("[data-role='execution-evidence']")
  const facts = evidence?.querySelector(".execution-facts")?.textContent ?? ""
  assert(facts.includes("runAuthoredScenarioCassette"), "Execution proof must name the exact production runner")
  assert(facts.includes("Fresh → Recovered"), "Execution proof must show recovery activations")
  assert(facts.includes("Run identity"), "Authored execution proof must show its Run identity")
  assert((evidence?.querySelectorAll("[data-role='journal-chronology'] tbody tr").length ?? 0) > 0, "Journal evidence must be chronological within a Run")
  assert(evidence?.querySelector("[data-role='journal-chronology'] caption") !== null, "Journal evidence must name its ordering scope")
  assert([...evidence?.querySelectorAll("[data-role='journal-chronology'] th") ?? []].every((cell) => cell.getAttribute("scope") === "col"), "Journal columns must expose header scope")
  assert(evidence?.querySelector("[data-role='journal-chronology'] tbody details pre") !== null, "Each journal row must retain its exact event")
  assert(evidence?.querySelector("[data-role='raw-execution-result']") !== null, "Raw output must remain secondary and explicitly labelled")
  assert(evidence?.textContent?.includes("Production journal evidence") === false, "The UI must not mislabel the complete execution result")
})

await scenario("links, reveals, and retries cassette failures and Lab defects", async () => {
  const { document, root, settled } = installDom()
  if (mismatchedResult?._tag !== "Failed") throw new Error("The real mismatch result is missing")
  const failureResult = mismatchedResult
  const rows = maintainedCassetteRows.slice(0, 2)
  const calls = new Map<string, number>()
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows,
    runCassette: async (key) => {
      const count = (calls.get(key) ?? 0) + 1
      calls.set(key, count)
      if (key === rows[0]?.catalogKey) return count === 1 ? failureResult : cannedRunner(key)
      throw new Error("synthetic browser composition rejection")
    }
  })
  const allSettled = settled(everyCassetteSettledEvent)
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  await allSettled
  const problemLink = document.querySelector("[data-role='problem-links'] a") as HTMLAnchorElement | null
  assert(problemLink?.textContent?.includes(rows[0]?.storyName ?? "") === true, "The aggregate must link a failed cassette by human story and exact key")
  assert([...document.querySelectorAll("article")][1]?.dataset.state === "LabDefect", "An unexpected rejection must be distinct from a cassette failure")
  assert([...document.querySelectorAll("button")].every(({ disabled }) => !disabled), "A Lab defect must restore usable controls")
  const search = document.querySelector("input[type='search']") as HTMLInputElement | null
  if (search === null || problemLink === null) throw new Error("Problem navigation controls are missing")
  search.value = "no such story"
  search.dispatchEvent(new Event("input"))
  const targetHeading = [...document.querySelectorAll("article h3")][0] as HTMLHeadingElement | undefined
  let headingFocused = false
  if (targetHeading !== undefined) targetHeading.focus = () => { headingFocused = true }
  problemLink.click()
  assert(search.value === "" && !([...document.querySelectorAll("article")][0]?.hasAttribute("hidden") ?? true), "Problem navigation must clear filters that conceal its row")
  assert(headingFocused, "Problem navigation must focus the revealed story heading")
  const rerun = [...document.querySelectorAll("button")].find(({ textContent }) => textContent === "Retry problem rows")
  rerun?.click()
  await Promise.all([settled(cassetteRowSettledEvent), settled(cassetteRowSettledEvent)])
  assert(calls.get(rows[0]?.catalogKey ?? "") === 2, "Retry problems must repeat the typed cassette failure")
  assert(calls.get(rows[1]?.catalogKey ?? "") === 2, "Retry problems must repeat the separate Lab defect")
})

await scenario("offers an explicit reload escape while a runner is still waiting", () => {
  const { document, root } = installDom()
  let reloadCount = 0
  mountCassetteLab({
    reloadLab: () => { reloadCount += 1 },
    revision: "acceptance-revision",
    root,
    rows: maintainedCassetteRows.slice(0, 1),
    runCassette: () => new Promise(() => undefined)
  })
  ;(document.querySelector("article button") as HTMLButtonElement | null)?.click()
  const reload = [...document.querySelectorAll("button")].find(({ textContent }) => textContent === "Reload Lab and discard displayed results")
  assert(reload?.hidden === false, "A waiting invocation must expose a recovery action")
  reload?.click()
  assert(reloadCount === 1, "The recovery action must reload the isolated Lab")
})

await scenario("the real browser entry runs every maintained cassette and retains every terminal result", async () => {
  const { document, root, settled } = installDom()
  await import("./entry.ts")
  const allSettled = settled(everyCassetteSettledEvent)
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  await allSettled
  assert([...document.querySelectorAll("article")].every(({ dataset }) => dataset.state === "Completed"), "The real entry must complete every maintained row")
  assert(document.querySelectorAll("[data-role='execution-evidence']").length === expectedCatalogSize, "The real entry must retain every terminal result")
  assert([...document.querySelectorAll<HTMLDetailsElement>("[data-role='delivery-workbench']")].every(({ open }) => !open), "Run all must keep graph workbenches collapsed")
  assert([...document.querySelectorAll("[data-role='delivery-workbench']")].every((workbench) => workbench.querySelector("dalph-delivery-graph") === null), "Collapsed Run-all workbenches must remain lazy")
  assert([...document.querySelectorAll<HTMLDetailsElement>("[data-role='execution-evidence']")].every(({ open }) => !open), "Run all must keep successful terminal evidence collapsed")
  assert(root.querySelector("[data-role='catalog-summary']")?.textContent?.startsWith(`${expectedCatalogSize} completed`) === true, "The real entry must show the complete catalog summary")
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
