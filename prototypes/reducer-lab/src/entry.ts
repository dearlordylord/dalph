import {
  type CassetteLabResult,
  controlledBoundaryProvenance,
  maintainedCassetteKeys,
  maintainedCassetteRows,
  type MaintainedCassetteKey,
  runEveryMaintainedCassette,
  runMaintainedCassette
} from "./cassette-lab.ts"
import { resultEvidenceText, resultStatusText, runAllSummaryText } from "./cassette-lab-view.ts"
import "./cassette-lab.css"

export const singleCassetteSettledEvent = "dalph-cassette-lab:single-settled"
export const everyCassetteSettledEvent = "dalph-cassette-lab:every-settled"

const root = document.getElementById("root")
if (root === null) throw new Error("Reducer Lab root element is missing")

const heading = document.createElement("h1")
heading.textContent = "Dalph cassette lab"
const provenance = document.createElement("p")
provenance.className = "provenance"
provenance.textContent = controlledBoundaryProvenance
const controls = document.createElement("div")
controls.className = "controls"
const runAllButton = document.createElement("button")
runAllButton.textContent = "Run all cassettes"
const summary = document.createElement("output")
summary.textContent = `${maintainedCassetteKeys.length} maintained cassettes ready`
const resultsElement = document.createElement("div")
resultsElement.className = "results"
controls.append(runAllButton, summary)
root.append(heading, provenance, controls, resultsElement)

const rows = new Map<MaintainedCassetteKey, HTMLElement>()

const renderResult = (result: CassetteLabResult): void => {
  const row = rows.get(result.catalogKey)
  if (row === undefined) return
  const status = row.querySelector("output")
  const details = row.querySelector("details")
  const pre = row.querySelector("pre")
  if (status !== null) {
    status.dataset.status = result._tag
    status.textContent = resultStatusText(result)
  }
  if (details !== null) (details as HTMLDetailsElement).open = result._tag === "Failed"
  if (pre !== null) pre.textContent = resultEvidenceText(result)
}

const setBusy = (busy: boolean): void => {
  runAllButton.disabled = busy
  for (const row of rows.values()) {
    const button = row.querySelector("button")
    if (button !== null) (button as HTMLButtonElement).disabled = busy
  }
}

for (const { catalogKey, category, storyName, totalItemCount } of maintainedCassetteRows) {
  const row = document.createElement("article")
  const title = document.createElement("h2")
  title.textContent = `${category} · ${catalogKey} · ${storyName} · ${totalItemCount} items`
  const button = document.createElement("button")
  button.textContent = "Run cassette"
  const status = document.createElement("output")
  status.textContent = "not run"
  const details = document.createElement("details")
  const detailsTitle = document.createElement("summary")
  detailsTitle.textContent = "Production journal evidence"
  const pre = document.createElement("pre")
  details.append(detailsTitle, pre)
  button.addEventListener("click", () => {
    setBusy(true)
    status.textContent = "running through production…"
    void runMaintainedCassette(catalogKey).then((result) => {
      renderResult(result)
      setBusy(false)
      root.dispatchEvent(new Event(singleCassetteSettledEvent))
    })
  })
  row.append(title, button, status, details)
  rows.set(catalogKey, row)
  resultsElement.append(row)
}

runAllButton.addEventListener("click", () => {
  setBusy(true)
  summary.textContent = "running every maintained cassette through production…"
  void runEveryMaintainedCassette().then((results) => {
    for (const result of results) renderResult(result)
    summary.textContent = runAllSummaryText(results)
    setBusy(false)
    root.dispatchEvent(new Event(everyCassetteSettledEvent))
  })
})
