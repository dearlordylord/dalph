import {
  computeStateMachineCoverage,
  fromMachineJSON,
  type MachineJSON,
  renderStatechartMermaid,
  renderStatechartSVG
} from "effect-analyzer/analysis"
import type {
  ArtifactProvenance,
  NormalizedFrame,
  NormalizedTrace
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

export const toMachineJson = (trace: NormalizedTrace): MachineJSON => {
  const states: Record<string, { readonly on?: Record<string, string> }> = {}
  trace.frames.forEach((frame, index) => {
    const following = trace.frames[index + 1]
    states[frame.position] = following === undefined
      ? {}
      : { on: { [eventLabel(following)]: following.position } }
  })
  return {
    id: `${trace.provenance.traceKind}-trace-path`,
    initial: "S0",
    schemas: {
      events: Object.fromEntries(
        trace.frames.slice(1).map((frame) => [eventLabel(frame), {}])
      )
    },
    states
  }
}

export const renderVisuals = (
  trace: NormalizedTrace
): { readonly mermaid: string; readonly svg: string } => {
  const machine = fromMachineJSON(toMachineJson(trace), {
    name: `${trace.provenance.traceKind} trace path`
  })
  const coverage = computeStateMachineCoverage(machine)
  const provenance = provenanceText(trace.provenance)
  return {
    mermaid:
      `%% provenance: ${provenance}\n${renderStatechartMermaid(machine, coverage)}\n`,
    svg:
      `<!-- provenance: ${provenance} -->\n${renderStatechartSVG(machine, coverage)}\n`
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")

export const renderSideBySideHtml = (
  trace: NormalizedTrace,
  table: string,
  svg: string
): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${trace.provenance.traceKind} Quint trace explanation</title>
  <style>
    body { background: #101418; color: #e7edf3; font: 15px/1.45 system-ui, sans-serif; margin: 0; padding: 24px; }
    .provenance { color: #a9b7c5; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .views { display: grid; gap: 20px; grid-template-columns: minmax(0, 3fr) minmax(360px, 2fr); }
    section { background: #182028; border: 1px solid #34414d; border-radius: 10px; padding: 16px; overflow: auto; }
    pre { white-space: pre-wrap; }
    details { border-top: 1px solid #34414d; margin-top: 12px; padding-top: 12px; }
    @media (max-width: 1000px) { .views { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>${trace.provenance.traceKind} trace explanation</h1>
  <p>This is one ${trace.provenance.traceKind} path, not the state machine and not proof of correctness.</p>
  <p class="provenance">${escapeHtml(provenanceText(trace.provenance))}</p>
  <div class="views">
    <section><h2>Frame table</h2><pre>${escapeHtml(table)}</pre></section>
    <section><h2>Generated path visual</h2>${svg}</section>
  </div>
  <section>
    <h2>Raw ITF states</h2>
    ${trace.frames.map((frame) => `<details><summary>${frame.position}: ${escapeHtml(eventLabel(frame))}</summary><pre>${escapeHtml(JSON.stringify(frame.rawItfState))}</pre></details>`).join("\n")}
  </section>
</body>
</html>
`
