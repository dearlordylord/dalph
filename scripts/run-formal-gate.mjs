import { fileURLToPath } from "node:url"
import { inheritedCustody } from "./gate-custody-records.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { formalGatePolicy } from "./formal-gate-policy.mjs"
import { parseFormalArguments } from "./run-formal-workflow.mjs"

try {
  parseFormalArguments(process.argv.slice(2))
  if (inheritedCustody() === undefined) throw new Error("Use the admitted pnpm check:quint entry point")
  await runBoundedCommand({
    executable: process.execPath,
    args: [fileURLToPath(new URL("./run-formal-workflow.mjs", import.meta.url)), ...process.argv.slice(2)],
    name: "guarded formal workflow",
    relayParentSignals: true,
    captureOutput: false,
    timeoutMilliseconds: formalGatePolicy.outerMilliseconds,
    terminationGraceMilliseconds: 5_000,
    processGroupAbsenceTimeoutMilliseconds: 2_000
  })
} catch (error) {
  console.error(`Formal: failed — ${error.message}`)
  process.exitCode = 1
}
