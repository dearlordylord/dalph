import { GitRepositoryLocator } from "@dalph/contracts"
import { GitCommonDirectoryLocator, type GitCommandService as GitCommandServiceShape } from "@dalph/orchestrator"
import { Effect, Exit } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  CodexIntegratorConfiguration,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator
} from "./codex-integrator-private-store.js"
import { readWorktrees } from "./codex-integrator-worktree.js"

const config = CodexIntegratorConfiguration.make({
  candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-worktree-parser-properties"),
  commonDirectory: GitCommonDirectoryLocator.make("/tmp/dalph-worktree-parser-properties.git"),
  privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-worktree-parser-properties/store.json"),
  repository: GitRepositoryLocator.make("/tmp/dalph-worktree-parser-properties.git")
})

const commandsFor = (stdout: string): GitCommandServiceShape => ({
  run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout }),
  runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() }),
  runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
})

const safeSuffix = fc.stringMatching(/^[a-z0-9]{1,20}$/)
const commitSha = fc
  .array(fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"), {
    minLength: 40,
    maxLength: 40
  })
  .map((digits) => digits.join(""))
const registration = fc.record({
  detached: fc.boolean(),
  head: commitSha,
  locked: fc.boolean(),
  prunable: fc.boolean(),
  suffix: safeSuffix
})
const registrations = fc.uniqueArray(registration, { maxLength: 20, minLength: 1, selector: (record) => record.suffix })

type Registration = {
  readonly detached: boolean
  readonly head: string
  readonly locked: boolean
  readonly prunable: boolean
  readonly suffix: string
}

const porcelainFor = (records: ReadonlyArray<Registration>): string =>
  records
    .map((record) =>
      [
        `worktree /tmp/${record.suffix}`,
        `HEAD ${record.head}`,
        record.detached ? "detached" : `branch refs/heads/${record.suffix}`,
        ...(record.locked ? ["locked"] : []),
        ...(record.prunable ? ["prunable stale metadata"] : [])
      ].join("\n")
    )
    .join("\n\n")

it("preserves every generated valid Git worktree registration through the porcelain boundary", async () => {
  await fc.assert(
    fc.asyncProperty(registrations, async (records) => {
      const exit = await Effect.runPromise(Effect.exit(readWorktrees(commandsFor(porcelainFor(records)), config)))
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toEqual(
          records.map((record) => ({
            worktree: `/tmp/${record.suffix}`,
            head: record.head,
            ...(record.detached ? {} : { branch: `refs/heads/${record.suffix}` }),
            detached: record.detached,
            prunable: record.prunable
          }))
        )
      }
    }),
    { numRuns: 200, seed: 0x264270 }
  )
})
