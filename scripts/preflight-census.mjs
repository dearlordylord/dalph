import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"

/** Report independent structural failures together before qualification can start. */
export const runPreflightCensus = async ({ gates, maximumOutputLines = 550, report = console.error, runStage }) => {
  const outcomes = new Map()
  let successfulOutputLines = 0
  for (const gate of gates) {
    try {
      const result = await runStage(gate)
      successfulOutputLines = addSuccessfulOutputLines({
        currentOutputLines: successfulOutputLines,
        maximumOutputLines,
        stageName: gate.name,
        stageOutputLines: result.outputLineCount
      })
      outcomes.set(gate.name, { status: "passed" })
    } catch (error) {
      // Ordinary exits and proven termination leave independent checks actionable.
      // Cancellation, an unproven surviving process group, or a runner defect must stop launches.
      if (!/^(?:exit:\d+|launch-failed|timed-out)$/u.test(error.quintCommandResult ?? "")) throw error
      outcomes.set(gate.name, { status: "failed", detail: error.message })
      report(`Preflight failed: pnpm ${gate.args.join(" ")}: ${error.message}`)
    }
  }
  const succeeded = [...outcomes.values()].every((outcome) => outcome.status === "passed")
  report(
    `Preflight ${succeeded ? "passed" : "failed"}: ${[...outcomes.values()].filter((outcome) => outcome.status === "failed").length} failed stages.`
  )
  return { outcomes, succeeded, successfulOutputLines }
}
