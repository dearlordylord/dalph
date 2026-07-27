import { Runtime } from "foldkit"
import { Model, init, update, view } from "./main.ts"
import "./styles.css"

const application = Runtime.makeApplication({
  Model,
  container: document.getElementById("root"),
  init,
  update,
  view
})

Runtime.run(application)
