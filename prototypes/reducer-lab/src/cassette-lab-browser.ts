import {
  type CassetteCategory,
  type CassetteLabResult,
  type maintainedCassetteRows,
  type MaintainedCassetteKey
} from "./cassette-lab.ts"
import {
  catalogSummaryText,
  type CassetteRowState,
  executionSummaryItems,
  journalEvidenceRows,
  protocolDiagnosticItems,
  resultEvidenceText,
  rowStateStatusText
} from "./cassette-lab-view.ts"

export const singleCassetteSettledEvent = "dalph-cassette-lab:single-settled"
export const everyCassetteSettledEvent = "dalph-cassette-lab:every-settled"
export const cassetteRowSettledEvent = "dalph-cassette-lab:row-settled"
export const shownCassettesSettledEvent = "dalph-cassette-lab:shown-settled"

type CassetteRow = (typeof maintainedCassetteRows)[number]
type StatusFilter = "All" | "Completed" | "Failed" | "LabDefect" | "NotRun" | "Running"

export interface CassetteLabBrowserInput {
  readonly reloadLab?: () => void
  readonly revision: string
  readonly root: HTMLElement
  readonly rows: ReadonlyArray<CassetteRow>
  readonly runCassette: (catalogKey: MaintainedCassetteKey) => Promise<CassetteLabResult>
}

interface RowElements {
  readonly article: HTMLElement
  readonly evidenceHost: HTMLElement
  readonly heading: HTMLHeadingElement
  readonly matchReason: HTMLElement
  readonly runButton: HTMLButtonElement
  readonly searchableText: ReadonlyArray<{ readonly element: HTMLElement; readonly text: string }>
  readonly status: HTMLOutputElement
  readonly storyItems: ReadonlyArray<HTMLLIElement>
}

interface GroupElements {
  readonly group: HTMLElement
  readonly heading: HTMLHeadingElement
  readonly label: string
  readonly total: number
}

const categoryOrder: ReadonlyArray<CassetteCategory> = ["Authored", "TargetPromotion", "IntegrationFinality"]

const appendTextElement = <K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  textContent: string,
  className?: string
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)
  element.textContent = textContent
  if (className !== undefined) element.className = className
  parent.append(element)
  return element
}

const renderDefinitionList = (
  parent: HTMLElement,
  items: ReadonlyArray<{ readonly description: string; readonly term: string }>
): void => {
  const list = document.createElement("dl")
  list.className = "execution-facts"
  for (const { description, term } of items) {
    appendTextElement(list, "dt", term)
    appendTextElement(list, "dd", description)
  }
  parent.append(list)
}

const renderJournalTable = (
  parent: HTMLElement,
  runId: string,
  rows: ReturnType<typeof journalEvidenceRows>,
  multipleRuns: boolean
): void => {
  if (multipleRuns) appendTextElement(parent, "h6", `Run ${runId}`)
  const table = document.createElement("table")
  table.dataset.role = "journal-chronology"
  appendTextElement(
    table,
    "caption",
    multipleRuns
      ? `Chronological workflow-journal evidence within Run ${runId}`
      : "Chronological workflow-journal evidence"
  )
  const head = document.createElement("thead")
  const headingRow = document.createElement("tr")
  for (const heading of ["Position", "Event", "Correlation and context", "Raw event"]) {
    const cell = appendTextElement(headingRow, "th", heading)
    cell.setAttribute("scope", "col")
  }
  head.append(headingRow)
  const body = document.createElement("tbody")
  for (const row of rows) {
    const tableRow = document.createElement("tr")
    appendTextElement(tableRow, "td", row.position)
    appendTextElement(tableRow, "td", row.eventTag)
    appendTextElement(tableRow, "td", row.context)
    const rawCell = document.createElement("td")
    const raw = document.createElement("details")
    appendTextElement(raw, "summary", "Event JSON")
    appendTextElement(raw, "pre", row.rawEvent)
    rawCell.append(raw)
    tableRow.append(rawCell)
    body.append(tableRow)
  }
  table.append(head, body)
  parent.append(table)
}

const renderJournal = (parent: HTMLElement, result: CassetteLabResult): void => {
  const evidence = journalEvidenceRows(result)
  if (evidence.length === 0) return
  const runIds = [...new Set(evidence.map(({ runId }) => runId))]
  appendTextElement(parent, "h5", runIds.length === 1 ? "Journal chronology" : "Journal records by Run identity")
  for (const runId of runIds) {
    renderJournalTable(parent, runId, evidence.filter((row) => row.runId === runId), runIds.length > 1)
  }
}

const renderRawEvidence = (parent: HTMLElement, result: CassetteLabResult): void => {
  const details = document.createElement("details")
  details.dataset.role = result._tag === "Failed" ? "raw-diagnostic" : "raw-execution-result"
  appendTextElement(details, "summary", result._tag === "Failed" ? "Raw diagnostic" : "Raw execution result")
  appendTextElement(details, "pre", resultEvidenceText(result))
  parent.append(details)
}

const renderResultEvidence = (host: HTMLElement, result: CassetteLabResult): void => {
  host.replaceChildren()
  const evidence = document.createElement("section")
  evidence.className = "execution-evidence"
  evidence.dataset.role = "execution-evidence"
  appendTextElement(evidence, "h4", result._tag === "Completed" ? "Execution proof" : "Cassette failure")
  renderDefinitionList(evidence, executionSummaryItems(result))
  const protocolDiagnostics = protocolDiagnosticItems(result)
  if (protocolDiagnostics.length > 0) {
    const details = document.createElement("details")
    details.dataset.role = "protocol-diagnostics"
    appendTextElement(details, "summary", "Protocol diagnostics")
    renderDefinitionList(details, protocolDiagnostics)
    evidence.append(details)
  }
  renderJournal(evidence, result)
  renderRawEvidence(evidence, result)
  host.append(evidence)
}

const renderDefectEvidence = (host: HTMLElement, row: CassetteRow, detail: string): void => {
  host.replaceChildren()
  const evidence = document.createElement("section")
  evidence.className = "execution-evidence defect-evidence"
  evidence.dataset.role = "execution-evidence"
  appendTextElement(evidence, "h4", "Lab defect")
  renderDefinitionList(evidence, [
    { term: "Production runner", description: row.runnerName },
    { term: "Result", description: "No typed cassette result was returned" },
    { term: "Origin", description: "Not localized; inspect the raw diagnostic" },
    { term: "Defect", description: detail.split("\n")[0] ?? detail }
  ])
  const details = document.createElement("details")
  details.dataset.role = "raw-diagnostic"
  appendTextElement(details, "summary", "Raw diagnostic")
  appendTextElement(details, "pre", detail)
  evidence.append(details)
  host.append(evidence)
}

const defectDetail = (error: unknown): string => error instanceof Error ? error.stack ?? error.message : String(error)

const stateFilterValue = (state: CassetteRowState): StatusFilter => {
  if (state._tag !== "Settled") return state._tag
  return state.result._tag
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const markSearchTokens = (element: HTMLElement, text: string, tokens: ReadonlyArray<string>): void => {
  element.replaceChildren()
  if (tokens.length === 0) {
    element.textContent = text
    return
  }
  const expression = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "giu")
  for (const part of text.split(expression)) {
    if (part.length === 0) continue
    if (tokens.some((token) => part.toLocaleLowerCase() === token)) appendTextElement(element, "mark", part)
    else element.append(document.createTextNode(part))
  }
}

/** Mounts the maintainer-facing catalog without changing which production runners own cassette execution. */
export const mountCassetteLab = (input: CassetteLabBrowserInput): void => {
  const { revision, root, rows, runCassette } = input
  const reloadLab = input.reloadLab ?? (() => globalThis.location.reload())
  document.title = "Dalph cassette lab"
  const states = new Map<MaintainedCassetteKey, CassetteRowState>(
    rows.map(({ catalogKey }) => [catalogKey, { _tag: "NotRun" }])
  )
  const rowElements = new Map<MaintainedCassetteKey, RowElements>()
  const groupElements = new Map<CassetteCategory, GroupElements>()
  let busy = false
  let runShownActive = false
  let visibleKeys: ReadonlyArray<MaintainedCassetteKey> = rows.map(({ catalogKey }) => catalogKey)

  const header = document.createElement("header")
  appendTextElement(header, "h1", "Dalph cassette lab")
  const safety = appendTextElement(
    header,
    "p",
    "Local deterministic developer harness. Production coordinator and protocol code executes with controlled in-memory boundaries; no GitHub issue, Git repository, executor process, or durable journal is changed.",
    "safety-context"
  )
  safety.dataset.role = "safety-context"
  const revisionLine = appendTextElement(header, "p", "Source revision: ", "revision")
  revisionLine.dataset.role = "source-revision"
  appendTextElement(revisionLine, "code", revision)

  const controls = document.createElement("section")
  controls.className = "catalog-controls"
  controls.setAttribute("aria-label", "Cassette catalog controls and live results")
  const searchLabel = appendTextElement(controls, "label", "Search behavior")
  const search = document.createElement("input")
  search.type = "search"
  search.placeholder = "Words from a story, key, runner, or declared value"
  searchLabel.append(search)

  const categoryLabel = appendTextElement(controls, "label", "Catalog")
  const categoryFilter = document.createElement("select")
  const allCatalogs = document.createElement("option")
  allCatalogs.value = "All"
  allCatalogs.textContent = "All maintained catalogs"
  categoryFilter.append(allCatalogs)
  for (const category of categoryOrder) {
    const row = rows.find((candidate) => candidate.category === category)
    if (row === undefined) continue
    const option = document.createElement("option")
    option.value = category
    option.textContent = row.categoryLabel
    categoryFilter.append(option)
  }
  categoryLabel.append(categoryFilter)

  const statusLabel = appendTextElement(controls, "label", "Status")
  const statusFilter = document.createElement("select")
  for (const [value, label] of [
    ["All", "All statuses"],
    ["NotRun", "Not run"],
    ["Running", "Running"],
    ["Completed", "Cassette completed"],
    ["Failed", "Cassette failed"],
    ["LabDefect", "Lab defect"]
  ] as const) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    statusFilter.append(option)
  }
  statusLabel.append(statusFilter)

  const runAllButton = appendTextElement(controls, "button", `Run all ${rows.length} cassettes`)
  runAllButton.type = "button"
  runAllButton.title = "Runs every maintained cassette, regardless of the current filters"
  const runShownButton = appendTextElement(controls, "button", `Run shown (${rows.length})`, "secondary-action")
  runShownButton.type = "button"
  const retryProblemsButton = appendTextElement(controls, "button", "Retry problem rows", "secondary-action")
  retryProblemsButton.type = "button"
  retryProblemsButton.hidden = true
  const reloadButton = appendTextElement(
    controls,
    "button",
    "Reload Lab and discard displayed results",
    "danger-action"
  )
  reloadButton.type = "button"
  reloadButton.title = "Stops waiting by reloading this local harness; all displayed results and filters are discarded"
  reloadButton.hidden = true

  const completionLegend = appendTextElement(
    controls,
    "p",
    "Cassette completed means the production runner matched the declared end. The modeled operation may intentionally end in an expected protocol failure.",
    "completion-legend"
  )
  completionLegend.dataset.role = "completion-legend"
  const visibility = document.createElement("output")
  visibility.dataset.role = "visibility-summary"
  visibility.hidden = true
  const summary = document.createElement("output")
  summary.className = "catalog-summary"
  summary.dataset.role = "catalog-summary"
  const runAnnouncement = document.createElement("output")
  runAnnouncement.className = "visually-hidden"
  runAnnouncement.dataset.role = "run-announcement"
  runAnnouncement.setAttribute("aria-live", "polite")
  const problemLinks = document.createElement("nav")
  problemLinks.className = "problem-links"
  problemLinks.dataset.role = "problem-links"
  problemLinks.setAttribute("aria-label", "Cassette failures and Lab defects")
  problemLinks.hidden = true

  const resultsElement = document.createElement("div")
  resultsElement.className = "results"

  const currentStates = (): ReadonlyArray<CassetteRowState> =>
    rows.map(({ catalogKey }) => states.get(catalogKey) ?? { _tag: "NotRun" })

  let applyFilters = (_announceVisibility?: boolean): void => undefined

  const updateAggregate = (): void => {
    summary.textContent = catalogSummaryText(currentStates())
    const problems = rows.filter(({ catalogKey }) => {
      const state = states.get(catalogKey)
      return state?._tag === "LabDefect" || state?._tag === "Settled" && state.result._tag === "Failed"
    })
    problemLinks.replaceChildren()
    problemLinks.hidden = problems.length === 0
    retryProblemsButton.hidden = problems.length === 0
    if (problems.length === 0) return
    appendTextElement(problemLinks, "strong", "Problems: ")
    for (const [index, row] of problems.entries()) {
      const state = states.get(row.catalogKey)
      const link = document.createElement("a")
      link.href = `#cassette-${row.catalogKey.replaceAll(":", "-")}`
      const kind = state?._tag === "LabDefect" ? "Lab defect" : "cassette failure"
      link.textContent = `${row.storyName} (${row.catalogKey}; ${kind})`
      link.addEventListener("click", (event) => {
        event.preventDefault()
        search.value = ""
        for (const option of categoryFilter.options) option.selected = option.value === "All"
        for (const option of statusFilter.options) option.selected = option.value === "All"
        applyFilters(true)
        rowElements.get(row.catalogKey)?.heading.focus()
      })
      problemLinks.append(link)
      if (index < problems.length - 1) problemLinks.append(document.createTextNode("; "))
    }
  }

  const renderState = (catalogKey: MaintainedCassetteKey): void => {
    const state = states.get(catalogKey)
    const elements = rowElements.get(catalogKey)
    if (state === undefined || elements === undefined) return
    elements.article.dataset.state = state._tag === "Settled" ? state.result._tag : state._tag
    elements.article.setAttribute("aria-busy", String(state._tag === "Running"))
    elements.status.dataset.status = elements.article.dataset.state
    elements.status.textContent = rowStateStatusText(state)
    for (const storyItem of elements.storyItems) {
      storyItem.classList.remove("failed-story-item")
      storyItem.removeAttribute("aria-current")
    }
    if (state._tag === "Settled") {
      renderResultEvidence(elements.evidenceHost, state.result)
      if (state.result._tag === "Failed" && state.result.location._tag === "Known") {
        const stopped = elements.storyItems[state.result.location.storyPosition]
        stopped?.classList.add("failed-story-item")
        stopped?.setAttribute("aria-current", "true")
      }
    } else if (state._tag === "LabDefect") {
      const row = rows.find((candidate) => candidate.catalogKey === catalogKey)
      if (row !== undefined) renderDefectEvidence(elements.evidenceHost, row, state.detail)
    } else elements.evidenceHost.replaceChildren()
  }

  const setBusy = (nextBusy: boolean): void => {
    busy = nextBusy
    runAllButton.disabled = nextBusy
    runShownButton.disabled = nextBusy || visibleKeys.length === 0
    retryProblemsButton.disabled = nextBusy
    reloadButton.hidden = !nextBusy
    for (const { runButton } of rowElements.values()) runButton.disabled = nextBusy
  }

  const runKeys = async (keys: ReadonlyArray<MaintainedCassetteKey>, announceRows: boolean): Promise<void> => {
    const onlyKey = keys[0]
    if (onlyKey === undefined) return
    setBusy(true)
    if (!announceRows) {
      runAnnouncement.textContent = `Running ${keys.length} ${keys.length === 1 ? "cassette" : "cassettes"}; progress is visible in the catalog summary`
    }
    for (const key of keys) {
      const elements = rowElements.get(key)
      elements?.status.setAttribute("aria-live", announceRows ? "polite" : "off")
      states.set(key, { _tag: "Running" })
      renderState(key)
    }
    applyFilters()
    updateAggregate()
    await Promise.all(keys.map(async (catalogKey) => {
      try {
        states.set(catalogKey, { _tag: "Settled", result: await runCassette(catalogKey) })
      } catch (error) {
        states.set(catalogKey, { _tag: "LabDefect", catalogKey, detail: defectDetail(error) })
      }
      renderState(catalogKey)
      applyFilters()
      updateAggregate()
      root.dispatchEvent(new Event(cassetteRowSettledEvent))
    }))
    setBusy(false)
    applyFilters()
    if (!announceRows) runAnnouncement.textContent = `Batch finished. ${catalogSummaryText(currentStates())}`
  }

  for (const category of categoryOrder) {
    const categoryRows = rows.filter((row) => row.category === category)
    if (categoryRows.length === 0) continue
    const representative = categoryRows[0]
    if (representative === undefined) continue
    const group = document.createElement("section")
    group.className = "catalog-group"
    group.dataset.category = category
    group.dataset.role = "catalog-group"
    const groupHeading = appendTextElement(group, "h2", `${representative.categoryLabel} (${categoryRows.length} cassettes)`)
    const groupFacts = document.createElement("p")
    groupFacts.className = "group-facts"
    groupFacts.append("Production runner: ")
    appendTextElement(groupFacts, "code", representative.runnerName)
    groupFacts.append(` · Controlled boundaries: ${representative.controlledBoundaries}`)
    group.append(groupFacts)

    for (const row of categoryRows) {
      const article = document.createElement("article")
      article.id = `cassette-${row.catalogKey.replaceAll(":", "-")}`
      article.dataset.catalogKey = row.catalogKey
      const heading = appendTextElement(article, "h3", row.storyName)
      heading.id = `${article.id}-heading`
      heading.tabIndex = -1
      article.setAttribute("aria-labelledby", heading.id)
      const keyLine = appendTextElement(article, "p", "Catalog key: ", "catalog-key")
      const keyValue = appendTextElement(keyLine, "code", row.catalogKey)
      const matchReason = appendTextElement(article, "p", "", "search-match-reason")
      matchReason.hidden = true

      const chronology = document.createElement("details")
      chronology.className = "declared-chronology"
      chronology.dataset.role = "declared-chronology"
      appendTextElement(chronology, "summary", `Declared cassette input · ${row.totalItemCount} ${row.itemName}`)
      appendTextElement(
        chronology,
        "p",
        "Readable index of declared inputs and expectations, in order; this is not observed execution evidence."
      )
      const story = document.createElement("ol")
      const storyItems = row.storyItemSummaries.map((summary) => appendTextElement(story, "li", summary))
      chronology.append(story)
      const exactInput = document.createElement("details")
      exactInput.dataset.role = "exact-declared-input"
      appendTextElement(exactInput, "summary", "Exact declared cassette input")
      appendTextElement(exactInput, "pre", row.declaredInputText)
      chronology.append(exactInput)

      const rowControls = document.createElement("div")
      rowControls.className = "row-controls"
      const runButton = appendTextElement(rowControls, "button", "Run cassette")
      runButton.type = "button"
      runButton.setAttribute("aria-label", `Run cassette: ${row.storyName} (${row.catalogKey})`)
      const status = document.createElement("output")
      status.setAttribute("aria-live", "polite")
      rowControls.append(status)
      const evidenceHost = document.createElement("div")
      evidenceHost.className = "evidence-host"
      article.append(keyLine, matchReason, chronology, rowControls, evidenceHost)
      rowElements.set(row.catalogKey, {
        article,
        evidenceHost,
        heading,
        matchReason,
        runButton,
        searchableText: [
          { element: heading, text: row.storyName },
          { element: keyValue, text: row.catalogKey },
          ...storyItems.map((element, index) => ({ element, text: row.storyItemSummaries[index] ?? "" }))
        ],
        status,
        storyItems
      })
      runButton.addEventListener("click", () => {
        void runKeys([row.catalogKey], true).then(() => root.dispatchEvent(new Event(singleCassetteSettledEvent)))
      })
      group.append(article)
      renderState(row.catalogKey)
    }
    groupElements.set(category, {
      group,
      heading: groupHeading,
      label: representative.categoryLabel,
      total: categoryRows.length
    })
    resultsElement.append(group)
  }

  applyFilters = (announceVisibility = false): void => {
    const tokens = search.value.trim().toLocaleLowerCase().split(/\s+/u).filter((token) => token.length > 0)
    const category = categoryFilter.value || "All"
    const status = (statusFilter.value || "All") as StatusFilter
    const nextVisibleKeys: Array<MaintainedCassetteKey> = []
    const visibleByCategory = new Map<CassetteCategory, number>()
    for (const row of rows) {
      const state = states.get(row.catalogKey) ?? { _tag: "NotRun" }
      const visibleSearchable = [
        row.storyName,
        row.catalogKey,
        row.categoryLabel,
        row.runnerName,
        row.controlledBoundaries,
        ...row.storyItemSummaries
      ].join(" ").toLocaleLowerCase()
      const searchable = `${visibleSearchable} ${row.declaredInputText.toLocaleLowerCase()}`
      const visible = (category === "All" || row.category === category)
        && (status === "All" || stateFilterValue(state) === status)
        && tokens.every((token) => searchable.includes(token))
      const elements = rowElements.get(row.catalogKey)
      if (elements !== undefined) {
        elements.article.hidden = !visible
        for (const item of elements.searchableText) markSearchTokens(item.element, item.text, tokens)
        const exactInputOnlyMatch = tokens.length > 0
          && tokens.every((token) => searchable.includes(token))
          && !tokens.every((token) => visibleSearchable.includes(token))
        elements.matchReason.hidden = !visible || !exactInputOnlyMatch
        if (visible && exactInputOnlyMatch) {
          const firstPosition = Math.max(0, row.declaredInputText.toLocaleLowerCase().indexOf(tokens[0] ?? ""))
          const start = Math.max(0, firstPosition - 50)
          const end = Math.min(row.declaredInputText.length, firstPosition + 130)
          const excerpt = `${start > 0 ? "…" : ""}${row.declaredInputText.slice(start, end).replace(/\s+/gu, " ")}${end < row.declaredInputText.length ? "…" : ""}`
          markSearchTokens(elements.matchReason, `Match in exact declared input: ${excerpt}`, tokens)
        }
      }
      if (visible) {
        nextVisibleKeys.push(row.catalogKey)
        visibleByCategory.set(row.category, (visibleByCategory.get(row.category) ?? 0) + 1)
      }
    }
    visibleKeys = nextVisibleKeys
    for (const [groupCategory, groupElementsForCategory] of groupElements) {
      const visibleCount = visibleByCategory.get(groupCategory) ?? 0
      groupElementsForCategory.group.hidden = visibleCount === 0
      groupElementsForCategory.heading.textContent = visibleCount === groupElementsForCategory.total
        ? `${groupElementsForCategory.label} (${groupElementsForCategory.total} cassettes)`
        : `${groupElementsForCategory.label} (${visibleCount} of ${groupElementsForCategory.total} cassettes shown)`
    }
    const narrowed = tokens.length > 0 || category !== "All" || status !== "All"
    visibility.hidden = !narrowed
    visibility.textContent = narrowed ? `Showing ${visibleKeys.length} of ${rows.length} maintained cassettes` : ""
    runShownButton.textContent = `Run shown (${visibleKeys.length})`
    runShownButton.hidden = !runShownActive && (visibleKeys.length === 0 || visibleKeys.length === rows.length)
    runShownButton.disabled = busy || visibleKeys.length === 0
    if (announceVisibility) {
      runAnnouncement.textContent = narrowed
        ? visibility.textContent
        : `Showing all ${rows.length} maintained cassettes`
    }
  }

  search.addEventListener("input", () => applyFilters(true))
  categoryFilter.addEventListener("change", () => applyFilters(true))
  statusFilter.addEventListener("change", () => applyFilters(true))
  runAllButton.addEventListener("click", () => {
    void runKeys(rows.map(({ catalogKey }) => catalogKey), false).then(() =>
      root.dispatchEvent(new Event(everyCassetteSettledEvent))
    )
  })
  runShownButton.addEventListener("click", () => {
    runShownActive = true
    void runKeys(visibleKeys, false).finally(() => {
      summary.tabIndex = -1
      summary.focus()
      runShownActive = false
      applyFilters()
      root.dispatchEvent(new Event(shownCassettesSettledEvent))
    })
  })
  retryProblemsButton.addEventListener("click", () => {
    const problems = rows.flatMap(({ catalogKey }) => {
      const state = states.get(catalogKey)
      return state?._tag === "LabDefect" || state?._tag === "Settled" && state.result._tag === "Failed"
        ? [catalogKey]
        : []
    })
    void runKeys(problems, false)
  })
  reloadButton.addEventListener("click", reloadLab)

  controls.append(completionLegend, visibility, summary, runAnnouncement, problemLinks)
  root.replaceChildren(header, controls, resultsElement)
  applyFilters()
  updateAggregate()
}
