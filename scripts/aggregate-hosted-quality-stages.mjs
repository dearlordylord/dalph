import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  aggregateHostedQualityStages,
  assertHostedQualityEnvironmentBinding,
  assertHostedQualityPlanEnvironment
} from "./hosted-quality-evidence.mjs"

const parse = (args) => {
  const separator = args.indexOf("--")
  if (separator === -1 || args.slice(0, separator).length !== 8)
    throw new Error(
      "Hosted quality aggregate requires --base SHA --candidate SHA --run-id ID --run-attempt N -- report..."
    )
  const values = new Map()
  for (let index = 0; index < separator; index += 2) values.set(args[index], args[index + 1])
  if (["--base", "--candidate", "--run-id", "--run-attempt"].some((name) => !values.has(name)))
    throw new Error("Hosted quality aggregate binding is incomplete")
  return { values, reports: args.slice(separator + 1).map(resolve) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { reports, values } = parse(process.argv.slice(2))
  const binding = assertHostedQualityEnvironmentBinding({
    baseSha: values.get("--base"),
    candidateSha: values.get("--candidate"),
    runId: values.get("--run-id"),
    runAttempt: values.get("--run-attempt")
  })
  assertHostedQualityPlanEnvironment({ binding })
  const result = aggregateHostedQualityStages({ binding, reports })
  for (const row of result.rows) {
    process.stdout.write(
      `Node ${row.nodeVersion} ${row.stageId}: ${row.outcome}; artifacts=${row.artifacts.join(",") || "none"}` +
        `${row.command === undefined ? "" : `; command=${row.command.executable} ${row.command.args.join(" ")}`}` +
        `${row.failures.length === 0 ? "" : `; failures=${row.failures.join(" | ")}`}\n`
    )
  }
  process.stdout.write(
    `Hosted quality timing: firstActionableFailureMs=${result.metrics.firstActionableFailureMilliseconds ?? "none"} ` +
      `makespanMs=${result.metrics.makespanMilliseconds ?? "unavailable"}\n`
  )
  for (const failure of result.failures) process.stderr.write(`Hosted quality aggregate: ${failure}\n`)
  process.exitCode = result.succeeded ? 0 : 1
}
