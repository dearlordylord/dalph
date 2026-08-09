import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const cleanVerdict = /\[ok\]\s+No violation found/
const violatedVerdict = /^\s*\[violation\]\s+Found an issue/m

export const apalacheVersion = "0.56.1"

export const apalacheJarPath = (quintHome = process.env.QUINT_HOME ?? join(homedir(), ".quint")) =>
  join(quintHome, `apalache-dist-${apalacheVersion}`, "apalache", "lib", "apalache.jar")

export const assertTlcArtifactPrepared = async (quintHome) => {
  const path = apalacheJarPath(quintHome)
  try {
    await access(path)
  } catch {
    throw new Error(`TLC artifact preparation did not produce ${path}`)
  }
}

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
export const runPreparedTemporalCheck = async ({ assertArtifactPrepared, prepareArtifact, verifyTemporal }) => {
  await prepareArtifact()
  await assertArtifactPrepared()
  return verifyTemporal()
}
