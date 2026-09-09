import { spawnSync } from "node:child_process"
import { resolveCoverageBase } from "./verify-changed-coverage.mjs"

const defaultHead = () => {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8" })
  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || "Unable to resolve the full-gate candidate HEAD")
  }
  return result.stdout.trim()
}

const defaultCanonicalRevision = (revision) => {
  const result = spawnSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], { encoding: "utf8" })
  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `Unable to canonicalize full-gate revision '${revision}'`)
  }
  return result.stdout.trim()
}

const defaultIsAncestor = (base, head) => {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", base, head], { encoding: "utf8" })
  if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
    throw result.error ?? new Error(result.stderr || "Unable to compare the full-gate base with candidate HEAD")
  }
  return result.status === 0
}

const isRequestedRevision = (value) => {
  const revision = value?.trim()
  return revision !== undefined && revision.length > 0 && !/^0+$/u.test(revision)
}

/** Resolves a verified base that is strictly earlier than the candidate HEAD. */
export const resolveQualityGateBase = ({
  candidateBase,
  canonicalize = defaultCanonicalRevision,
  hostedBase,
  isAncestor = defaultIsAncestor,
  readHead = defaultHead,
  resolveBase = resolveCoverageBase
}) => {
  if (candidateBase !== undefined && !isRequestedRevision(candidateBase)) {
    throw new Error("The explicit frozen-candidate base must be a nonzero revision")
  }
  const requested = candidateBase ?? hostedBase
  const candidateHead = canonicalize(readHead())
  const resolved = canonicalize(resolveBase(requested))
  if (resolved !== candidateHead) {
    if (!isAncestor(resolved, candidateHead)) {
      throw new Error(`Full-gate base '${resolved}' is not an ancestor of candidate HEAD '${candidateHead}'`)
    }
    return resolved
  }
  if (isRequestedRevision(requested))
    throw new Error(`Full-gate base '${resolved}' equals candidate HEAD; an earlier commit is required`)
  const parent = canonicalize(resolveBase("HEAD^"))
  if (parent === candidateHead) {
    throw new Error("Unable to resolve a full-gate base strictly earlier than candidate HEAD")
  }
  if (!isAncestor(parent, candidateHead)) {
    throw new Error(`Fallback full-gate base '${parent}' is not an ancestor of candidate HEAD '${candidateHead}'`)
  }
  return parent
}
