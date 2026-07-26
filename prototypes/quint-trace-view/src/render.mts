import type {
  ArtifactProvenance,
  NormalizedFrame,
  NormalizedTrace,
  TraceKind
} from "./trace.mjs"

const compact = (value: unknown): string =>
  JSON.stringify(value).replaceAll("|", "\\|")

const provenanceText = (provenance: ArtifactProvenance): string =>
  JSON.stringify(provenance)

export const renderTable = (trace: NormalizedTrace): string => {
  const header = [
    `<!-- provenance: ${provenanceText(trace.provenance)} -->`,
    `# ${trace.provenance.traceKind} trace`,
    "",
    "| Position | Action / picked task | Coordinator | Capacity | Frontier | Admission | Occupied | Reserved | Explanations | Comparison |",
    "| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |"
  ]
  const rows = trace.frames.map((frame) => [
    frame.position,
    `${frame.action}${frame.pickedModelTaskId === undefined ? "" : ` / ${frame.pickedModelTaskId}`}`,
    frame.coordinatorStatus,
    frame.capacity,
    compact(frame.frontier),
    compact(frame.admission),
    compact(frame.occupiedModelTaskIds),
    compact(frame.reservedModelTaskIds),
    compact(frame.explanations),
    frame.comparison.status === "Mismatch"
      ? `Mismatch: ${frame.comparison.firstDivergentField}`
      : frame.comparison.status
  ].join(" | "))
  return [...header, ...rows.map((row) => `| ${row} |`), ""].join("\n")
}

const eventLabel = (frame: NormalizedFrame): string =>
  frame.pickedModelTaskId === undefined
    ? frame.action
    : `${frame.action}(task ${frame.pickedModelTaskId})`

const taskName = (modelTaskId: string): string =>
  ["A", "B", "C", "D"][Number(modelTaskId)] ?? `#${modelTaskId}`

const taskSet = (modelTaskIds: ReadonlyArray<string>): string =>
  `{${modelTaskIds.map(taskName).join(", ") || "none"}}`

const storyName = (traceKind: TraceKind): string => {
  if (traceKind === "explore-claim-c-then-claim-loss")
    return "Claim C → A loses claim"
  if (traceKind === "explore-claim-loss-then-claim-c")
    return "A loses claim → claim C"
  if (traceKind === "explore-claim-c-then-git-rewrite")
    return "Claim C → rewrite A"
  if (traceKind === "explore-git-rewrite-then-claim-c")
    return "Rewrite A → claim C"
  if (traceKind === "explore-claim-c-then-authority-conflict")
    return "Claim C → conflict A"
  if (traceKind === "explore-authority-conflict-then-claim-c")
    return "Conflict A → claim C"
  if (traceKind === "story-crash-after-intent") return "Crash after intent"
  if (traceKind === "story-pause-independent")
    return "Pause A; C keeps moving"
  if (traceKind === "story-claim-loss") return "Claim loss isolates A"
  if (traceKind === "story-git-rewrite") return "Git rewrite isolates A"
  if (traceKind === "story-external-completion")
    return "External completion settles A"
  if (traceKind === "counterexample") return "Capacity counterexample"
  if (traceKind === "restart") return "Restart sample"
  return "Selector sample"
}

const storySource = (traceKind: TraceKind): string => {
  if (traceKind.startsWith("explore-"))
    return "frontierRecovery.qnt:1589 · sampled reconciliation profile"
  if (traceKind === "story-crash-after-intent")
    return "frontierRecovery_test.qnt:78"
  if (traceKind === "story-pause-independent")
    return "frontierRecovery_test.qnt:88"
  if (traceKind === "story-claim-loss")
    return "frontierRecovery_test.qnt:144"
  if (traceKind === "story-git-rewrite")
    return "frontierRecovery_test.qnt:174"
  if (traceKind === "story-external-completion")
    return "frontierRecovery_test.qnt:198"
  return "retained generated trace"
}

const actionName = (action: string): string => {
  const names: Readonly<Record<string, string>> = {
    advanceTargetCompatibly: "advance target compatibly",
    applyAndRecordCurrentBoundary: "apply claim request",
    authorityBecomesConflicting: "mark Task A authority conflicting",
    authorityBecomesUnreadable: "mark authority unreadable",
    classifyAuthorityConstraint: "isolate Task A",
    commitFirstIntent: "claim Task C",
    completeClaim: "complete claim protocol",
    crash: "coordinator crashes",
    externallyCompleteTask: "tracker completes task",
    loseClaim: "Task A claim disappears",
    observeTask: "reread Task A authority",
    recordBoundaryOutcome: "record observed outcome",
    requestApplies: "retry request applies",
    requestTaskPause: "pause task",
    requestTaskResume: "resume task",
    restart: "coordinator restarts",
    rewriteTarget: "rewrite Task A target",
    settleExternalCompletion: "settle external completion"
  }
  const picked = /^(.*)\(task ([0-3])\)$/.exec(action)
  if (picked !== null) {
    return `${names[picked[1] ?? ""] ?? picked[1]} · Task ${taskName(picked[2] ?? "")}`
  }
  return names[action] ?? action
}

const transitionChanges = (
  before: NormalizedFrame,
  after: NormalizedFrame
): ReadonlyArray<string> => {
  const changes: Array<string> = []
  if (before.coordinatorStatus !== after.coordinatorStatus) {
    changes.push(
      `coordinator: ${before.coordinatorStatus} → ${after.coordinatorStatus}`
    )
  }
  if (before.runPaused !== after.runPaused) {
    changes.push(`run: ${before.runPaused ? "paused" : "active"} → ${after.runPaused ? "paused" : "active"}`)
  }
  const beforeAdmission = before.admission.map(({ modelTaskId }) => modelTaskId)
  const afterAdmission = after.admission.map(({ modelTaskId }) => modelTaskId)
  if (beforeAdmission.join(",") !== afterAdmission.join(",")) {
    changes.push(
      `admitted tasks: ${taskSet(beforeAdmission)} → ${taskSet(afterAdmission)}`
    )
  }
  const fields = [
    ["paused", "pause"],
    ["responsibility", "responsibility"],
    ["boundary", "boundary"],
    ["isolation", "isolation"],
    ["lifecycle", "lifecycle"],
    ["claim", "claim"],
    ["worktree", "worktree"],
    ["invocation", "invocation"],
    ["observation", "knowledge"],
    ["readability", "authority readability"],
    ["knowledgeActivation", "knowledge activation"],
    ["knowledgeRevision", "knowledge revision"],
    ["authorityRevision", "authority revision"],
    ["settlement", "settlement"],
    ["baseCompatible", "Git lineage"],
    ["inTarget", "target membership"],
    ["promoted", "promotion"]
  ] as const
  for (const beforeTask of before.taskStates) {
    const afterTask = after.taskStates.find(
      ({ modelTaskId }) => modelTaskId === beforeTask.modelTaskId
    )
    if (afterTask === undefined) continue
    for (const [field, label] of fields) {
      if (beforeTask[field] !== afterTask[field]) {
        const display = (value: string | boolean): string => {
          if (typeof value !== "boolean") return value
          if (field === "paused") return value ? "paused" : "active"
          if (field === "baseCompatible")
            return value ? "compatible" : "rewritten/incompatible"
          if (field === "inTarget") return value ? "included" : "absent"
          if (field === "promoted") return value ? "promoted" : "not promoted"
          return value ? "yes" : "no"
        }
        changes.push(
          `Task ${taskName(beforeTask.modelTaskId)} ${label}: ${display(beforeTask[field])} → ${display(afterTask[field])}`
        )
      }
    }
  }
  return changes
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (typeof value === "object" && value !== null) {
    if (
      "#set" in value
      && Array.isArray(value["#set"])
    ) {
      const entries = value["#set"].map(canonicalJson).sort()
      return `{"#set":[${entries.join(",")}]}`
    }
    if (
      "#map" in value
      && Array.isArray(value["#map"])
    ) {
      const entries = value["#map"].map(canonicalJson).sort()
      return `{"#map":[${entries.join(",")}]}`
    }
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

const retainedQuintModelState = (
  frame: NormalizedFrame
): unknown => {
  const entry = Object.entries(frame.rawItfState)
    .find(([key]) => key.endsWith("::state"))
  if (entry === undefined) {
    throw new Error(`${frame.position} has no retained Quint model state`)
  }
  return entry[1]
}

export interface ObservedStateOccurrence {
  readonly frame: NormalizedFrame
  readonly traceKind: TraceKind
}

export interface ObservedStateNode {
  readonly firstSeenStep: number
  readonly id: string
  readonly occurrences: ReadonlyArray<ObservedStateOccurrence>
  readonly representative: NormalizedFrame
  readonly terminalTraceKinds: ReadonlyArray<TraceKind>
}

export interface ObservedTransitionEdge {
  readonly action: string
  readonly changes: ReadonlyArray<string>
  readonly id: string
  readonly source: string
  readonly target: string
  readonly traceKinds: ReadonlyArray<TraceKind>
}

export interface ObservedStateDag {
  readonly edges: ReadonlyArray<ObservedTransitionEdge>
  readonly nodes: ReadonlyArray<ObservedStateNode>
}

/**
 * Builds the observed state graph from retained traces. One exact Quint model
 * state has one node across every trace position; repeated states therefore
 * expose reconvergence, back edges, and self-loops instead of an unfolding.
 */
export const buildObservedStateDag = (
  traces: ReadonlyArray<NormalizedTrace>
): ObservedStateDag => {
  const mutableNodes: Array<{
    firstSeenStep: number
    id: string
    occurrences: Array<ObservedStateOccurrence>
    representative: NormalizedFrame
    terminalTraceKinds: Set<TraceKind>
  }> = []
  const nodeByIdentity = new Map<string, typeof mutableNodes[number]>()
  const mutableEdges = new Map<string, {
    action: string
    changes: ReadonlyArray<string>
    id: string
    source: string
    target: string
    traceKinds: Set<TraceKind>
  }>()

  for (const trace of traces) {
    const traceNodes = trace.frames.map((frame, index) => {
      const identity = canonicalJson(retainedQuintModelState(frame))
      let node = nodeByIdentity.get(identity)
      if (node === undefined) {
        node = {
          firstSeenStep: frame.step,
          id: `N${mutableNodes.length}`,
          occurrences: [],
          representative: frame,
          terminalTraceKinds: new Set()
        }
        mutableNodes.push(node)
        nodeByIdentity.set(identity, node)
      } else {
        node.firstSeenStep = Math.min(node.firstSeenStep, frame.step)
      }
      node.occurrences.push({
        frame,
        traceKind: trace.provenance.traceKind
      })
      if (index === trace.frames.length - 1) {
        node.terminalTraceKinds.add(trace.provenance.traceKind)
      }
      return node
    })

    traceNodes.slice(1).forEach((target, index) => {
      const source = traceNodes[index]
      const frame = trace.frames[index + 1]
      if (source === undefined || frame === undefined) return
      const action = eventLabel(frame)
      const identity = `${source.id}->${target.id}:${action}`
      let edge = mutableEdges.get(identity)
      if (edge === undefined) {
        edge = {
          action,
          changes: transitionChanges(source.representative, frame),
          id: `E${mutableEdges.size}`,
          source: source.id,
          target: target.id,
          traceKinds: new Set()
        }
        mutableEdges.set(identity, edge)
      }
      edge.traceKinds.add(trace.provenance.traceKind)
    })
  }

  return {
    edges: [...mutableEdges.values()].map((edge) => ({
      ...edge,
      traceKinds: [...edge.traceKinds]
    })),
    nodes: mutableNodes.map((node) => ({
      ...node,
      terminalTraceKinds: [...node.terminalTraceKinds]
    }))
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")

const htmlCode = (value: unknown): string =>
  `<code>${escapeHtml(
    typeof value === "string" ? value : JSON.stringify(value)
  )}</code>`

const renderHtmlTable = (trace: NormalizedTrace): string => {
  const headings = [
    "Step",
    "Observed transition",
    "What changed",
    "Task A",
    "Task C",
    "Admitted tasks",
    "Coordinator"
  ]
  const rows = trace.frames.map((frame, index) => {
    const previous = trace.frames[index - 1]
    const taskState = (modelTaskId: string): string => {
      const task = frame.taskStates.find(
        (candidate) => candidate.modelTaskId === modelTaskId
      )
      if (task === undefined) return "missing"
      return [
        task.boundary.replace("Boundary", ""),
        task.responsibility,
        task.isolation === "NotIsolated" ? "" : task.isolation,
        task.paused ? "Paused" : ""
      ].filter(Boolean).join(" · ")
    }
    const values = [
      frame.step,
      actionName(frame.action),
      previous === undefined
        ? "Initial state from the existing Quint test"
        : transitionChanges(previous, frame).join("; ") || "No displayed story field changed",
      taskState("0"),
      taskState("2"),
      taskSet(frame.admission.map(({ modelTaskId }) => modelTaskId)),
      frame.coordinatorStatus,
    ]
    return `<tr>${values.map((value) => `<td>${htmlCode(value)}</td>`).join("")}</tr>`
  })
  return `<div class="table-wrap"><table>
  <thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead>
  <tbody>${rows.join("\n")}</tbody>
</table></div>`
}

interface PositionedNode {
  readonly node: ObservedStateNode
  readonly x: number
  readonly y: number
}

const predecessorCount = (
  dag: ObservedStateDag,
  nodeId: string
): number =>
  new Set(
    dag.edges
      .filter(({ target }) => target === nodeId)
      .map(({ source }) => source)
  ).size

const renderDagSvg = (dag: ObservedStateDag): string => {
  const nodeWidth = 390
  const nodeHeight = 150
  const xGap = 190
  const yGap = 90
  const padding = 48
  const levels = new Map<number, ReadonlyArray<ObservedStateNode>>()
  for (const node of dag.nodes) {
    levels.set(
      node.firstSeenStep,
      [...(levels.get(node.firstSeenStep) ?? []), node]
    )
  }
  const positioned: Array<PositionedNode> = []
  for (const [depth, nodes] of [...levels.entries()].sort(([a], [b]) => a - b)) {
    nodes.forEach((node, index) => {
      positioned.push({
        node,
        x: padding + depth * (nodeWidth + xGap),
        y: padding + index * (nodeHeight + yGap)
      })
    })
  }
  const byId = new Map(positioned.map((entry) => [entry.node.id, entry]))
  const maxDepth = Math.max(0, ...dag.nodes.map((node) => node.firstSeenStep))
  const maxLevelSize = Math.max(
    1,
    ...[...levels.values()].map((nodes) => nodes.length)
  )
  const width = padding * 2 + (maxDepth + 1) * nodeWidth + maxDepth * xGap
  const height = padding * 2 + maxLevelSize * nodeHeight
    + Math.max(0, maxLevelSize - 1) * yGap

  const parallelEdges = new Map<string, ReadonlyArray<ObservedTransitionEdge>>()
  for (const edge of dag.edges) {
    const key = `${edge.source}->${edge.target}`
    parallelEdges.set(key, [...(parallelEdges.get(key) ?? []), edge])
  }
  const edges = dag.edges.map((edge) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (source === undefined || target === undefined) return ""
    const x1 = source.x + nodeWidth
    const y1 = source.y + nodeHeight / 2
    const x2 = target.x
    const y2 = target.y + nodeHeight / 2
    const middle = (x1 + x2) / 2
    const siblings = parallelEdges.get(`${edge.source}->${edge.target}`) ?? []
    const siblingIndex = siblings.findIndex(({ id }) => id === edge.id)
    const offset = (siblingIndex - (siblings.length - 1) / 2) * 38
    const firstChange = edge.changes[0] ?? "no displayed story field changed"
    return `<g class="edge" data-stories="${escapeHtml(edge.traceKinds.join(" "))}">
      <path d="M ${x1} ${y1} C ${middle} ${y1 + offset}, ${middle} ${y2 + offset}, ${x2} ${y2}" marker-end="url(#arrow)" />
      <text x="${middle}" y="${(y1 + y2) / 2 + offset - 14}" text-anchor="middle">
        <tspan x="${middle}" class="edge-action">${escapeHtml(actionName(edge.action))}</tspan>
        <tspan x="${middle}" dy="15">${escapeHtml(firstChange)}</tspan>
      </text>
    </g>`
  }).join("\n")

  const nodes = positioned.map(({ node, x, y }) => {
    const frame = node.representative
    const terminal = node.terminalTraceKinds.length === 0
      ? ""
      : node.terminalTraceKinds.map(storyName).join(" · ")
    const taskSummary = (
      task: NormalizedFrame["taskStates"][number]
    ): string =>
      `${taskName(task.modelTaskId)} · ${task.readability} r${task.authorityRevision} · ${task.paused ? "paused" : "active"} · ${task.responsibility}${task.isolation === "NotIsolated" ? "" : ` · ${task.isolation}`}`
    const observedStories = [
      ...new Set(node.occurrences.map(({ traceKind }) => traceKind))
    ]
    const predecessors = predecessorCount(dag, node.id)
    const nodeClass = [
      "node",
      node.terminalTraceKinds.includes("counterexample") ? "violation" : "",
      predecessors > 1 ? "reconvergent" : ""
    ].filter(Boolean).join(" ")
    const footer = predecessors > 1
      ? `↳ ${predecessors} distinct predecessors`
      : terminal
    return `<g class="${nodeClass}" data-node-id="${node.id}" data-stories="${escapeHtml(observedStories.join(" "))}" role="button" tabindex="0" transform="translate(${x} ${y})">
      <rect width="${nodeWidth}" height="${nodeHeight}" rx="10" />
      <text x="14" y="24" class="node-title">${node.id}</text>
      <text x="14" y="45">${frame.coordinatorStatus} · admitted tasks ${escapeHtml(taskSet(frame.admission.map(({ modelTaskId }) => modelTaskId)))}</text>
      ${frame.taskStates.map((task, index) => `<text x="14" y="${66 + index * 19}">${escapeHtml(taskSummary(task))}</text>`).join("\n")}
      <text x="14" y="143" class="${predecessors > 1 ? "reconvergence" : "terminal"}">${escapeHtml(footer)}</text>
    </g>`
  }).join("\n")

  return `<div class="dag-scroll"><svg class="dag" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="Observed Quint state graph">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
    ${edges}
    ${nodes}
  </svg></div>`
}

const browserDagData = (dag: ObservedStateDag): string =>
  JSON.stringify(Object.fromEntries(dag.nodes.map((node) => [
    node.id,
    {
      firstSeenStep: node.firstSeenStep,
      incoming: dag.edges
        .filter(({ target }) => target === node.id)
        .map(({ action, changes, source }) => ({
          action: actionName(action),
          changes,
          source
        })),
      occurrences: node.occurrences.map(({ frame, traceKind }) => ({
        action: eventLabel(frame),
        admission: frame.admission,
        admittedTasks: taskSet(
          frame.admission.map(({ modelTaskId }) => modelTaskId)
        ),
        comparison: frame.comparison,
        coordinator: frame.coordinatorStatus,
        explanations: frame.explanations,
        frontier: frame.frontier,
        occupied: frame.occupiedModelTaskIds,
        position: frame.position,
        rawItfState: frame.rawItfState,
        reserved: frame.reservedModelTaskIds,
        story: storyName(traceKind),
        taskStates: frame.taskStates,
        traceKind
      })),
      terminalTraceKinds: node.terminalTraceKinds
    }
  ]))).replaceAll("<", "\\u003c")

const renderAdmissionDecision = (
  trace: NormalizedTrace,
  title: string,
  reason: string
): string => {
  const frame = trace.frames[0]
  if (frame === undefined) throw new Error(`${title} has no Quint frame`)
  const frontier = taskSet(
    frame.frontier.map(({ modelTaskId }) => modelTaskId)
  )
  const admitted = taskSet(
    frame.admission.map(({ modelTaskId }) => modelTaskId)
  )
  const waiting = taskSet(
    frame.explanations.map(({ modelTaskId }) => modelTaskId)
  )
  const responsibilities = frame.taskStates
    .filter(({ modelTaskId }) => modelTaskId === "0" || modelTaskId === "2")
    .map((task) =>
      `Task ${taskName(task.modelTaskId)}: ${task.responsibility}`
    )
    .join(" · ")
  return `<article class="decision">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(responsibilities)}</p>
    <div class="decision-flow">
      <div><small>Frontier</small><strong>${escapeHtml(frontier)}</strong></div>
      <span>→</span>
      <div><small>Admitted</small><strong>${escapeHtml(admitted)}</strong></div>
      <span>+</span>
      <div><small>CapacityWait</small><strong>${escapeHtml(waiting)}</strong></div>
    </div>
    <p>${escapeHtml(reason)}</p>
    <details><summary>Exact Quint provenance</summary><p class="provenance">${escapeHtml(JSON.stringify(trace.provenance))}</p></details>
  </article>`
}

const renderAdmissionPressure = (
  freshPriorityTrace: NormalizedTrace,
  responsibilityPriorityTrace: NormalizedTrace
): string => `<section class="admission-story">
  <h2>Story 2 · Admission pressure at capacity one</h2>
  <p>Both states come from executable Quint profiles. The frontier stays <code>{A, C}</code>; capacity admits one task and gives the other an exact <code>CapacityWait</code> explanation.</p>
  <div class="decision-grid">
    ${renderAdmissionDecision(
      freshPriorityTrace,
      "Two fresh tasks",
      "A wins the deterministic fresh-task ordering; C remains in the frontier and waits for released capacity or changed reconstructed state."
    )}
    ${renderAdmissionDecision(
      responsibilityPriorityTrace,
      "Existing responsibility first",
      "C already carries Outstanding responsibility, so C is admitted ahead of smaller fresh Task A; A remains in the frontier with CapacityWait."
    )}
  </div>
</section>`

export const renderObservedDagHtml = (
  traces: ReadonlyArray<NormalizedTrace>,
  freshPriorityTrace: NormalizedTrace,
  responsibilityPriorityTrace: NormalizedTrace
): string => {
  const dag = buildObservedStateDag(traces)
  const reconvergenceCount = dag.nodes.filter(
    ({ id }) => predecessorCount(dag, id) > 1
  ).length
  const provenance = traces.map(({ provenance: item }) => item)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quint workflow stories</title>
  <style>
    :root { color-scheme: dark; }
    body { background: #0d1217; color: #e7edf3; font: 15px/1.45 system-ui, sans-serif; margin: 0; padding: 24px; }
    h1, h2 { margin-top: 0; }
    [hidden] { display: none !important; }
    .view-switch { display: flex; gap: 8px; margin: 0 0 20px; }
    .view-switch button { background: #24313d; border: 1px solid #52687a; border-radius: 8px; color: #dce6ee; cursor: pointer; font-weight: 700; padding: 9px 14px; }
    .view-switch button.active { background: #155f86; border-color: #66c2ff; color: white; }
    .status { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; }
    .story-filter { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .story-filter button { background: #24313d; border: 1px solid #52687a; border-radius: 999px; color: #dce6ee; cursor: pointer; padding: 6px 11px; }
    .story-filter button.active { background: #155f86; border-color: #66c2ff; color: white; }
    .badge { background: #623c12; border: 1px solid #c8852f; border-radius: 999px; color: #ffd899; font-weight: 700; padding: 4px 10px; }
    .provenance { color: #91a2b3; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .workspace { display: grid; gap: 18px; grid-template-columns: minmax(0, 3fr) minmax(360px, 2fr); margin: 20px 0; }
    .side-column { display: grid; gap: 18px; min-width: 0; }
    section { background: #171f27; border: 1px solid #34414d; border-radius: 10px; padding: 16px; overflow: auto; }
    .dag-scroll { min-height: 430px; overflow: auto; }
    .dag .edge path { fill: none; stroke: #77899a; stroke-width: 2; }
    .dag .edge text { fill: #b8c4cf; font-size: 11px; paint-order: stroke; stroke: #0d1217; stroke-width: 4px; }
    .dag .edge .edge-action { fill: #fff; font-weight: 700; }
    .dag marker path { fill: #77899a; }
    .dag .node { cursor: pointer; outline: none; }
    .dag .node rect { fill: #23303b; stroke: #6b8194; stroke-width: 2; }
    .dag .node:hover rect, .dag .node:focus rect, .dag .node.selected rect { fill: #29445a; stroke: #66c2ff; stroke-width: 3; }
    .dag .node.violation rect { fill: #4a2528; stroke: #ef6b73; }
    .dag .node.reconvergent rect { fill: #3d351d; stroke: #f0bd4f; stroke-width: 3; }
    .dag .node text { fill: #dfe8ef; font-size: 12px; pointer-events: none; }
    .dag .node .node-title { fill: #fff; font-size: 14px; font-weight: 700; }
    .dag .node .terminal { fill: #ef9ca2; font-size: 10px; }
    .dag .node .reconvergence { fill: #ffd778; font-size: 11px; font-weight: 700; }
    .dag .dimmed { opacity: .1; }
    #inspector pre { background: #0d1217; border-radius: 6px; max-height: 440px; overflow: auto; padding: 10px; white-space: pre-wrap; word-break: break-word; }
    #inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px 10px; }
    #inspector dt { color: #91a2b3; }
    #inspector dd { margin: 0; overflow-wrap: anywhere; }
    #inspector table { min-width: 620px; }
    .table-wrap { max-height: 68vh; overflow: auto; }
    .admission-story { overflow: visible; }
    .decision-grid { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .decision { background: #111820; border: 1px solid #465564; border-radius: 10px; padding: 18px; }
    .decision-flow { align-items: center; display: grid; gap: 10px; grid-template-columns: 1fr auto 1fr auto 1fr; margin: 20px 0; text-align: center; }
    .decision-flow div { background: #202c36; border: 1px solid #52687a; border-radius: 8px; padding: 12px 8px; }
    .decision-flow small, .decision-flow strong { display: block; }
    .decision-flow small { color: #91a2b3; margin-bottom: 5px; }
    .decision-flow strong { color: #fff; font-size: 18px; }
    table { border-collapse: collapse; min-width: 1500px; width: 100%; }
    th, td { border: 1px solid #465564; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #25313c; position: sticky; top: 0; z-index: 1; }
    td code { white-space: pre-wrap; word-break: break-word; }
    details.trace { border-top: 1px solid #34414d; margin-top: 12px; padding-top: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    @media (max-width: 1000px) { .workspace, .decision-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Quint workflow stories</h1>
  <nav class="view-switch" aria-label="Choose a modeled story">
    <button class="active" data-view="reconciliation">1 · Branch-local reconciliation</button>
    <button data-view="admission">2 · Admission pressure</button>
  </nav>
  <div data-view-panel="reconciliation">
  <h2>Story 1 · Observed state graph</h2>
  <div class="status">
    <span class="badge">Observed paths · not exhaustive</span>
    <span>${dag.nodes.length} exact states · ${dag.edges.length} observed transitions · ${reconvergenceCount} states with multiple predecessors</span>
  </div>
  <p>These paths were sampled from the real nondeterministic <code>reconciliationProfileStep</code> action in <code>specs/frontierRecovery.qnt</code>. Task A starts <code>Outstanding</code>; Task C can be claimed before or after A loses authority. Each pair reconverges, rereads A, then isolates only A while C remains <code>Outstanding</code>.</p>
  <p>Equal full Quint model states are one node, regardless of trace position. An absent edge is unknown, not disabled.</p>
  <p><strong>Reading admission:</strong> <code>{A, C}</code> means Tasks A and C are admitted; it is not a numeric count. These are executable Quint-model traces from checked-in code, not fabricated UI fixtures and not production TypeScript runtime logs.</p>
  <nav class="story-filter" aria-label="Highlight one real acceptance story">
    <button class="active" data-story-filter="all">All branches</button>
    ${traces.map(({ provenance: { traceKind } }) => `<button data-story-filter="${traceKind}" title="${escapeHtml(storySource(traceKind))}">${escapeHtml(storyName(traceKind))}</button>`).join("\n")}
  </nav>
  <details><summary>Exact source provenance</summary><p class="provenance">${escapeHtml(JSON.stringify(provenance))}</p></details>
  <div class="workspace">
    <section>
      <h2>Branching and reconvergence</h2>
      ${renderDagSvg(dag)}
    </section>
    <div class="side-column">
      <section>
        <h2>Frame tables</h2>
        ${traces.map((trace, index) => `<details class="trace"${index === 0 ? " open" : ""}><summary>${escapeHtml(storyName(trace.provenance.traceKind))} · ${escapeHtml(storySource(trace.provenance.traceKind))} · ${trace.frames.length} frames</summary>${renderHtmlTable(trace)}</details>`).join("\n")}
      </section>
      <section id="inspector">
        <h2>Selected state</h2>
        <p>Click a node to inspect its normalized values and raw ITF state.</p>
      </section>
    </div>
  </div>
  </div>
  <div data-view-panel="admission" hidden>
    ${renderAdmissionPressure(
      freshPriorityTrace,
      responsibilityPriorityTrace
    )}
  </div>
  <script>
    const nodes = ${browserDagData(dag)};
    const inspector = document.querySelector("#inspector");
    const nodeElements = [...document.querySelectorAll("[data-node-id]")];
    const graphElements = [...document.querySelectorAll(".dag [data-stories]")];
    const storyButtons = [...document.querySelectorAll("[data-story-filter]")];
    const viewButtons = [...document.querySelectorAll("[data-view]")];
    const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
    const escapeText = (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const selectNode = (id) => {
      const node = nodes[id];
      if (!node || !inspector) return;
      nodeElements.forEach((element) =>
        element.classList.toggle("selected", element.dataset.nodeId === id)
      );
      const occurrence = node.occurrences[0];
      const seenIn = node.occurrences
        .map((item) => item.story + " · " + item.position)
        .join(", ");
      const incoming = node.incoming
        .map((edge) => "<strong>from " + escapeText(edge.source) + " via " + escapeText(edge.action) + "</strong><br>" + edge.changes.map(escapeText).join("<br>"))
        .join("<hr>");
      const taskRows = occurrence.taskStates.map((task) => \`
        <tr>
          <td>Task \${escapeText(["A", "B", "C", "D"][Number(task.modelTaskId)])}</td>
          <td>\${escapeText(task.boundary.replace("Boundary", ""))}</td>
          <td>\${escapeText(task.readability)} r\${escapeText(task.authorityRevision)}</td>
          <td>\${escapeText(task.responsibility)}</td>
          <td>\${escapeText(task.isolation)}</td>
          <td>\${task.paused ? "yes" : "no"}</td>
        </tr>
      \`).join("");
      inspector.innerHTML = \`
        <h2>\${escapeText(id)}</h2>
        <dl>
          <dt>seen in</dt><dd>\${escapeText(seenIn)}</dd>
          <dt>arrived via</dt><dd>\${incoming || "initial state"}</dd>
          <dt>coordinator</dt><dd>\${escapeText(occurrence.coordinator)}</dd>
          <dt>admitted tasks</dt><dd>\${escapeText(occurrence.admittedTasks)}</dd>
        </dl>
        <div class="table-wrap"><table>
          <thead><tr><th>Task</th><th>Boundary</th><th>Authority</th><th>Responsibility</th><th>Isolation</th><th>Paused</th></tr></thead>
          <tbody>\${taskRows}</tbody>
        </table></div>
        <details><summary>Raw ITF state</summary><pre>\${escapeText(JSON.stringify(occurrence.rawItfState, null, 2))}</pre></details>
      \`;
    };
    nodeElements.forEach((element) => {
      element.addEventListener("click", () => selectNode(element.dataset.nodeId));
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(element.dataset.nodeId);
        }
      });
    });
    storyButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const selectedStory = button.dataset.storyFilter;
        storyButtons.forEach((candidate) =>
          candidate.classList.toggle("active", candidate === button)
        );
        graphElements.forEach((element) => {
          const stories = (element.dataset.stories || "").split(" ");
          element.classList.toggle(
            "dimmed",
            selectedStory !== "all" && !stories.includes(selectedStory)
          );
        });
      });
    });
    const selectView = (view) => {
      viewButtons.forEach((button) =>
        button.classList.toggle("active", button.dataset.view === view)
      );
      viewPanels.forEach((panel) => {
        panel.hidden = panel.dataset.viewPanel !== view;
      });
      const url = new URL(window.location.href);
      url.searchParams.set("story", view);
      history.replaceState(null, "", url);
    };
    viewButtons.forEach((button) =>
      button.addEventListener("click", () => selectView(button.dataset.view))
    );
    const requestedView = new URL(window.location.href).searchParams.get("story");
    selectView(requestedView === "admission" ? "admission" : "reconciliation");
    selectNode(nodeElements[0]?.dataset.nodeId);
  </script>
</body>
</html>
`
}
