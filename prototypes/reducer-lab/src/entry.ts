import { Runtime } from "foldkit"
import { registerReducerLabGraph } from "./graph-renderer.ts"
import { Model, init, update, view } from "./main.ts"
import "./styles.css"

registerReducerLabGraph()

const application = Runtime.makeApplication({
  Model,
  container: document.getElementById("root"),
  init,
  update,
  view
})

Runtime.run(application)
