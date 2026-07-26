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

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

const authoritativeModelState = (
  frame: NormalizedFrame
): unknown => {
  const entry = Object.entries(frame.rawItfState)
    .find(([key]) => key.endsWith("::state"))
  if (entry === undefined) {
    throw new Error(`${frame.position} has no authoritative Quint model state`)
  }
  return entry[1]
}

export interface ObservedStateOccurrence {
  readonly frame: NormalizedFrame
  readonly traceKind: TraceKind
}

export interface ObservedStateNode {
  readonly depth: number
  readonly id: string
  readonly occurrences: ReadonlyArray<ObservedStateOccurrence>
  readonly representative: NormalizedFrame
  readonly terminalTraceKinds: ReadonlyArray<TraceKind>
}

export interface ObservedTransitionEdge {
  readonly action: string
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
 * Builds the bounded unfolding observed in retained traces. State equality is
 * exact Quint model-state equality at the same exploration depth. Depth keeps
 * the artifact acyclic; this does not compute enabled or legal transitions.
 */
export const buildObservedStateDag = (
  traces: ReadonlyArray<NormalizedTrace>
): ObservedStateDag => {
  const mutableNodes: Array<{
    depth: number
    id: string
    occurrences: Array<ObservedStateOccurrence>
    representative: NormalizedFrame
    terminalTraceKinds: Set<TraceKind>
  }> = []
  const nodeByIdentity = new Map<string, typeof mutableNodes[number]>()
  const mutableEdges = new Map<string, {
    action: string
    id: string
    source: string
    target: string
    traceKinds: Set<TraceKind>
  }>()

  for (const trace of traces) {
    const traceNodes = trace.frames.map((frame, index) => {
      const identity = `${frame.step}:${canonicalJson(authoritativeModelState(frame))}`
      let node = nodeByIdentity.get(identity)
      if (node === undefined) {
        node = {
          depth: frame.step,
          id: `N${mutableNodes.length}`,
          occurrences: [],
          representative: frame,
          terminalTraceKinds: new Set()
        }
        mutableNodes.push(node)
        nodeByIdentity.set(identity, node)
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
    "Position",
    "Action / picked task",
    "Coordinator",
    "Capacity",
    "Frontier",
    "Admission",
    "Occupied",
    "Reserved",
    "Explanations",
    "Comparison"
  ]
  const rows = trace.frames.map((frame) => {
    const comparison = frame.comparison.status === "Mismatch"
      ? `Mismatch: ${frame.comparison.firstDivergentField}`
      : frame.comparison.status
    const values = [
      frame.position,
      `${frame.action}${frame.pickedModelTaskId === undefined ? "" : ` / ${frame.pickedModelTaskId}`}`,
      frame.coordinatorStatus,
      frame.capacity,
      frame.frontier,
      frame.admission,
      frame.occupiedModelTaskIds,
      frame.reservedModelTaskIds,
      frame.explanations,
      comparison
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

const renderDagSvg = (dag: ObservedStateDag): string => {
  const nodeWidth = 196
  const nodeHeight = 92
  const xGap = 96
  const yGap = 64
  const padding = 48
  const levels = new Map<number, ReadonlyArray<ObservedStateNode>>()
  for (const node of dag.nodes) {
    levels.set(node.depth, [...(levels.get(node.depth) ?? []), node])
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
  const maxDepth = Math.max(0, ...dag.nodes.map((node) => node.depth))
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
    const label = `${edge.action} · ${edge.traceKinds.join(", ")}`
    return `<g class="edge">
      <path d="M ${x1} ${y1} C ${middle} ${y1 + offset}, ${middle} ${y2 + offset}, ${x2} ${y2}" marker-end="url(#arrow)" />
      <text x="${middle}" y="${(y1 + y2) / 2 + offset - 7}" text-anchor="middle">${escapeHtml(label)}</text>
    </g>`
  }).join("\n")

  const nodes = positioned.map(({ node, x, y }) => {
    const frame = node.representative
    const terminal = node.terminalTraceKinds.length === 0
      ? ""
      : `terminal: ${node.terminalTraceKinds.join(", ")}`
    return `<g class="node${node.terminalTraceKinds.includes("counterexample") ? " violation" : ""}" data-node-id="${node.id}" role="button" tabindex="0" transform="translate(${x} ${y})">
      <rect width="${nodeWidth}" height="${nodeHeight}" rx="10" />
      <text x="14" y="24" class="node-title">${node.id} · depth ${node.depth}</text>
      <text x="14" y="47">${frame.coordinatorStatus} · capacity ${frame.capacity}</text>
      <text x="14" y="67">frontier ${frame.frontier.map((entry) => entry.modelTaskId).join(",") || "∅"} · admitted ${frame.admission.map((entry) => entry.modelTaskId).join(",") || "∅"}</text>
      <text x="14" y="84" class="terminal">${escapeHtml(terminal)}</text>
    </g>`
  }).join("\n")

  return `<div class="dag-scroll"><svg class="dag" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="Observed Quint state DAG">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
    ${edges}
    ${nodes}
  </svg></div>`
}

const browserDagData = (dag: ObservedStateDag): string =>
  JSON.stringify(Object.fromEntries(dag.nodes.map((node) => [
    node.id,
    {
      depth: node.depth,
      occurrences: node.occurrences.map(({ frame, traceKind }) => ({
        action: eventLabel(frame),
        admission: frame.admission,
        comparison: frame.comparison,
        coordinator: frame.coordinatorStatus,
        explanations: frame.explanations,
        frontier: frame.frontier,
        occupied: frame.occupiedModelTaskIds,
        position: frame.position,
        rawItfState: frame.rawItfState,
        reserved: frame.reservedModelTaskIds,
        traceKind
      })),
      terminalTraceKinds: node.terminalTraceKinds
    }
  ]))).replaceAll("<", "\\u003c")

export const renderObservedDagHtml = (
  traces: ReadonlyArray<NormalizedTrace>
): string => {
  const dag = buildObservedStateDag(traces)
  const provenance = traces.map(({ provenance: item }) => item)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Observed Quint state DAG</title>
  <style>
    :root { color-scheme: dark; }
    body { background: #0d1217; color: #e7edf3; font: 15px/1.45 system-ui, sans-serif; margin: 0; padding: 24px; }
    h1, h2 { margin-top: 0; }
    .status { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; }
    .badge { background: #623c12; border: 1px solid #c8852f; border-radius: 999px; color: #ffd899; font-weight: 700; padding: 4px 10px; }
    .provenance { color: #91a2b3; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .workspace { display: grid; gap: 18px; grid-template-columns: minmax(0, 3fr) minmax(320px, 1fr); margin: 20px 0; }
    section { background: #171f27; border: 1px solid #34414d; border-radius: 10px; padding: 16px; overflow: auto; }
    .dag-scroll { min-height: 430px; overflow: auto; }
    .dag .edge path { fill: none; stroke: #77899a; stroke-width: 2; }
    .dag .edge text { fill: #b8c4cf; font-size: 11px; paint-order: stroke; stroke: #0d1217; stroke-width: 4px; }
    .dag marker path { fill: #77899a; }
    .dag .node { cursor: pointer; outline: none; }
    .dag .node rect { fill: #23303b; stroke: #6b8194; stroke-width: 2; }
    .dag .node:hover rect, .dag .node:focus rect, .dag .node.selected rect { fill: #29445a; stroke: #66c2ff; stroke-width: 3; }
    .dag .node.violation rect { fill: #4a2528; stroke: #ef6b73; }
    .dag .node text { fill: #dfe8ef; font-size: 12px; pointer-events: none; }
    .dag .node .node-title { fill: #fff; font-size: 14px; font-weight: 700; }
    .dag .node .terminal { fill: #ef9ca2; font-size: 10px; }
    #inspector pre { background: #0d1217; border-radius: 6px; max-height: 440px; overflow: auto; padding: 10px; white-space: pre-wrap; word-break: break-word; }
    #inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px 10px; }
    #inspector dt { color: #91a2b3; }
    #inspector dd { margin: 0; overflow-wrap: anywhere; }
    .table-wrap { max-height: 68vh; overflow: auto; }
    table { border-collapse: collapse; min-width: 1500px; width: 100%; }
    th, td { border: 1px solid #465564; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #25313c; position: sticky; top: 0; z-index: 1; }
    td code { white-space: pre-wrap; word-break: break-word; }
    details.trace { border-top: 1px solid #34414d; margin-top: 12px; padding-top: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    @media (max-width: 1000px) { .workspace { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Observed Quint state DAG</h1>
  <div class="status">
    <span class="badge">Sampled and incomplete</span>
    <span>${dag.nodes.length} exact states · ${dag.edges.length} observed transitions · ${traces.length} retained traces</span>
  </div>
  <p>This bounded unfolding merges equal Quint model states at the same depth. Edges are actions observed in retained traces; absent edges are unknown, not disabled.</p>
  <p class="provenance">${escapeHtml(JSON.stringify(provenance))}</p>
  <div class="workspace">
    <section>
      <h2>Branching and reconvergence</h2>
      ${renderDagSvg(dag)}
    </section>
    <section id="inspector">
      <h2>Selected state</h2>
      <p>Click a node to inspect its normalized values and raw ITF state.</p>
    </section>
  </div>
  <section>
    <h2>Frame tables</h2>
    ${traces.map((trace, index) => `<details class="trace"${index === 0 ? " open" : ""}><summary>${trace.provenance.traceKind} · ${trace.frames.length} frames</summary>${renderHtmlTable(trace)}</details>`).join("\n")}
  </section>
  <script>
    const nodes = ${browserDagData(dag)};
    const inspector = document.querySelector("#inspector");
    const nodeElements = [...document.querySelectorAll("[data-node-id]")];
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
        .map((item) => item.traceKind + ":" + item.position)
        .join(", ");
      inspector.innerHTML = \`
        <h2>\${escapeText(id)} · depth \${node.depth}</h2>
        <dl>
          <dt>seen in</dt><dd>\${escapeText(seenIn)}</dd>
          <dt>coordinator</dt><dd>\${escapeText(occurrence.coordinator)}</dd>
          <dt>frontier</dt><dd><code>\${escapeText(JSON.stringify(occurrence.frontier))}</code></dd>
          <dt>admission</dt><dd><code>\${escapeText(JSON.stringify(occurrence.admission))}</code></dd>
          <dt>occupied</dt><dd><code>\${escapeText(JSON.stringify(occurrence.occupied))}</code></dd>
          <dt>reserved</dt><dd><code>\${escapeText(JSON.stringify(occurrence.reserved))}</code></dd>
          <dt>explanations</dt><dd><code>\${escapeText(JSON.stringify(occurrence.explanations))}</code></dd>
        </dl>
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
    selectNode(nodeElements[0]?.dataset.nodeId);
  </script>
</body>
</html>
`
}
