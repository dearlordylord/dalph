import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import {
  CodexOwnedActivityCensus,
  CodexThreadWorkingDirectory,
  type CodexThreadSnapshot
} from "../../src/application/codex-app-server.js"
import { CodexThreadId } from "../../src/application/codex-attempt-store.js"

interface CodexOwnedActivityCensusContractInput<E> {
  readonly layer: Layer.Layer<CodexOwnedActivityCensus, E, never>
  readonly name: string
}

const idleThread: CodexThreadSnapshot = {
  cwd: CodexThreadWorkingDirectory.make("/contract/worktree"),
  id: CodexThreadId.make("contract-thread"),
  status: "idle",
  turns: []
}

/** Shared owned-activity boundary contract used by controlled and Node process census implementations. */
export const codexOwnedActivityCensusContract = <E>({
  layer,
  name
}: CodexOwnedActivityCensusContractInput<E>): void => {
  it.effect(`${name} CodexOwnedActivityCensus proves an idle thread has no owned activity`, () =>
    Effect.gen(function* () {
      const census = yield* CodexOwnedActivityCensus
      expect(yield* census.observe(idleThread, [], "IntegratorSession")).toEqual({ _tag: "Absent" })
      yield* census.terminateDescendants([], "IntegratorSession")
    }).pipe(Effect.provide(layer))
  )
}
