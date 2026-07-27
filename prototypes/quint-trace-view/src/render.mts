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
    acceptInvocation: "complete executor invocation",
    addBlockerToC: "tracker adds a blocker to Task C",
    applyAndRecordCurrentBoundary: "apply claim request",
    authorityBecomesConflicting: "mark Task A authority conflicting",
    authorityBecomesUnreadable: "mark authority unreadable",
    classifyAuthorityConstraint: "isolate Task A",
    commitFirstIntent: "record first claim intent",
    commitResponsibleIntent: "record the next owned-work intent",
    completeClaim: "complete claim protocol",
    completeResponsibleBoundary: "complete the current authority boundary",
    completeSuccessfulTask: "run the successful task protocol",
    crash: "coordinator crashes",
    externallyCompleteTask: "tracker completes task",
    loseClaim: "Task A claim disappears",
    loseWorktree: "Task A worktree disappears",
    observeTask: "reread task authority",
    recordBoundaryOutcome: "record observed outcome",
    recordInterruptedInvocation: "record confirmed interruption",
    providerAcceptsInvocation: "provider accepts invocation",
    providerInterruptsInvocation: "provider confirms interruption",
    reachInvocation: "reach the invocation boundary",
    requestApplies: "authority request applies",
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

const taskFrom = (
  frame: NormalizedFrame,
  modelTaskId: string
): NormalizedFrame["taskStates"][number] => {
  const task = frame.taskStates.find(
    (candidate) => candidate.modelTaskId === modelTaskId
  )
  if (task === undefined) {
    throw new Error(`${frame.position} has no Task ${taskName(modelTaskId)}`)
  }
  return task
}

const traceWithKind = (
  traces: ReadonlyArray<NormalizedTrace>,
  traceKind: TraceKind,
  fallback: NormalizedTrace
): NormalizedTrace =>
  traces.find((trace) => trace.provenance.traceKind === traceKind) ?? fallback

const renderEvidence = (trace: NormalizedTrace): string =>
  `<details class="evidence"><summary>Real Quint evidence · ${trace.frames.length} frames</summary>
    <p class="provenance">${escapeHtml(storySource(trace.provenance.traceKind))}</p>
    <p class="provenance">${escapeHtml(JSON.stringify(trace.provenance))}</p>
    ${renderHtmlTable(trace)}
  </details>`

const renderMilestones = (
  trace: NormalizedTrace,
  actions: ReadonlyArray<string>,
  explanations: Readonly<Record<string, string>>,
  minimumStep = 0
): string => {
  const chosen = trace.frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame, index }) =>
      index === 0
        || (frame.step >= minimumStep && actions.includes(frame.action))
    )
  return `<div class="milestones">${chosen.map(({ frame, index }, position) => {
    const taskA = taskFrom(frame, "0")
    const taskC = taskFrom(frame, "2")
    const previous = trace.frames[index - 1]
    const changes = previous === undefined
      ? ["Initial state supplied by the named Quint scenario"]
      : transitionChanges(previous, frame)
    const admitted = taskSet(
      frame.admission.map(({ modelTaskId }) => modelTaskId)
    )
    const wait = taskSet(
      frame.explanations.map(({ modelTaskId }) => modelTaskId)
    )
    const taskATransition = frame.frontier.find(
      ({ modelTaskId }) => modelTaskId === "0"
    )
    return `<article class="milestone">
      <header><span>${position + 1}</span><div><small>${frame.position} · ${escapeHtml(frame.action)}</small><h3>${escapeHtml(actionName(frame.action))}</h3></div></header>
      <p class="why">${escapeHtml(explanations[frame.action] ?? "Observe the exact modeled state change.")}</p>
      <dl>
        <dt>Coordinator</dt><dd>${escapeHtml(frame.coordinatorStatus)}</dd>
        <dt>Task A obligation</dt><dd>${escapeHtml(`${taskA.responsibility} · ${taskA.boundary.replace("Boundary", "")}`)}</dd>
        <dt>Task A authority</dt><dd>${escapeHtml(`${taskA.claim} · ${taskA.worktree} worktree · ${taskA.invocation}`)}</dd>
        <dt>Task A control</dt><dd>${taskA.paused ? "Paused" : "Active"}${taskA.isolation === "NotIsolated" ? "" : ` · ${escapeHtml(taskA.isolation)}`}</dd>
        ${taskATransition === undefined ? "" : `<dt>Task A transition</dt><dd>${escapeHtml(`${taskATransition.transitionTag} · operation ${taskATransition.modelOperationId}`)}</dd>`}
        <dt>Task C obligation</dt><dd>${escapeHtml(taskC.responsibility)}</dd>
        <dt>${frame.coordinatorStatus === "Crashed" ? "Derived projection (inactive)" : "Frontier → admitted"}</dt><dd>${escapeHtml(`${taskSet(frame.frontier.map(({ modelTaskId }) => modelTaskId))} → ${admitted}`)}</dd>
        ${frame.explanations.length === 0 ? "" : `<dt>CapacityWait</dt><dd>${escapeHtml(wait)}</dd>`}
      </dl>
      <p class="changes">${escapeHtml(changes.join(" · ") || "No displayed decision field changed")}</p>
    </article>`
  }).join("")}</div>`
}

const renderAdmissionDecision = (
  trace: NormalizedTrace,
  title: string,
  reason: string
): string => {
  const frame = trace.frames[0]
  if (frame === undefined) throw new Error(`${title} has no Quint frame`)
  const responsibilities = ["0", "2"]
    .map((id) => {
      const task = taskFrom(frame, id)
      return `Task ${taskName(id)}: ${task.responsibility}`
    })
    .join(" · ")
  return `<article class="decision">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(responsibilities)}</p>
    <div class="decision-flow">
      <div><small>Frontier</small><strong>${escapeHtml(taskSet(frame.frontier.map(({ modelTaskId }) => modelTaskId)))}</strong></div>
      <span>→</span>
      <div><small>Admitted</small><strong>${escapeHtml(taskSet(frame.admission.map(({ modelTaskId }) => modelTaskId)))}</strong></div>
      <span>+</span>
      <div><small>CapacityWait</small><strong>${escapeHtml(taskSet(frame.explanations.map(({ modelTaskId }) => modelTaskId)))}</strong></div>
    </div>
    <p>${escapeHtml(reason)}</p>
  </article>`
}

const renderConstraintCard = (
  trace: NormalizedTrace,
  title: string,
  subjectId: string,
  consequence: string
): string => {
  const frame = trace.frames.at(-1)
  if (frame === undefined) throw new Error(`${title} has no terminal frame`)
  const subject = taskFrom(frame, subjectId)
  const other = taskFrom(frame, subjectId === "0" ? "2" : "0")
  return `<article class="constraint">
    <small>${escapeHtml(trace.provenance.traceKind)}</small>
    <h3>${escapeHtml(title)}</h3>
    <p><strong>Exact subject:</strong> Task ${escapeHtml(taskName(subjectId))}</p>
    <p><strong>Result:</strong> ${escapeHtml(`${subject.responsibility} · ${subject.isolation}`)}</p>
    <p><strong>Independent task:</strong> ${escapeHtml(`${taskName(other.modelTaskId)} · ${other.responsibility}`)}</p>
    <p>${escapeHtml(consequence)}</p>
  </article>`
}

export const renderObservedDagHtml = (
  traces: ReadonlyArray<NormalizedTrace>,
  freshPriorityTrace: NormalizedTrace,
  responsibilityPriorityTrace: NormalizedTrace
): string => {
  const crash = traceWithKind(
    traces,
    "story-crash-after-intent",
    freshPriorityTrace
  )
  const pause = traceWithKind(traces, "story-pause-resume", freshPriorityTrace)
  const externalCompletion = traceWithKind(
    traces,
    "story-external-completion",
    freshPriorityTrace
  )
  const success = traceWithKind(traces, "story-success", freshPriorityTrace)
  const claimLoss = traceWithKind(
    traces,
    "story-claim-loss",
    freshPriorityTrace
  )
  const gitRewrite = traceWithKind(
    traces,
    "story-git-rewrite",
    freshPriorityTrace
  )
  const lostWorktree = traceWithKind(
    traces,
    "story-lost-worktree",
    freshPriorityTrace
  )
  const blocker = traceWithKind(traces, "story-blocker", freshPriorityTrace)
  const exploration = traces.filter(
    ({ provenance }) => provenance.traceKind.startsWith("explore-")
  )
  const dag = buildObservedStateDag(
    exploration.length === 0 ? [freshPriorityTrace] : exploration
  )
  const reconvergenceCount = dag.nodes.filter(
    ({ id }) => predecessorCount(dag, id) > 1
  ).length
  const storyKeys = ["crash", "pause", "completion", "success", "changes"]
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quint workflow stories</title>
  <style>
    :root { color-scheme: dark; }
    body { background: #0b1015; color: #e7edf3; font: 15px/1.45 system-ui, sans-serif; margin: 0; padding: 28px 28px 96px; }
    h1, h2, h3 { margin-top: 0; }
    h1 { font-size: clamp(28px, 4vw, 44px); margin-bottom: 6px; }
    h2 { font-size: 26px; }
    h3 { margin-bottom: 8px; }
    code { color: #9fd9ff; }
    [hidden] { display: none !important; }
    .lede { color: #aebdca; font-size: 17px; margin: 0 0 22px; max-width: 920px; }
    .view-switch { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 24px; position: sticky; top: 0; z-index: 4; background: linear-gradient(#0b1015 78%, transparent); padding: 12px 0 18px; }
    .view-switch button { background: #1d2933; border: 1px solid #465d70; border-radius: 8px; color: #dce6ee; cursor: pointer; font-weight: 700; padding: 9px 13px; }
    .view-switch button.active { background: #155f86; border-color: #66c2ff; color: white; }
    .question { border-left: 4px solid #66c2ff; color: #d9e9f5; font-size: 18px; margin: 18px 0; padding: 6px 14px; }
    .verdict { background: #123d34; border: 1px solid #2f9b7c; border-radius: 10px; color: #aef0db; font-weight: 700; padding: 12px 15px; }
    .gap { background: #3a2a13; border: 1px solid #a97832; border-radius: 10px; color: #ffdba3; margin: 18px 0; padding: 14px 16px; }
    .status { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; }
    .story-filter { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .story-filter button { background: #24313d; border: 1px solid #52687a; border-radius: 999px; color: #dce6ee; cursor: pointer; padding: 6px 11px; }
    .story-filter button.active { background: #155f86; border-color: #66c2ff; color: white; }
    .badge { background: #623c12; border: 1px solid #c8852f; border-radius: 999px; color: #ffd899; font-weight: 700; padding: 4px 10px; }
    .provenance { color: #91a2b3; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .workspace { display: grid; gap: 18px; grid-template-columns: minmax(0, 3fr) minmax(360px, 2fr); margin: 20px 0; }
    .side-column { display: grid; gap: 18px; min-width: 0; }
    section { background: #171f27; border: 1px solid #34414d; border-radius: 10px; padding: 16px; overflow: auto; }
    .story { margin: 0 auto; max-width: 1500px; overflow: visible; padding: 24px; }
    .milestones { display: grid; gap: 14px; grid-auto-columns: minmax(290px, 360px); grid-auto-flow: column; overflow-x: auto; padding: 4px 2px 18px; scroll-snap-type: x proximity; }
    .milestone { background: #101820; border: 1px solid #405262; border-radius: 12px; min-height: 410px; padding: 16px; scroll-snap-align: start; }
    .milestone header { align-items: center; display: flex; gap: 10px; }
    .milestone header > span { align-items: center; background: #155f86; border-radius: 50%; display: flex; flex: 0 0 32px; font-weight: 800; height: 32px; justify-content: center; }
    .milestone header small, .constraint small { color: #8ca0b2; font-family: ui-monospace, monospace; }
    .milestone header h3 { margin: 2px 0 0; }
    .milestone .why { color: #c7d4de; min-height: 62px; }
    .milestone dl { display: grid; gap: 5px 9px; grid-template-columns: max-content 1fr; }
    .milestone dt { color: #8ca0b2; }
    .milestone dd { margin: 0; overflow-wrap: anywhere; }
    .changes { border-top: 1px solid #34414d; color: #92c9ec; font-size: 13px; margin-top: 15px; padding-top: 12px; }
    .evidence { border-top: 1px solid #34414d; margin-top: 20px; padding-top: 14px; }
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
    .decision-grid { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .decision { background: #111820; border: 1px solid #465564; border-radius: 10px; padding: 18px; }
    .decision-flow { align-items: center; display: grid; gap: 10px; grid-template-columns: 1fr auto 1fr auto 1fr; margin: 20px 0; text-align: center; }
    .decision-flow div { background: #202c36; border: 1px solid #52687a; border-radius: 8px; padding: 12px 8px; }
    .decision-flow small, .decision-flow strong { display: block; }
    .decision-flow small { color: #91a2b3; margin-bottom: 5px; }
    .decision-flow strong { color: #fff; font-size: 18px; }
    .constraint-grid { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(220px, 1fr)); }
    .constraint { background: #101820; border: 1px solid #465564; border-radius: 10px; padding: 16px; }
    .prototype-switcher { align-items: center; backdrop-filter: blur(12px); background: #101820ee; border: 1px solid #607488; border-radius: 999px; bottom: 18px; box-shadow: 0 8px 35px #0009; display: flex; gap: 8px; left: 50%; padding: 7px; position: fixed; transform: translateX(-50%); z-index: 10; }
    .prototype-switcher button { background: #253542; border: 0; border-radius: 50%; color: white; cursor: pointer; font-size: 20px; height: 38px; width: 38px; }
    .prototype-switcher output { font-weight: 700; min-width: 230px; text-align: center; }
    table { border-collapse: collapse; min-width: 1500px; width: 100%; }
    th, td { border: 1px solid #465564; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #25313c; position: sticky; top: 0; z-index: 1; }
    td code { white-space: pre-wrap; word-break: break-word; }
    details.trace { border-top: 1px solid #34414d; margin-top: 12px; padding-top: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    @media (max-width: 1000px) { .workspace, .decision-grid, .constraint-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Quint workflow stories</h1>
  <p class="lede">Five questions answered by executable traces from the checked-in Dalph frontier-recovery model. Each view separates external authority, durable responsibility, process-local coordination, and the selector’s decision.</p>
  <nav class="view-switch" aria-label="Choose a modeled story">
    <button class="active" data-view="crash">1 · Crash safety</button>
    <button data-view="pause">2 · Pause and capacity</button>
    <button data-view="completion">3 · External completion</button>
    <button data-view="success">4 · Successful task</button>
    <button data-view="changes">5 · External changes</button>
  </nav>
  <div class="story" data-view-panel="crash">
    <h2>Story 1 · A crash cannot erase an obligation</h2>
    <p class="question">Dalph recorded intent to claim Task A, then the coordinator died. May restart blindly repeat the request?</p>
    <p class="verdict">No. The outstanding responsibility and operation survive; restart invalidates old knowledge, requires a fresh authority read, and only then permits the same request.</p>
    ${renderMilestones(
      crash,
      ["commitFirstIntent", "crash", "restart", "observeTask", "requestApplies"],
      {
        init: "A is fresh work. No durable workflow obligation exists yet.",
        commitFirstIntent: "The journal now creates an Outstanding obligation before crossing the claim boundary.",
        crash: "Only the process-local coordinator stops. Durable intent and responsibility remain.",
        restart: "A new activation starts. Pre-crash authority knowledge is no longer usable.",
        observeTask: "Dalph rereads the tracker-owned claim fact for this exact task and operation.",
        requestApplies: "After the fresh check, the same operation may safely reach the authority boundary."
      }
    )}
    ${renderEvidence(crash)}
  </div>

  <div class="story" data-view-panel="pause" hidden>
    <h2>Story 2 · Pause preserves work but invalidates permission to continue</h2>
    <p class="question">Task A is running when the user pauses it. What survives, and what must happen before it runs again?</p>
    <p class="verdict">A keeps its claim, worktree, session, and Outstanding responsibility. Its invocation is interrupted; resume alone is insufficient—a fresh read must precede the next invocation intent.</p>
    ${renderMilestones(
      pause,
      [
        "recordBoundaryOutcome",
        "requestApplies",
        "requestTaskPause",
        "providerInterruptsInvocation",
        "observeTask",
        "recordInterruptedInvocation",
        "requestTaskResume",
        "commitResponsibleIntent"
      ],
      {
        init: "The scenario begins before Task A has any owned work.",
        recordBoundaryOutcome: "An earlier authority boundary is confirmed; the durable workflow advances.",
        requestApplies: "The executor invocation is now externally running.",
        requestTaskPause: "The user changes desired control state; ownership is preserved.",
        providerInterruptsInvocation: "The provider reports the running invocation interrupted.",
        observeTask: "Fresh provider and authority facts replace knowledge invalidated by the control change.",
        recordInterruptedInvocation: "Dalph records the known interruption without abandoning the attempt.",
        requestTaskResume: "Resume removes the pause request but does not authorize stale work.",
        commitResponsibleIntent: "Only after the post-resume reread may the existing responsibility continue."
      },
      12
    )}
    <h2>Capacity-one ordering</h2>
    <div class="decision-grid">
      ${renderAdmissionDecision(
        freshPriorityTrace,
        "No existing responsibility",
        "Fresh A wins canonical task order; fresh C receives CapacityWait."
      )}
      ${renderAdmissionDecision(
        responsibilityPriorityTrace,
        "C already has responsibility",
        "Outstanding C is admitted before fresh A, despite A's smaller identity."
      )}
    </div>
    <p class="gap"><strong>Model gap:</strong> the current Quint selector always exports an empty occupied-task set. This trace proves pause/interruption and responsibility-first ordering separately; it does not yet show one end-to-end occupied-position handoff to another task.</p>
    ${renderEvidence(pause)}
  </div>

  <div class="story" data-view-panel="completion" hidden>
    <h2>Story 3 · The tracker completes a task while Dalph still owns work</h2>
    <p class="question">Task A completes externally after Dalph claimed it. Should Dalph integrate or complete it again?</p>
    <p class="verdict">No. A fresh tracker observation settles the existing responsibility directly; the model records zero Dalph completion-boundary effects.</p>
    ${renderMilestones(
      externalCompletion,
      ["completeClaim", "recordBoundaryOutcome", "externallyCompleteTask", "observeTask", "settleExternalCompletion"],
      {
        init: "Task A is open, unclaimed, and unowned.",
        completeClaim: "The scenario establishes Dalph's exact claim responsibility.",
        recordBoundaryOutcome: "The claim boundary is confirmed and the workflow moves toward worktree creation.",
        externallyCompleteTask: "The task tracker—not Dalph—changes A to Completed.",
        observeTask: "Dalph learns that external fact through a fresh authoritative read.",
        settleExternalCompletion: "The outstanding responsibility becomes Settled without executing Dalph's completion request."
      }
    )}
    <p class="gap"><strong>Model boundary:</strong> this trace proves no duplicate modeled completion effect. WIP preservation and dependent-task release are specified but not represented end-to-end in this Quint trace.</p>
    ${renderEvidence(externalCompletion)}
  </div>

  <div class="story" data-view-panel="success" hidden>
    <h2>Story 4 · One successful task crosses eight distinct boundaries</h2>
    <p class="question">What must become authoritative before Dalph may call the task settled?</p>
    <p class="verdict">Claim, worktree, session, invocation, promotion, completion claim, tracker completion, and claim deletion each use their own intent → request → observation → outcome cycle.</p>
    ${renderMilestones(
      success,
      ["recordBoundaryOutcome", "providerAcceptsInvocation"],
      {
        init: "No task responsibility exists.",
        recordBoundaryOutcome: "Fresh authority evidence confirms exactly one boundary and advances to the next.",
        providerAcceptsInvocation: "The provider reports the exact invocation accepted; Dalph still must observe and record that result."
      }
    )}
    ${renderEvidence(success)}
  </div>

  <div class="story" data-view-panel="changes" hidden>
    <h2>Story 5 · External changes have different consequences</h2>
    <p class="question">If the outside world changes while Task A is owned, which exact obligation stops—and does independent Task C continue?</p>
    <div class="constraint-grid">
      ${renderConstraintCard(
        claimLoss,
        "Claim becomes foreign",
        "0",
        "A is isolated behind claim authority. C becomes Outstanding."
      )}
      ${renderConstraintCard(
        gitRewrite,
        "Target history is rewritten",
        "0",
        "A is isolated behind Git lineage. C becomes Outstanding."
      )}
      ${renderConstraintCard(
        lostWorktree,
        "Planned worktree disappears",
        "0",
        "A records worktree-loss isolation and retains its Outstanding responsibility."
      )}
      ${renderConstraintCard(
        blocker,
        "A new blocker appears on C",
        "2",
        "C remains Unowned while independent A becomes Outstanding."
      )}
    </div>
    <p class="gap"><strong>Not executable in this model:</strong> task-edit continue/restart/stop choices, lifecycle close/reopen, target-membership removal/return, Git compare-and-set promotion races, and executor-internal restoration.</p>
    <details><summary>Observed reconciliation interleavings · secondary diagnostic</summary>
      <div class="status"><span class="badge">Observed paths · not exhaustive</span><span>${dag.nodes.length} exact states · ${dag.edges.length} transitions · ${reconvergenceCount} reconvergences</span></div>
      ${renderDagSvg(dag)}
    </details>
    ${renderEvidence(claimLoss)}
    ${renderEvidence(gitRewrite)}
    ${renderEvidence(lostWorktree)}
    ${renderEvidence(blocker)}
  </div>

  <div class="prototype-switcher" aria-label="Prototype story switcher">
    <button type="button" data-cycle="-1" aria-label="Previous story">←</button>
    <output>1 · Crash safety</output>
    <button type="button" data-cycle="1" aria-label="Next story">→</button>
  </div>

  <script>
    const storyKeys = ${JSON.stringify(storyKeys)};
    const storyLabels = {
      crash: "1 · Crash safety",
      pause: "2 · Pause and capacity",
      completion: "3 · External completion",
      success: "4 · Successful task",
      changes: "5 · External changes"
    };
    const viewButtons = [...document.querySelectorAll("[data-view]")];
    const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
    const storyOutput = document.querySelector(".prototype-switcher output");
    const selectView = (view) => {
      const selected = storyKeys.includes(view) ? view : storyKeys[0];
      viewButtons.forEach((button) =>
        button.classList.toggle("active", button.dataset.view === selected)
      );
      viewPanels.forEach((panel) => {
        panel.hidden = panel.dataset.viewPanel !== selected;
      });
      if (storyOutput) storyOutput.value = storyLabels[selected];
      const url = new URL(window.location.href);
      url.searchParams.set("story", selected);
      history.replaceState(null, "", url);
    };
    const cycle = (direction) => {
      const current = new URL(window.location.href).searchParams.get("story");
      const index = Math.max(0, storyKeys.indexOf(current));
      selectView(storyKeys[(index + direction + storyKeys.length) % storyKeys.length]);
    };
    viewButtons.forEach((button) =>
      button.addEventListener("click", () => selectView(button.dataset.view))
    );
    document.querySelectorAll("[data-cycle]").forEach((button) =>
      button.addEventListener("click", () => cycle(Number(button.dataset.cycle)))
    );
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.matches("input, textarea, [contenteditable]") || target.isContentEditable)
      ) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    });
    selectView(new URL(window.location.href).searchParams.get("story"));
  </script>
</body>
</html>
`
}
