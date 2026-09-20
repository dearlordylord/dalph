/* eslint-disable import/no-nodejs-modules -- The adapter is the typed boundary to gate-run-identity. */
import { execFileSync } from "node:child_process"

// The gate identity implementation is repository-owned JavaScript.  Keep its
// byte/membership algorithm in one authority and expose only the typed seam
// needed by the conformance trace.
// @ts-expect-error gate-run-identity.mjs intentionally has no declaration file.
import { currentSourceInputDigest as untypedCurrentSourceInputDigest } from "../../../../scripts/gate-run-identity.mjs"

export const currentSourceInputDigest = (worktree: string): string => {
  const digest = untypedCurrentSourceInputDigest(worktree)
  if (typeof digest !== "string" || digest.length === 0) throw new Error("gate source digest is not a string")
  return digest
}

export const repositoryHead = (worktree: string): string => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim()
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("repository HEAD is not an exact Git SHA")
  return head
}
