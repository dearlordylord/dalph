import { maintainedCassetteRows, runMaintainedCassette } from "./cassette-lab.ts"
import { mountCassetteLab } from "./cassette-lab-browser.ts"
import { registerDeliveryGraph } from "./delivery-graph-renderer.ts"
import "./cassette-lab.css"

declare const __DALPH_SOURCE_REVISION__: string

const root = document.getElementById("root")
if (root === null) throw new Error("Cassette Lab root element is missing")

registerDeliveryGraph()
mountCassetteLab({
  revision: __DALPH_SOURCE_REVISION__,
  root,
  rows: maintainedCassetteRows,
  runCassette: runMaintainedCassette
})
