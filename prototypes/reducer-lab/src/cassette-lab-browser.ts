import {
  type CassetteCategory,
  type CassetteLabResult,
  type maintainedCassetteRows,
  type MaintainedCassetteKey
} from "./cassette-lab.ts"
import {
  catalogSummaryText,
  type CassetteState,
  executionSummaryItems,
  journalEvidenceRows,
  protocolDiagnosticItems,
  resultEvidenceText,
  cassetteStateStatusText
} from "./cassette-lab-view.ts"
import { renderCassetteDeliveryWorkbench } from "./cassette-lab-workbench.ts"

export const singleCassetteSettledEvent = "dalph-cassette-lab:single-settled"
export const everyCassetteSettledEvent = "dalph-cassette-lab:every-settled"
export const cassetteSettledEvent = "dalph-cassette-lab:cassette-settled"
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

const renderResultEvidence = (host: HTMLElement, result: CassetteLabResult, open: boolean): void => {
  const evidence = document.createElement("details")
  evidence.className = "execution-evidence"
  evidence.dataset.role = "execution-evidence"
  evidence.open = open || result._tag === "Failed"
  appendTextElement(
    evidence,
    "summary",
    result._tag === "Completed" ? "Terminal execution proof and journal" : "Cassette failure diagnostic"
  )
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

const stateFilterValue = (state: CassetteState): StatusFilter => {
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

const selectOption = (select: HTMLSelectElement, value: string): void => {
  for (const option of select.options) {
    if (option.value === value) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
}

/** Mounts one shared maintainer workbench over the production-owned cassette catalogs. */
export const mountCassetteLab = (input: CassetteLabBrowserInput): void => {
  const { revision, root, rows, runCassette } = input
  const reloadLab = input.reloadLab ?? (() => globalThis.location.reload())
  document.title = "Dalph reducer lab"
  const rowByKey = new Map(rows.map((row) => [row.catalogKey, row]))
  const states = new Map<MaintainedCassetteKey, CassetteState>(
    rows.map(({ catalogKey }) => [catalogKey, { _tag: "NotRun" }])
  )
  let selectedKey: MaintainedCassetteKey | undefined = rows[0]?.catalogKey
  let visibleKeys: ReadonlyArray<MaintainedCassetteKey> = rows.map(({ catalogKey }) => catalogKey)
  let workbenchOpen = false
  let evidenceOpen = false
  let busy = false
  let runShownActive = false

  const header = document.createElement("header")
  appendTextElement(header, "h1", "Dalph reducer lab")
  appendTextElement(
    header,
    "p",
    "Select one maintained cassette, run the real production workflow, and inspect how delivery consumes the observed task graph in the shared workbench.",
    "lab-purpose"
  )
  const safety = appendTextElement(
    header,
    "p",
    "Local deterministic developer harness. Production coordinator, delivery, and protocol code executes with controlled in-memory boundaries; no GitHub issue, Git repository, executor process, or durable journal is changed.",
    "safety-context"
  )
  safety.dataset.role = "safety-context"
  const revisionLine = appendTextElement(header, "p", "Source revision: ", "revision")
  revisionLine.dataset.role = "source-revision"
  appendTextElement(revisionLine, "code", revision)

  const controls = document.createElement("section")
  controls.className = "catalog-controls"
  controls.setAttribute("aria-label", "Cassette selection, catalog commands, and live results")
  const searchLabel = appendTextElement(controls, "label", "Search declared behavior and returned evidence")
  const search = document.createElement("input")
  search.type = "search"
  search.placeholder = "Words from a story, key, declared value, or returned production fact"
  searchLabel.append(search)

  const categoryLabel = appendTextElement(controls, "label", "Catalog")
  const categoryFilter = document.createElement("select")
  appendTextElement(categoryFilter, "option", "All maintained catalogs").value = "All"
  for (const category of categoryOrder) {
    const row = rows.find((candidate) => candidate.category === category)
    if (row === undefined) continue
    const option = appendTextElement(categoryFilter, "option", row.categoryLabel)
    option.value = category
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
    const option = appendTextElement(statusFilter, "option", label)
    option.value = value
  }
  statusLabel.append(statusFilter)

  const selectionLabel = appendTextElement(controls, "label", "Selected cassette")
  selectionLabel.className = "cassette-selection"
  const cassetteSelector = document.createElement("select")
  cassetteSelector.dataset.role = "cassette-selector"
  selectionLabel.append(cassetteSelector)

  const runAllButton = appendTextElement(controls, "button", `Run all ${rows.length} cassettes`)
  runAllButton.type = "button"
  runAllButton.title = "Runs every maintained cassette, regardless of the current filters"
  const runShownButton = appendTextElement(controls, "button", `Run shown (${rows.length})`, "secondary-action")
  runShownButton.type = "button"
  const retryProblemsButton = appendTextElement(controls, "button", "Retry problem cassettes", "secondary-action")
  retryProblemsButton.type = "button"
  retryProblemsButton.hidden = true
  const reloadButton = appendTextElement(controls, "button", "Reload Lab and discard displayed results", "danger-action")
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
  controls.append(completionLegend, visibility, summary, runAnnouncement, problemLinks)

  const sharedSurface = document.createElement("main")
  sharedSurface.className = "selected-cassette-surface"
  sharedSurface.dataset.role = "selected-cassette-surface"

  const currentStates = (): ReadonlyArray<CassetteState> =>
    rows.map(({ catalogKey }) => states.get(catalogKey) ?? { _tag: "NotRun" })

  let applyFilters = (_announceVisibility?: boolean): void => undefined
  let renderSelected = (): void => undefined

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
      link.href = "#selected-cassette"
      const kind = state?._tag === "LabDefect" ? "Lab defect" : "cassette failure"
      link.textContent = `${row.storyName} (${row.catalogKey}; ${kind})`
      link.addEventListener("click", (event) => {
        event.preventDefault()
        search.value = ""
        selectOption(categoryFilter, "All")
        selectOption(statusFilter, "All")
        applyFilters()
        selectedKey = row.catalogKey
        selectOption(cassetteSelector, row.catalogKey)
        workbenchOpen = false
        evidenceOpen = true
        renderSelected()
        sharedSurface.querySelector<HTMLElement>("h2")?.focus()
      })
      problemLinks.append(link)
      if (index < problems.length - 1) problemLinks.append(document.createTextNode("; "))
    }
  }

  const searchableParts = (row: CassetteRow, state: CassetteState) => {
    const visible = [
      row.storyName,
      row.catalogKey,
      row.categoryLabel,
      row.runnerName,
      row.controlledBoundaries,
      ...row.storyItemSummaries
    ].join(" ").toLocaleLowerCase()
    const declared = row.declaredInputText.toLocaleLowerCase()
    const resultText = state._tag === "Settled"
      ? resultEvidenceText(state.result)
      : state._tag === "LabDefect" ? state.detail : ""
    return { declared, result: resultText.toLocaleLowerCase(), resultText, visible }
  }

  const matchExplanation = (
    row: CassetteRow,
    state: CassetteState,
    tokens: ReadonlyArray<string>
  ): string | undefined => {
    if (tokens.length === 0) return undefined
    const searchable = searchableParts(row, state)
    if (tokens.every((token) => searchable.visible.includes(token))) return undefined
    const declaredTokens = tokens.filter((token) => searchable.declared.includes(token))
    const resultTokens = tokens.filter((token) => searchable.result.includes(token))
    const excerpt = (text: string, token: string): string => {
      const firstPosition = Math.max(0, text.toLocaleLowerCase().indexOf(token))
      const start = Math.max(0, firstPosition - 50)
      const end = Math.min(text.length, firstPosition + 130)
      return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/gu, " ")}${end < text.length ? "…" : ""}`
    }
    if (declaredTokens.length === tokens.length) {
      return `Match in exact declared input: ${excerpt(row.declaredInputText, declaredTokens[0] ?? "")}`
    }
    if (resultTokens.length === tokens.length) {
      return `Match in returned production delivery evidence: ${excerpt(searchable.resultText, resultTokens[0] ?? "")}`
    }
    return `Match spans exact declared input and returned production evidence. Declared: ${excerpt(row.declaredInputText, declaredTokens[0] ?? "")} Returned: ${excerpt(searchable.resultText, resultTokens[0] ?? "")}`
  }

  renderSelected = (): void => {
    sharedSurface.replaceChildren()
    const row = selectedKey === undefined ? undefined : rowByKey.get(selectedKey)
    if (row === undefined) {
      appendTextElement(sharedSurface, "p", "No maintained cassette matches the current filters.", "empty-selection")
      return
    }
    const state = states.get(row.catalogKey) ?? { _tag: "NotRun" }
    const article = document.createElement("article")
    article.id = "selected-cassette"
    article.dataset.catalogKey = row.catalogKey
    article.dataset.state = state._tag === "Settled" ? state.result._tag : state._tag
    article.setAttribute("aria-busy", String(state._tag === "Running"))
    const heading = appendTextElement(article, "h2", row.storyName)
    heading.tabIndex = -1
    const identity = appendTextElement(article, "p", `${row.categoryLabel} · Catalog key: `, "catalog-key")
    appendTextElement(identity, "code", row.catalogKey)
    const ownership = appendTextElement(article, "p", "Production runner: ", "group-facts")
    appendTextElement(ownership, "code", row.runnerName)
    ownership.append(` · Controlled boundaries: ${row.controlledBoundaries}`)
    if (row.surface._tag === "DirectProtocolSurface") {
      ownership.append(" · This direct protocol runner does not publish the graph-level delivery relation, so no graph, frontier, or held-position workbench is shown.")
    }
    const tokens = search.value.trim().toLocaleLowerCase().split(/\s+/u).filter((token) => token.length > 0)
    markSearchTokens(heading, row.storyName, tokens)
    const explanation = matchExplanation(row, state, tokens)
    if (explanation !== undefined) {
      const matchReason = appendTextElement(article, "p", "", "search-match-reason")
      markSearchTokens(matchReason, explanation, tokens)
    }

    const deliveryWorkbenchHost = document.createElement("div")
    renderCassetteDeliveryWorkbench(deliveryWorkbenchHost, row, state, workbenchOpen)
    const workbench = deliveryWorkbenchHost.querySelector<HTMLDetailsElement>('[data-role="delivery-workbench"]')
    workbench?.addEventListener("toggle", () => {
      workbenchOpen = workbench.open
      renderSelected()
    })

    const chronology = document.createElement("details")
    chronology.className = "declared-chronology"
    chronology.dataset.role = "declared-chronology"
    appendTextElement(chronology, "summary", `Declared cassette input · ${row.totalItemCount} ${row.itemName}`)
    appendTextElement(chronology, "p", "Readable ordered inputs and expectations; this is not observed execution evidence.")
    const story = document.createElement("ol")
    const storyItems = row.storyItemSummaries.map((itemSummary) => appendTextElement(story, "li", itemSummary))
    chronology.append(story)
    const exactInput = document.createElement("details")
    exactInput.dataset.role = "exact-declared-input"
    appendTextElement(exactInput, "summary", "Exact declared cassette input")
    appendTextElement(exactInput, "pre", row.declaredInputText)
    chronology.append(exactInput)

    const rowControls = document.createElement("div")
    rowControls.className = "selected-cassette-controls"
    const runButton = appendTextElement(rowControls, "button", state._tag === "NotRun" ? "Run selected cassette" : "Rerun selected cassette")
    runButton.type = "button"
    runButton.disabled = busy
    runButton.setAttribute("aria-label", `Run selected cassette: ${row.storyName} (${row.catalogKey})`)
    const status = document.createElement("output")
    status.dataset.status = article.dataset.state
    status.setAttribute("aria-live", "polite")
    status.textContent = cassetteStateStatusText(state)
    rowControls.append(status)
    runButton.addEventListener("click", () => {
      void runKeys([row.catalogKey], true).then(() => root.dispatchEvent(new Event(singleCassetteSettledEvent)))
    })

    const evidenceHost = document.createElement("div")
    evidenceHost.className = "evidence-host"
    if (state._tag === "Settled") {
      renderResultEvidence(evidenceHost, state.result, evidenceOpen)
      if (state.result._tag === "Failed" && state.result.location._tag === "Known") {
        const stopped = storyItems[state.result.location.storyPosition]
        stopped?.classList.add("failed-story-item")
        stopped?.setAttribute("aria-current", "true")
      }
    } else if (state._tag === "LabDefect") {
      renderDefectEvidence(evidenceHost, row, state.detail)
    }
    article.append(identity, ownership, deliveryWorkbenchHost, chronology, rowControls, evidenceHost)
    sharedSurface.append(article)
  }

  const setBusy = (nextBusy: boolean): void => {
    busy = nextBusy
    runAllButton.disabled = nextBusy
    runShownButton.disabled = nextBusy || visibleKeys.length === 0
    retryProblemsButton.disabled = nextBusy
    reloadButton.hidden = !nextBusy
    renderSelected()
  }

  const runKeys = async (keys: ReadonlyArray<MaintainedCassetteKey>, single: boolean): Promise<void> => {
    if (keys.length === 0) return
    setBusy(true)
    if (single) {
      workbenchOpen = true
      evidenceOpen = true
    } else {
      evidenceOpen = false
      runAnnouncement.textContent = `Running ${keys.length} ${keys.length === 1 ? "cassette" : "cassettes"}; progress is visible in the catalog summary`
    }
    for (const key of keys) states.set(key, { _tag: "Running" })
    renderSelected()
    applyFilters()
    updateAggregate()
    await Promise.all(keys.map(async (catalogKey) => {
      try {
        states.set(catalogKey, { _tag: "Settled", result: await runCassette(catalogKey) })
      } catch (error) {
        states.set(catalogKey, { _tag: "LabDefect", catalogKey, detail: defectDetail(error) })
      }
      if (selectedKey === catalogKey) renderSelected()
      applyFilters()
      updateAggregate()
      root.dispatchEvent(new Event(cassetteSettledEvent))
    }))
    setBusy(false)
    applyFilters()
    if (!single) runAnnouncement.textContent = `Batch finished. ${catalogSummaryText(currentStates())}`
  }

  applyFilters = (announceVisibility = false): void => {
    const tokens = search.value.trim().toLocaleLowerCase().split(/\s+/u).filter((token) => token.length > 0)
    const category = categoryFilter.value || "All"
    const status = (statusFilter.value || "All") as StatusFilter
    visibleKeys = rows.flatMap((row) => {
      const state = states.get(row.catalogKey) ?? { _tag: "NotRun" }
      const searchable = searchableParts(row, state)
      const matches = (category === "All" || row.category === category)
        && (status === "All" || stateFilterValue(state) === status)
        && tokens.every((token) => `${searchable.visible} ${searchable.declared} ${searchable.result}`.includes(token))
      return matches ? [row.catalogKey] : []
    })
    if (selectedKey === undefined || !visibleKeys.includes(selectedKey)) {
      selectedKey = visibleKeys[0]
      workbenchOpen = false
      evidenceOpen = false
    }
    cassetteSelector.replaceChildren()
    for (const categoryName of categoryOrder) {
      const categoryKeys = visibleKeys.filter((key) => rowByKey.get(key)?.category === categoryName)
      if (categoryKeys.length === 0) continue
      const firstKey = categoryKeys[0]
      if (firstKey === undefined) continue
      const representative = rowByKey.get(firstKey)
      const group = document.createElement("optgroup")
      group.label = representative?.categoryLabel ?? categoryName
      for (const key of categoryKeys) {
        const row = rowByKey.get(key)
        if (row === undefined) continue
        const state = states.get(key) ?? { _tag: "NotRun" }
        const option = appendTextElement(
          group,
          "option",
          `${row.storyName} · ${row.catalogKey} · ${cassetteStateStatusText(state)}`
        )
        option.value = key
        option.selected = key === selectedKey
      }
      cassetteSelector.append(group)
    }
    cassetteSelector.disabled = visibleKeys.length === 0
    const narrowed = tokens.length > 0 || category !== "All" || status !== "All"
    visibility.hidden = !narrowed
    visibility.textContent = narrowed ? `${visibleKeys.length} of ${rows.length} maintained cassettes available to select` : ""
    runShownButton.textContent = `Run shown (${visibleKeys.length})`
    runShownButton.hidden = !runShownActive && (visibleKeys.length === 0 || visibleKeys.length === rows.length)
    runShownButton.disabled = busy || visibleKeys.length === 0
    renderSelected()
    if (announceVisibility) {
      runAnnouncement.textContent = narrowed ? visibility.textContent : `All ${rows.length} maintained cassettes are selectable`
    }
  }

  cassetteSelector.addEventListener("change", () => {
    const next = cassetteSelector.value as MaintainedCassetteKey
    if (!visibleKeys.includes(next)) return
    selectedKey = next
    workbenchOpen = false
    evidenceOpen = false
    renderSelected()
  })
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
    const keys = [...visibleKeys]
    void runKeys(keys, false).finally(() => {
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

  root.replaceChildren(header, controls, sharedSurface)
  applyFilters()
  updateAggregate()
}
