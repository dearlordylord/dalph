import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { CodexAppServerFailure, CodexThreadListSummary, CodexThreadWorkingDirectory } from "./codex-app-server.js"
import { CodexThreadId } from "./codex-attempt-store.js"
import { readIndexedCodexThreads } from "./codex-thread-inventory.js"

const cwd = CodexThreadWorkingDirectory.make("/fixture/worktree")
const failure = (operation: "thread/list" | "threadSection/list", kind: "Malformed" | "Ownership", detail: string) =>
  new CodexAppServerFailure({ operation, kind, detail })
const pageSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: CodexThreadId, cwd: CodexThreadWorkingDirectory })),
  nextCursor: Schema.NullOr(Schema.NonEmptyString)
})
const parsePage = (value: unknown) => {
  const parsed = Schema.decodeUnknownOption(pageSchema)(value)
  return parsed._tag === "None"
    ? failure("thread/list", "Malformed", "invalid page")
    : {
        threads: parsed.value.data.map((thread) => CodexThreadListSummary.IdentityOnly(thread)),
        nextCursor: parsed.value.nextCursor
      }
}

// #457 S2: controlled native reads exercise refusal without starting processes.
it.effect.each([
  "unavailable",
  "malformed",
  "repeated-cursor",
  "duplicate-section",
  "changed-catalogue",
  "duplicate-thread",
  "thread-rpc-failure",
  "excessive-pages",
  "foreign-cwd"
])("refuses an incomplete indexed census: %s", (mode) =>
  Effect.gen(function* () {
    let sectionReads = 0
    let threadReads = 0
    const request = (operation: "thread/list" | "threadSection/list", params: unknown) =>
      Effect.gen(function* () {
        if (operation === "threadSection/list") {
          sectionReads += 1
          if (mode === "unavailable") return yield* failure(operation, "Malformed", "database unavailable")
          if (mode === "malformed") return { data: [], nextCursor: "" }
          if (mode === "repeated-cursor") return { data: [], nextCursor: "again" }
          if (mode === "duplicate-section") return { data: [{ id: "a" }, { id: "a" }], nextCursor: null }
          if (mode === "changed-catalogue" && sectionReads > 1) return { data: [{ id: "a" }], nextCursor: null }
          return { data: [], nextCursor: null }
        }
        threadReads += 1
        expect(params).toMatchObject({ sectionId: null, cwd, limit: 100, modelProviders: [] })
        if (mode === "thread-rpc-failure") return yield* failure(operation, "Malformed", "indexed query failed")
        if (mode === "duplicate-thread")
          return {
            data: [
              { id: "same", cwd },
              { id: "same", cwd }
            ],
            nextCursor: null
          }
        if (mode === "excessive-pages") return { data: [], nextCursor: `page-${threadReads}` }
        if (mode === "foreign-cwd") return { data: [{ id: "foreign", cwd: "/foreign" }], nextCursor: null }
        return { data: [], nextCursor: null }
      })
    const result = yield* readIndexedCodexThreads({ cwd, request, parsePage, failure }).pipe(Effect.result)
    expect(result._tag).toBe("Failure")
    expect(threadReads).toBeLessThanOrEqual(100)
    if (mode === "unavailable" || mode === "malformed" || mode === "repeated-cursor" || mode === "duplicate-section") {
      expect(threadReads).toBe(0)
    }
  })
)

it.effect("accepts the terminal page exactly at the indexed census bound", () =>
  Effect.gen(function* () {
    let pages = 0
    const request = (operation: "thread/list" | "threadSection/list") =>
      Effect.sync(() => {
        if (operation === "threadSection/list") return { data: [], nextCursor: null }
        pages += 1
        return { data: [], nextCursor: pages === 100 ? null : `page-${pages}` }
      })
    expect(yield* readIndexedCodexThreads({ cwd, request, parsePage, failure })).toEqual([])
    expect(pages).toBe(100)
  })
)
