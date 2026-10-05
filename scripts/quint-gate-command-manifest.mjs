const command = (kind, name) => Object.freeze({ kind, name })

const model = (prefix) => [
  command("typecheck", `${prefix} model typecheck`),
  command("test", `${prefix} deterministic tests`),
  command("test", `${prefix} negative mutation profile`),
  command("sampled-run", `${prefix} sampled model`)
]

const exhaustiveModel = (prefix) => [...model(prefix), command("verify", `${prefix} exhaustive model`)]

const proof = (prefix) => [
  command("test", `${prefix} deterministic tests`),
  command("test", `${prefix} negative mutation profile`),
  command("sampled-run", `${prefix} sampled model`),
  command("verify", `${prefix} exhaustive model`)
]

/**
 * The ordered command identity contract for check-quint-models.mjs. The gate
 * consumes this manifest while it runs, and profile evidence validates against
 * the same object so a timing log cannot silently omit or reorder work.
 */
export const quintGateCommandManifest = Object.freeze([
  ...model("planned-attempt executor"),
  command("verify", "planned-attempt executor TLC artifact preparation"),
  command("verify", "planned-attempt executor temporal releasableEvidenceEventuallyReleasesPosition (TLC)"),
  command("verify", "planned-attempt executor temporal mutant releasableEvidenceNeverReleasesPosition (TLC)"),
  command("typecheck", "planned-attempt executor proof projection typecheck"),
  ...proof("planned-attempt executor evidence proof"),
  ...proof("planned-attempt executor Suspend-bound proof"),
  ...model("application Exit"),
  command("typecheck", "application Exit proof projection typecheck"),
  ...proof("application Exit admission proof"),
  ...proof("application Exit owner proof"),
  ...proof("application Exit executor proof"),
  ...proof("application Exit result proof"),
  ...exhaustiveModel("control-direction application"),
  ...exhaustiveModel("Run activation"),
  ...model("fresh-task admission"),
  command("typecheck", "fresh-task admission proof projection typecheck"),
  ...proof("fresh-task admission capacity proof"),
  ...proof("fresh-task admission ambiguity proof"),
  ...exhaustiveModel("Run cancellation"),
  ...model("task-fact reconciliation"),
  command("typecheck", "task-fact proof projection typecheck"),
  ...proof("task-fact choice proof"),
  ...proof("historical task-fact Stop recovery proof"),
  ...proof("task-fact stopped-claim proof"),
  ...proof("task-fact active-work refresh proof"),
  ...exhaustiveModel("Git reconciliation"),
  ...model("accepted-result integration"),
  command("typecheck", "accepted-result integration quarantine proof typecheck"),
  ...proof("accepted-result integration quarantine proof"),
  command("typecheck", "accepted-result automatic successor proof typecheck"),
  ...proof("accepted-result automatic successor proof"),
  command("typecheck", "accepted-result automatic successor counter proof typecheck"),
  ...proof("accepted-result automatic successor counter proof"),
  ...exhaustiveModel("integration finality"),
  command("typecheck", "publication exhaustion batch grant model typecheck"),
  command("test", "publication exhaustion batch grant deterministic tests"),
  command("test", "publication exhaustion batch grant negative mutation profile"),
  command("sampled-run", "publication exhaustion batch grant sampled model"),
  command("typecheck", "publication exhaustion batch grant proof projection typecheck"),
  command("test", "publication exhaustion batch grant control projection deterministic tests"),
  command("test", "publication exhaustion batch grant control projection negative mutation profile"),
  command("sampled-run", "publication exhaustion batch grant control projection sampled model"),
  command("verify", "publication exhaustion batch grant control projection exhaustive model"),
  command("test", "publication exhaustion batch grant batch/finality projection deterministic tests"),
  command("test", "publication exhaustion batch grant batch/finality projection negative mutation profile"),
  command("sampled-run", "publication exhaustion batch grant batch/finality projection sampled model"),
  ...exhaustiveModel("provider result correction"),
  ...exhaustiveModel("result recovery direction"),
  command("typecheck", "executor guidance model typecheck"),
  command("test", "executor guidance deterministic tests"),
  command("test", "executor guidance negative mutation profile"),
  command("sampled-run", "executor guidance sampled model"),
  command("typecheck", "executor guidance proof projection typecheck"),
  ...proof("executor guidance proof projection")
])

const manifestKeys = quintGateCommandManifest.map(({ kind, name }) => `${kind}\u0000${name}`)
if (new Set(manifestKeys).size !== manifestKeys.length)
  throw new Error("Quint gate command manifest contains duplicates")
