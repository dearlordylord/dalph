import {
  type CassetteLabResult,
  type CassetteRunObserver,
  type maintainedCassetteRows,
  type MaintainedCassetteKey
} from "./cassette-lab.ts"
import {
  catalogSummaryText,
  type CassetteState,
  continuationAuthorizationSummaryItems,
  executionSummaryItems,
  journalEvidenceRows,
  protocolDiagnosticItems,
  resultEvidenceText,
  cassetteStateStatusText
} from "./cassette-lab-view.ts"
import {
  makeDeliveryWorkbenchPlaybackRuntime,
  renderCassetteDeliveryWorkbench
} from "./cassette-lab-workbench.ts"
import { PlaybackRunStarted } from "./delivery-playback.ts"
import { continuationAuthorizationProjectionOf } from "./continuation-authorization-lab.ts"

export const singleCassetteSettledEvent = "dalph-cassette-lab:single-settled"
export const everyCassetteSettledEvent = "dalph-cassette-lab:every-settled"
export const cassetteSettledEvent = "dalph-cassette-lab:cassette-settled"
export const deliveryFrameEvent = "dalph-cassette-lab:delivery-frame"

type CassetteRow = (typeof maintainedCassetteRows)[number]

export interface CassetteLabBrowserInput {
  readonly reloadLab?: () => void
  readonly revision: string
  readonly root: HTMLElement
  readonly rows: ReadonlyArray<CassetteRow>
  readonly runCassette: (
    catalogKey: MaintainedCassetteKey,
    observer?: CassetteRunObserver
  ) => Promise<CassetteLabResult>
}

const browserBatchConcurrency = 1
const liveDeliveryRenderIntervalMs = 100

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
    appendTextElement(
      raw,
      "summary",
      `Position ${row.position} · ${row.eventTag}${row.context.length > 0 ? ` · ${row.context}` : ""}`
    )
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
  const disclosure = document.createElement("details")
  disclosure.dataset.role = "journal-evidence"
  appendTextElement(disclosure, "summary", `${evidence.length} journal records`)
  const runIds = [...new Set(evidence.map(({ runId }) => runId))]
  appendTextElement(disclosure, "h5", runIds.length === 1 ? "Journal chronology" : "Journal records by Run identity")
  for (const runId of runIds) {
    renderJournalTable(disclosure, runId, evidence.filter((row) => row.runId === runId), runIds.length > 1)
  }
  parent.append(disclosure)
}

const renderRawEvidence = (parent: HTMLElement, result: CassetteLabResult): void => {
  const details = document.createElement("details")
  details.dataset.role = result._tag === "Failed" ? "raw-diagnostic" : "raw-execution-result"
  appendTextElement(details, "summary", result._tag === "Failed" ? "Raw diagnostic" : "Raw execution result")
  appendTextElement(details, "pre", resultEvidenceText(result))
  parent.append(details)
}

const renderContinuationAuthorization = (parent: HTMLElement, result: CassetteLabResult): void => {
  const projection = continuationAuthorizationProjectionOf(result)
  if (projection === null) return
  const section = document.createElement("section")
  section.className = "continuation-authorization-evidence"
  section.dataset.role = "continuation-authorization"
  appendTextElement(section, "h4", "Continuation authorization chronology")
  appendTextElement(
    section,
    "p",
    "These are durable prefixes projected from the production journal. The coordinator process-death cassette control is not a journal event, and authorization keeps the existing Run/attempt responsibility.",
    "continuation-authorization-explanation"
  )
  renderDefinitionList(section, continuationAuthorizationSummaryItems(projection))

  const prefixTable = document.createElement("table")
  prefixTable.dataset.role = "continuation-prefixes"
  appendTextElement(prefixTable, "caption", "Continuation authorization durable prefixes")
  const head = document.createElement("thead")
  const headingRow = document.createElement("tr")
  for (const heading of ["Prefix", "Journal through", "Authorization", "Executor report", "Run / attempt"]) {
    const cell = appendTextElement(headingRow, "th", heading)
    cell.setAttribute("scope", "col")
  }
  head.append(headingRow)
  const body = document.createElement("tbody")
  for (const prefix of projection.prefixes) {
    const row = document.createElement("tr")
    appendTextElement(row, "td", prefix._tag)
    appendTextElement(row, "td", String(prefix.throughPosition))
    appendTextElement(row, "td", prefix.authorizationPosition === null ? "not yet recorded" : String(prefix.authorizationPosition))
    appendTextElement(
      row,
      "td",
      prefix.executorReport === null ? "none" : `${prefix.executorReport._tag} at journal ${prefix.executorReport.position}`
    )
    appendTextElement(row, "td", `${prefix.runId} / ${prefix.attemptId}`)
    body.append(row)
  }
  prefixTable.append(head, body)
  section.append(prefixTable)

  const witnesses = document.createElement("details")
  witnesses.dataset.role = "continuation-witness-operations"
  appendTextElement(witnesses, "summary", "Exact continuation witness operation identities")
  const witnessList = document.createElement("ul")
  for (const [name, operation] of [
    ["Active-task graph", projection.witnesses.activeTask.graph],
    ["Active-task specification", projection.witnesses.activeTask.specification],
    ["Active-task claim", projection.witnesses.activeTask.claim],
    ["Planned worktree", projection.witnesses.worktree]
  ] as const) {
    appendTextElement(
      witnessList,
      "li",
      `${name}: ${operation.operationId} · intent journal ${operation.intentPosition} · observation journal ${operation.observationPosition}`
    )
  }
  witnesses.append(witnessList)
  section.append(witnesses)
  parent.append(section)
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
  renderContinuationAuthorization(evidence, result)
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

/** Mounts one shared maintainer workbench over the production-owned cassette catalogs. */
export const mountCassetteLab = (input: CassetteLabBrowserInput): void => {
  const { revision, root, rows, runCassette } = input
  const coalesceLiveDeliveryRenders = typeof globalThis.requestAnimationFrame === "function"
  const reloadLab = input.reloadLab ?? (() => globalThis.location.reload())
  document.title = "Dalph reducer lab"
  const rowByKey = new Map(rows.map((row) => [row.catalogKey, row]))
  const states = new Map<MaintainedCassetteKey, CassetteState>(
    rows.map(({ catalogKey }) => [catalogKey, { _tag: "NotRun" }])
  )
  let selectedKey: MaintainedCassetteKey | undefined = rows[0]?.catalogKey
  let evidenceOpen = false
  let busy = false
  let selectedSurface: {
    readonly catalogKey: MaintainedCassetteKey
    readonly update: (state: CassetteState) => void
    readonly updateDeliveryFrame: (state: CassetteState) => void
  } | undefined
  const playbackByKey = new Map<MaintainedCassetteKey, ReturnType<typeof makeDeliveryWorkbenchPlaybackRuntime>>()

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
  const selectionLabel = appendTextElement(controls, "label", "Find cassette by ID or title")
  selectionLabel.className = "cassette-selection"
  const selectionText = appendTextElement(selectionLabel, "span", `(${rows.length} available)`)
  const cassetteSearch = document.createElement("input")
  cassetteSearch.type = "search"
  cassetteSearch.dataset.role = "cassette-selector"
  cassetteSearch.setAttribute("aria-label", "Find cassette by ID or title")
  cassetteSearch.setAttribute("autocomplete", "off")
  const cassetteOptions = document.createElement("datalist")
  cassetteOptions.id = "maintained-cassette-options"
  cassetteOptions.dataset.role = "cassette-options"
  cassetteSearch.setAttribute("list", cassetteOptions.id)
  const cassetteSearchStatus = document.createElement("output")
  cassetteSearchStatus.className = "cassette-search-status"
  cassetteSearchStatus.dataset.role = "cassette-search-status"
  cassetteSearchStatus.setAttribute("aria-live", "polite")
  selectionLabel.append(cassetteSearch)
  controls.append(cassetteOptions, cassetteSearchStatus)

  const runAllButton = appendTextElement(controls, "button", `Run all ${rows.length} cassettes`)
  runAllButton.type = "button"
  runAllButton.title = "Runs every maintained cassette"
  const retryProblemsButton = appendTextElement(controls, "button", "Retry problem cassettes", "secondary-action")
  retryProblemsButton.type = "button"
  retryProblemsButton.hidden = true
  const reloadButton = appendTextElement(controls, "button", "Reload Lab and discard displayed results", "danger-action")
  reloadButton.type = "button"
  reloadButton.title = "Stops waiting by reloading this local harness; all displayed results are discarded"
  reloadButton.hidden = true
  const completionLegend = appendTextElement(
    controls,
    "p",
    "Cassette completed means the production runner matched the declared end. The modeled operation may intentionally end in an expected protocol failure.",
    "completion-legend"
  )
  completionLegend.dataset.role = "completion-legend"
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
  controls.append(completionLegend, summary, runAnnouncement, problemLinks)

  const sharedSurface = document.createElement("main")
  sharedSurface.className = "selected-cassette-surface"
  sharedSurface.dataset.role = "selected-cassette-surface"

  const currentStates = (): ReadonlyArray<CassetteState> =>
    rows.map(({ catalogKey }) => states.get(catalogKey) ?? { _tag: "NotRun" })

  let refreshSelector = (): void => undefined
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
        selectedKey = row.catalogKey
        cassetteSearch.value = row.catalogKey
        updateSearchStatus()
        evidenceOpen = true
        renderSelected()
        const evidence = sharedSurface.querySelector<HTMLDetailsElement>("details[data-role='execution-evidence']")
        if (evidence !== null) evidence.open = true
        sharedSurface.querySelector<HTMLElement>("h2")?.focus()
      })
      problemLinks.append(link)
      if (index < problems.length - 1) problemLinks.append(document.createTextNode("; "))
    }
  }

  renderSelected = (): void => {
    const row = selectedKey === undefined ? undefined : rowByKey.get(selectedKey)
    if (row === undefined) {
      selectedSurface = undefined
      sharedSurface.replaceChildren()
      appendTextElement(sharedSurface, "p", "No maintained cassette is available.", "empty-selection")
      return
    }
    const state = states.get(row.catalogKey) ?? { _tag: "NotRun" }
    if (selectedSurface?.catalogKey === row.catalogKey) {
      selectedSurface.update(state)
      return
    }
    const article = document.createElement("article")
    article.id = "selected-cassette"
    article.dataset.catalogKey = row.catalogKey
    const heading = appendTextElement(article, "h2", row.storyName)
    heading.tabIndex = -1
    const identity = appendTextElement(article, "p", `${row.categoryLabel} · Catalog key: `, "catalog-key")
    appendTextElement(identity, "code", row.catalogKey)
    const ownership = appendTextElement(article, "p", "Production runner: ", "group-facts")
    appendTextElement(ownership, "code", row.runnerName)
    ownership.append(` · Available controlled boundaries for this catalog: ${row.controlledBoundaries}`)
    if (row.catalogKey === "authored:deliveryInvariantStory") {
      appendTextElement(
        article,
        "p",
        "Production scheduler/restart chronology: the runtime consumes a staggered graph A → B+C → D → E+F → H+I → G with capacity 2. While the coordinator is down, Alice adds X after A and before G. Restart reconstructs the exact B/C positions, so X is observed but waits; paired work then releases one position at a time before the frontier continues. The maintained story exposes one outer Integrator session; issues #222, #223, #68, and #225 keep this graph chronology as supporting delivery evidence.",
        "delivery-story-scope"
      )
    }
    if (row.catalogKey === "authored:deliveryFinalitySpine") {
      appendTextElement(
        article,
        "p",
        "Delivery-story chronology: A crosses the production graph, frontier, restart, promotion, tracker-completion, completion-claim, settlement, and reflection boundaries. B remains open. Later graph answers report C through G successful, but this cassette contains no executor or integration chronology for those tasks. This is not the complete 22-beat one-Run target; docs/DELIVERY-STORY.md links the remaining beats to exact maintained slices or explicit implementation gaps.",
        "delivery-story-scope"
      )
    }
    if (row.surface._tag === "DirectProtocolSurface") {
      ownership.append(" · This direct protocol runner does not publish the graph-level delivery relation, so no Delivery graph, source-stage explanation, or runtime-owner chronology is shown.")
    }

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
    const runButton = appendTextElement(rowControls, "button", "Run selected cassette")
    runButton.type = "button"
    runButton.setAttribute("aria-label", `Run selected cassette: ${row.storyName} (${row.catalogKey})`)
    const status = document.createElement("output")
    status.setAttribute("aria-live", "polite")
    rowControls.append(status)
    runButton.addEventListener("click", () => {
      void runKeys([row.catalogKey], true).then(() => root.dispatchEvent(new Event(singleCassetteSettledEvent)))
    })

    const deliveryWorkbenchHost = document.createElement("div")
    const playback = playbackByKey.get(row.catalogKey) ?? makeDeliveryWorkbenchPlaybackRuntime()
    playbackByKey.set(row.catalogKey, playback)
    const workbench = renderCassetteDeliveryWorkbench(
      deliveryWorkbenchHost,
      row,
      state,
      playback,
      row.surface._tag === "AuthoredDeliverySurface" ? rowControls : undefined
    )

    const evidenceHost = document.createElement("div")
    evidenceHost.className = "evidence-host"
    article.append(identity, ownership)
    if (row.surface._tag === "AuthoredDeliverySurface") {
      article.append(deliveryWorkbenchHost)
    } else {
      article.append(rowControls)
    }
    article.append(chronology, evidenceHost)
    let renderedState: CassetteState | undefined
    const update = (nextState: CassetteState): void => {
      const displayState = nextState._tag === "Settled" ? nextState.result._tag : nextState._tag
      article.dataset.state = displayState
      article.setAttribute("aria-busy", String(nextState._tag === "Running"))
      runButton.textContent = nextState._tag === "NotRun" ? "Run selected cassette" : "Rerun selected cassette"
      runButton.disabled = busy
      status.dataset.status = displayState
      status.textContent = cassetteStateStatusText(nextState)
      if (renderedState === nextState) return
      renderedState = nextState
      workbench.update(nextState)
      evidenceHost.replaceChildren()
      for (const item of storyItems) {
        item.classList.remove("failed-story-item")
        item.removeAttribute("aria-current")
      }
      if (nextState._tag === "Settled") {
        renderResultEvidence(evidenceHost, nextState.result, evidenceOpen)
        if (nextState.result._tag === "Failed" && nextState.result.location._tag === "Known") {
          const stopped = storyItems[nextState.result.location.storyPosition]
          stopped?.classList.add("failed-story-item")
          stopped?.setAttribute("aria-current", "true")
        }
      } else if (nextState._tag === "LabDefect") {
        renderDefectEvidence(evidenceHost, row, nextState.detail)
      }
    }
    selectedSurface = {
      catalogKey: row.catalogKey,
      update,
      updateDeliveryFrame: (nextState) => workbench.update(nextState)
    }
    sharedSurface.replaceChildren(article)
    update(state)
  }

  const setBusy = (nextBusy: boolean): void => {
    busy = nextBusy
    runAllButton.disabled = nextBusy
    retryProblemsButton.disabled = nextBusy
    reloadButton.hidden = !nextBusy
    renderSelected()
  }

  const runKeys = async (keys: ReadonlyArray<MaintainedCassetteKey>, single: boolean): Promise<void> => {
    if (keys.length === 0) return
    setBusy(true)
    if (single) {
      evidenceOpen = false
    } else {
      evidenceOpen = false
      runAnnouncement.textContent = `Running ${keys.length} ${keys.length === 1 ? "cassette" : "cassettes"}; progress is visible in the catalog summary`
    }
    for (const key of keys) {
      const row = rowByKey.get(key)
      const playback = playbackByKey.get(key) ?? makeDeliveryWorkbenchPlaybackRuntime()
      playback.dispatch(PlaybackRunStarted())
      playbackByKey.set(key, playback)
      states.set(key, {
        _tag: "Running",
        deliveryFrames: row?.surface._tag === "AuthoredDeliverySurface" ? [] : null,
        observationMoments: row?.surface._tag === "AuthoredDeliverySurface" ? [] : null
      })
    }
    refreshSelector()
    renderSelected()
    updateAggregate()
    let nextIndex = 0
    const runNext = async (): Promise<void> => {
      while (nextIndex < keys.length) {
        const catalogKey = keys[nextIndex]
        nextIndex += 1
        if (catalogKey === undefined) return
        let hasRenderedLiveObservation = false
        let liveDeliveryRenderTimer: ReturnType<typeof setTimeout> | undefined
        try {
          const renderLatestLiveObservation = (): void => {
            liveDeliveryRenderTimer = undefined
            const latestState = states.get(catalogKey)
            if (
              latestState?._tag !== "Running"
              || latestState.deliveryFrames === null
              || latestState.observationMoments === null
            ) return
            if (selectedSurface?.catalogKey === catalogKey) selectedSurface.updateDeliveryFrame(latestState)
            root.dispatchEvent(new CustomEvent(deliveryFrameEvent, {
              detail: {
                catalogKey,
                frameCount: latestState.deliveryFrames.length,
                momentCount: latestState.observationMoments.length
              }
            }))
          }
          const observer: CassetteRunObserver = {
            onObservationMoment: (moment) => {
              const state = states.get(catalogKey)
              if (
                state?._tag !== "Running"
                || state.deliveryFrames === null
                || state.observationMoments === null
              ) return
              const nextState = {
                _tag: "Running",
                deliveryFrames: moment._tag === "DeliveryPublicationMoment"
                  ? [...state.deliveryFrames, moment.deliveryFrame]
                  : state.deliveryFrames,
                observationMoments: [...state.observationMoments, moment]
              } as const
              states.set(catalogKey, nextState)
              if (!hasRenderedLiveObservation) {
                hasRenderedLiveObservation = true
                renderLatestLiveObservation()
              } else if (!coalesceLiveDeliveryRenders) {
                renderLatestLiveObservation()
              } else {
                liveDeliveryRenderTimer ??= setTimeout(renderLatestLiveObservation, liveDeliveryRenderIntervalMs)
              }
            }
          }
          const result = await runCassette(catalogKey, observer)
          if (liveDeliveryRenderTimer !== undefined) clearTimeout(liveDeliveryRenderTimer)
          states.set(catalogKey, { _tag: "Settled", result })
        } catch (error) {
          if (liveDeliveryRenderTimer !== undefined) clearTimeout(liveDeliveryRenderTimer)
          states.set(catalogKey, { _tag: "LabDefect", catalogKey, detail: defectDetail(error) })
        }
        refreshSelector()
        if (selectedKey === catalogKey) renderSelected()
        updateAggregate()
        root.dispatchEvent(new Event(cassetteSettledEvent))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(browserBatchConcurrency, keys.length) }, () => runNext())
    )
    setBusy(false)
    refreshSelector()
    if (!single) runAnnouncement.textContent = `Batch finished. ${catalogSummaryText(currentStates())}`
  }

  const matchingRows = (searchText: string): ReadonlyArray<CassetteRow> => {
    const query = searchText.trim().toLocaleLowerCase()
    if (query.length === 0) return []
    return rows.filter(({ catalogKey, storyName }) =>
      catalogKey.toLocaleLowerCase().includes(query) || storyName.toLocaleLowerCase().includes(query)
    )
  }

  const exactSearchRow = (searchText: string): CassetteRow | undefined => {
    const query = searchText.trim().toLocaleLowerCase()
    return rows.find(({ catalogKey, storyName }) => {
      const separator = catalogKey.indexOf(":")
      const suffix = separator < 0 ? catalogKey : catalogKey.slice(separator + 1)
      return catalogKey.toLocaleLowerCase() === query
        || suffix.toLocaleLowerCase() === query
        || storyName.toLocaleLowerCase() === query
    })
  }

  function updateSearchStatus(): void {
    const matches = matchingRows(cassetteSearch.value)
    if (cassetteSearch.value.trim().length === 0) {
      cassetteSearchStatus.textContent = "Search text is empty; the last valid cassette remains selected."
    } else if (matches.length === 0) {
      cassetteSearchStatus.textContent = `No maintained cassette matches “${cassetteSearch.value}”; the last valid cassette remains selected.`
    } else {
      cassetteSearchStatus.textContent = `${matches.length} ${matches.length === 1 ? "cassette matches" : "cassettes match"}; exact IDs and human titles are available in the suggestions.`
    }
  }

  const applyCassetteSearch = (): void => {
    const matches = matchingRows(cassetteSearch.value)
    const next = exactSearchRow(cassetteSearch.value) ?? (matches.length === 1 ? matches[0] : undefined)
    updateSearchStatus()
    if (next === undefined || next.catalogKey === selectedKey) return
    selectedKey = next.catalogKey
    evidenceOpen = false
    renderSelected()
  }

  refreshSelector = (): void => {
    const keys = rows.map(({ catalogKey }) => catalogKey)
    if (selectedKey === undefined || !keys.includes(selectedKey)) selectedKey = keys[0]
    cassetteOptions.replaceChildren()
    for (const row of rows) {
      const option = document.createElement("option")
      const state = states.get(row.catalogKey) ?? { _tag: "NotRun" }
      option.value = row.catalogKey
      option.label = `${row.storyName} · ${row.categoryLabel} · ${cassetteStateStatusText(state)}`
      cassetteOptions.append(option)
    }
    cassetteSearch.disabled = keys.length === 0
    selectionText.textContent = `(${keys.length} available)`
    updateSearchStatus()
  }

  cassetteSearch.addEventListener("input", applyCassetteSearch)
  cassetteSearch.addEventListener("change", applyCassetteSearch)
  runAllButton.addEventListener("click", () => {
    void runKeys(rows.map(({ catalogKey }) => catalogKey), false).then(() =>
      root.dispatchEvent(new Event(everyCassetteSettledEvent))
    )
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
  cassetteSearch.value = selectedKey ?? ""
  refreshSelector()
  renderSelected()
  updateAggregate()
}
