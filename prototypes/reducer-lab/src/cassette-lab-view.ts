import type { AuthoredDeliveryFrame } from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import type { CassetteLabResult, MaintainedCassetteKey } from "./cassette-lab.ts"
import type { ContinuationAuthorizationProjection } from "./continuation-authorization-lab.ts"

export type CassetteState =
  | { readonly _tag: "NotRun" }
  | { readonly _tag: "Running"; readonly deliveryFrames: ReadonlyArray<AuthoredDeliveryFrame> | null }
  | { readonly _tag: "Settled"; readonly result: CassetteLabResult }
  | { readonly _tag: "LabDefect"; readonly catalogKey: MaintainedCassetteKey; readonly detail: string }

export interface ExecutionSummaryItem {
  readonly description: string
  readonly term: string
}

export interface JournalEvidenceRow {
  readonly context: string
  readonly eventTag: string
  readonly position: string
  readonly rawEvent: string
  readonly runId: string
}

const objectRecord = (input: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof input === "object" && input !== null ? input as Readonly<Record<string, unknown>> : undefined

const valueText = (input: unknown): string => {
  if (input === null) return "none"
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") return String(input)
  return JSON.stringify(input)
}

const evidenceProperty = (result: Extract<CassetteLabResult, { readonly _tag: "Completed" }>, key: string) =>
  objectRecord(result.executionEvidence)?.[key]

export const resultStatusText = (result: CassetteLabResult): string => {
  if (result._tag === "Completed") {
    return `cassette completed · declared end reached · ${result.consumedItemCount}/${result.totalItemCount}`
  }
  if (result.location._tag === "Unknown") {
    return `failed · consumed position unavailable · ${result.totalItemCount} declared items`
  }
  return `failed · ${result.location.consumedItemCount}/${result.totalItemCount} · stopped at item ${result.location.storyPosition + 1} (${result.location.failedItemTag}, index ${result.location.storyPosition})`
}

export const cassetteStateStatusText = (state: CassetteState): string => {
  switch (state._tag) {
    case "LabDefect":
      return "Lab defect · the browser runner rejected unexpectedly"
    case "NotRun":
      return "not run"
    case "Running":
      return state.deliveryFrames === null || state.deliveryFrames.length === 0
        ? "running production code with controlled boundaries… waiting for its first delivery publication"
        : `running production code with controlled boundaries · ${state.deliveryFrames.length} delivery frames captured`
    case "Settled":
      return resultStatusText(state.result)
  }
}

export const resultEvidenceText = (result: CassetteLabResult): string =>
  result._tag === "Failed" ? result.detail : JSON.stringify(result.executionEvidence, null, 2)

const failureHeadline = (detail: string): string => {
  const lines = detail.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
  const headline = lines[0] ?? "Unknown cassette failure"
  const explanation = lines.findLast((line, index) => index > 0 && !line.startsWith("at "))
  return explanation === undefined || explanation === headline ? headline : `${headline} — ${explanation}`
}

export const executionSummaryItems = (result: CassetteLabResult): ReadonlyArray<ExecutionSummaryItem> => {
  const base: Array<ExecutionSummaryItem> = [
    { term: "Production runner", description: result.runnerName }
  ]
  if (result._tag === "Failed") {
    base.push({
      term: "Partial journal evidence",
      description: "The production runner returned no structured partial journal with this failure"
    })
    if (result.location._tag === "Known") {
      base.push({
        term: "Stopped at",
        description: `item ${result.location.storyPosition + 1}: ${result.location.failedItemTag} (zero-based index ${result.location.storyPosition})`
      })
    }
    base.push({ term: "Failure", description: failureHeadline(result.detail) })
    return base
  }
  if (result.activationOrdinals.length > 0) {
    base.push({
      term: "Run activations",
      description: result.activationOrdinals.map((ordinal) => `Activation ${ordinal}`).join(" → ")
    })
  }
  if (result.runId !== null) base.push({ term: "Run identity", description: result.runId })
  base.push({ term: "Journal evidence", description: `${result.journalRecordCount} records, ordered within each Run` })
  if (result.runId === null) {
    const journalRunIds = [...new Set(result.journalRecords.flatMap((record) => {
      const runId = objectRecord(record)?.runId
      return typeof runId === "string" ? [runId] : []
    }))]
    if (journalRunIds.length > 0) base.push({ term: "Journal Run identity", description: journalRunIds.join(", ") })
  }

  const failureTag = evidenceProperty(result, "failureTag")
  if (failureTag !== undefined) {
    base.push({
      term: "Declared protocol terminal",
      description: failureTag === null ? "Reached without a protocol failure" : `Reached with expected failure tag ${valueText(failureTag)}`
    })
  }
  const sawEmptyFrontier = evidenceProperty(result, "sawEmptyFrontierWhilePending")
  if (sawEmptyFrontier !== undefined) {
    base.push({
      term: "Pending-settlement observation",
      description: sawEmptyFrontier === true
        ? "An empty frontier was observed while completion settlement was still pending"
        : "No empty frontier was observed while completion settlement was pending"
    })
  }
  return base
}

export const protocolDiagnosticItems = (
  result: CassetteLabResult
): ReadonlyArray<ExecutionSummaryItem> => {
  if (result._tag === "Failed") return []
  const diagnostics: Array<ExecutionSummaryItem> = []
  const boundaryCalls = evidenceProperty(result, "boundaryCalls")
  if (Array.isArray(boundaryCalls)) {
    diagnostics.push({ term: "Boundary-call sequence", description: `${boundaryCalls.length}: ${boundaryCalls.join(" → ")}` })
  }
  for (const [key, term] of [
    ["compareAndSetCount", "Compare-and-set requests"],
    ["readCalls", "Claim reads"],
    ["replacementCalls", "Claim replacements"],
    ["deletionCalls", "Claim deletions"]
  ] as const) {
    const value = evidenceProperty(result, key)
    if (value !== undefined) diagnostics.push({ term, description: valueText(value) })
  }
  return diagnostics
}

/** Readable summary of the durable continuation authorization, when the selected result owns it. */
export const continuationAuthorizationSummaryItems = (
  projection: ContinuationAuthorizationProjection | null
): ReadonlyArray<ExecutionSummaryItem> => {
  if (projection === null) return []
  const witness = projection.witnesses
  return [
    {
      term: "Continuation responsibility",
      description: `one existing Run/attempt responsibility · Run ${projection.runId} · attempt ${projection.attemptId}`
    },
    {
      term: "Durable authorization",
      description: `generic PlannedAttemptContinuationAuthorized at journal ${projection.authorization.position}; no recovery event is inferred`
    },
    {
      term: "Fresh witness operations",
      description: [
        `graph ${witness.activeTask.graph.operationId}`,
        `specification ${witness.activeTask.specification.operationId}`,
        `claim ${witness.activeTask.claim.operationId}`,
        `worktree ${witness.worktree.operationId}`
      ].join(" · ")
    },
    {
      term: "Continuation prefixes",
      description: projection.prefixes.map(({ _tag, throughPosition, executorReport }) =>
        `${_tag} through ${throughPosition}${executorReport === null ? "" : ` · ${executorReport._tag}`}`
      ).join(" → ")
    },
    {
      term: "Executor boundary evidence",
      description: projection.executorBoundary._tag === "NoCommandIntent"
        ? "No executor command intent is recorded"
        : `${projection.executorBoundary._tag} at journal ${projection.executorBoundary.position}`
    },
    {
      term: "Identity check",
      description: `${projection.identity.responsibilityCount} responsibility · ${projection.identity.authorizationCount} authorization · ${projection.identity.plannedAttemptCorrelations.length} planned attempt · ${projection.identity.reportCorrelations.length} executor reports · all correlations retain structured Run/attempt identity`
    }
  ]
}

const journalContext = (event: Readonly<Record<string, unknown>> | undefined): string => {
  if (event === undefined) return "—"
  const identities: Array<string> = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || identities.length >= 5) return
    const record = objectRecord(value)
    if (record === undefined) return
    for (const [key, nested] of Object.entries(record)) {
      if (/(?:attemptId|candidateId|operationId|requestId|sessionId|taskId)$/u.test(key)
        && (typeof nested === "string" || typeof nested === "number")) {
        identities.push(`${key}=${nested}`)
      } else visit(nested, depth + 1)
      if (identities.length >= 5) return
    }
  }
  visit(event, 0)
  return identities.length === 0 ? "—" : identities.join(" · ")
}

export const journalEvidenceRows = (result: CassetteLabResult): ReadonlyArray<JournalEvidenceRow> =>
  result._tag === "Failed"
    ? []
    : result.journalRecords.map((record) => {
        const envelope = objectRecord(record)
        const event = objectRecord(envelope?.event)
        return {
          context: journalContext(event),
          eventTag: typeof event?._tag === "string" ? event._tag : "UnknownEvent",
          position: valueText(envelope?.position ?? "unknown"),
          rawEvent: JSON.stringify(envelope?.event, null, 2),
          runId: valueText(envelope?.runId ?? "unknown")
        }
      })

export const catalogSummaryText = (states: ReadonlyArray<CassetteState>): string => {
  const counts = { completed: 0, defects: 0, failed: 0, notRun: 0, running: 0 }
  for (const state of states) {
    if (state._tag === "NotRun") counts.notRun += 1
    else if (state._tag === "Running") counts.running += 1
    else if (state._tag === "LabDefect") counts.defects += 1
    else if (state.result._tag === "Completed") counts.completed += 1
    else counts.failed += 1
  }
  if (counts.notRun === states.length) return `${states.length} ready · none run`
  if (counts.running === 0 && counts.notRun === 0) {
    return `${counts.completed} completed · ${counts.failed} failed · ${counts.defects} Lab defects · ${states.length} total`
  }
  const parts = [
    counts.completed > 0 ? `${counts.completed} completed` : undefined,
    counts.failed > 0 ? `${counts.failed} failed` : undefined,
    counts.defects > 0 ? `${counts.defects} Lab defects` : undefined,
    counts.running > 0 ? `${counts.running} running` : undefined,
    counts.notRun > 0 ? `${counts.notRun} not run` : undefined
  ].filter((part): part is string => part !== undefined)
  return `${parts.join(" · ")} · ${states.length - counts.running - counts.notRun}/${states.length} settled`
}

export const runAllSummaryText = (results: ReadonlyArray<CassetteLabResult>): string =>
  catalogSummaryText(results.map((result) => ({ _tag: "Settled", result })))
