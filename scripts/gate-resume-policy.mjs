import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const refusal = (cause) => ({ status: "refused", cause })
export const inputGuardProven = (identity, guard) =>
  identity?.version === 2 &&
  identity.observerVersion === 1 &&
  guard?.version === 1 &&
  guard.observerVersion === 1 &&
  guard.unchanged === true &&
  guard.ready === true &&
  guard.drained === true &&
  guard.inputDigest === identity.inputDigest &&
  guard.sourceInputDigest === identity.sourceInputDigest

/** Reuse only the earliest complete, proven quality-stage results of this exact attempt. */
export const selectResumePrefix = ({ currentArtifacts, currentIdentity, priorEvidence, stageManifest }) => {
  const resume = priorEvidence.resume
  if (resume?.version !== 1 || resume.identity?.version !== 2 || resume.identity.observerVersion !== 1)
    return refusal("Prior run lacks the stronger resumable input schema")
  if (priorEvidence.custody !== "stopped" || priorEvidence.registration !== "closed")
    return refusal("Prior writer custody is not stopped and closed")
  if (!inputGuardProven(resume.identity, resume.guard))
    return refusal("Prior input observation is incomplete or changed")
  if (priorEvidence.worktree !== currentIdentity.worktree) return refusal("Resume belongs to another worktree")
  if (
    currentIdentity.version !== 2 ||
    currentIdentity.observerVersion !== 1 ||
    resume.identity.inputDigest !== currentIdentity.inputDigest
  )
    return refusal("Complete candidate, dependency, tool or environment inputs changed")
  if (!same(resume.manifest, stageManifest)) return refusal("Quality stage inventory or limits changed")
  if (!Array.isArray(resume.stages)) return refusal("Prior designated stage evidence is missing")
  const prefix = []
  let successfulOutputLines = 0
  for (const [ordinal, stage] of stageManifest.entries()) {
    const result = resume.stages[ordinal]
    if (result === undefined || result.outcome !== "passed") break
    if (
      result.stageId !== stage.id ||
      result.ordinal !== ordinal ||
      !same(result.contract, stage) ||
      !Number.isSafeInteger(result.outputLineCount) ||
      result.outputLineCount < 0 ||
      result.subtreeProven !== true ||
      typeof result.runId !== "string" ||
      typeof result.obligationId !== "string"
    )
      return refusal(`Incomplete passed stage evidence: ${stage.id}`)
    if (
      !same(
        Object.keys(result.artifacts ?? {}).sort((left, right) => left.localeCompare(right)),
        [...stage.artifactRoots].sort((left, right) => left.localeCompare(right))
      )
    )
      return refusal(`Incomplete artifact root inventory: ${stage.id}`)
    for (const root of stage.artifactRoots) {
      if (result.artifacts[root]?.exists !== true || !same(result.artifacts[root], currentArtifacts[root]))
        return refusal(`Required generated artifact changed or missing: ${root}`)
    }
    try {
      successfulOutputLines = addSuccessfulOutputLines({
        currentOutputLines: successfulOutputLines,
        maximumOutputLines: resume.maximumSuccessfulOutputLines,
        stageName: stage.id,
        stageOutputLines: result.outputLineCount
      })
    } catch (error) {
      return refusal(error.message)
    }
    prefix.push({
      stageId: stage.id,
      ordinal,
      runId: result.runId,
      obligationId: result.obligationId,
      outputLineCount: result.outputLineCount,
      artifacts: result.artifacts
    })
  }
  return { status: "selected", prefix, successfulOutputLines }
}
