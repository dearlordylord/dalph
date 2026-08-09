const cleanVerdict = /\[ok\]\s+No violation found/
const violatedVerdict = /\[violation\]|violation found/i

export const assertCleanTemporalVerdict = ({ exitCode, output }, property) => {
  if (exitCode !== 0 || !cleanVerdict.test(output)) {
    throw new Error(
      `${property} produced no supported TLC success verdict (exit ${exitCode}, ${output.trim() || "no output"})`
    )
  }
}

export const assertViolatedTemporalVerdict = ({ exitCode, output }, property) => {
  if (exitCode === 0 || !violatedVerdict.test(output)) {
    throw new Error(
      `${property} mutant was not rejected by a real TLC violation (exit ${exitCode}, ${output.trim() || "no output"})`
    )
  }
}

/**
 * TLC is embedded in the Apalache distribution. The default-backend check is
 * the deterministic artifact preparation step on a cold runner; temporal TLC
 * is never attempted if preparation fails.
 */
export const runPreparedTemporalCheck = async ({ prepareArtifact, verifyTemporal }) => {
  await prepareArtifact()
  return verifyTemporal()
}
