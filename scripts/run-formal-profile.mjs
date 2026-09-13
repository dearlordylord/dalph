import { readRecord, atomicRecord, inheritedCustody } from "./gate-custody-records.mjs"
import { createQuintGateDeadline } from "./quint-gate-policy.mjs"
import { runQuintEffectiveProfile } from "./check-quint-models.mjs"
import { withOwnedQuintServer } from "./quint-owned-server.mjs"
import { performance } from "node:perf_hooks"
import { join } from "node:path"

const context = inheritedCustody()
if (context === undefined) throw new Error("Formal execution requires inherited admission")
if (process.argv.length !== 3) throw new Error("Formal execution requires one prepared request")
const request = readRecord(process.argv[2])
if (
  request.runId !== context.run.runId ||
  request.worktree !== context.run.worktree ||
  request.reportPath !== join(context.runDirectory, "formal-executions", `${request.attemptId}.json`)
) {
  throw new Error("Formal execution request belongs to another admitted attempt")
}
const remainingExecutionMilliseconds = createQuintGateDeadline({ startedAt: performance.now() })
const report = await withOwnedQuintServer({
  javaExecutable: request.toolchain.javaExecutable,
  javaUserHome: request.toolchain.javaUserHome,
  apalacheJar: request.toolchain.apalacheJar,
  javaArguments: request.toolchain.javaArguments,
  environment: process.env,
  remainingExecutionMilliseconds,
  runProfile: ({ environment, serverEndpoint, signal }) =>
    runQuintEffectiveProfile({
      profile: request.profile,
      environment,
      serverEndpoint,
      signal,
      evaluatorPath: request.toolchain.evaluatorPath,
      remainingExecutionMilliseconds,
      compact: true,
      write: (text) => process.stdout.write(text)
    })
})
atomicRecord(request.reportPath, { version: 1, ...report })
