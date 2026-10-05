import { Effect, Schema } from "effect"
import type { CodexAppServerFailure, CodexThreadListSummary, CodexThreadWorkingDirectory } from "./codex-app-server.js"

/** Opaque native continuation identity, independent of workflow history. */
const CodexThreadListCursor = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadListCursor"))
type CodexThreadListCursor = typeof CodexThreadListCursor.Type
const maximumThreadListPages = 100

/** Native, independently persisted partition identity; never authored by a model. */
const CodexThreadSectionId = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadSectionId"))
type CodexThreadSectionId = typeof CodexThreadSectionId.Type

const CodexThreadSectionListEnvelope = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: CodexThreadSectionId })),
  nextCursor: Schema.NullOr(CodexThreadListCursor)
})

interface CodexThreadInventoryInput {
  readonly cwd?: CodexThreadWorkingDirectory
  readonly request: (
    operation: "thread/list" | "threadSection/list",
    params: unknown
  ) => Effect.Effect<unknown, CodexAppServerFailure>
  readonly parsePage: (
    response: unknown
  ) =>
    | { readonly threads: ReadonlyArray<CodexThreadListSummary>; readonly nextCursor: string | null | undefined }
    | CodexAppServerFailure
  readonly failure: (
    operation: "thread/list" | "threadSection/list",
    kind: "Malformed" | "Ownership",
    detail: string
  ) => CodexAppServerFailure
}

/** Completes all indexed native partitions before granting absence authority. */
export const readIndexedCodexThreads: (
  input: CodexThreadInventoryInput
) => Effect.Effect<ReadonlyArray<CodexThreadListSummary>, CodexAppServerFailure> = Effect.fn(
  "CodexAppServer.readIndexedThreads"
)(function* ({
  cwd,
  failure,
  parsePage,
  request
}: CodexThreadInventoryInput): Effect.fn.Return<ReadonlyArray<CodexThreadListSummary>, CodexAppServerFailure> {
  const listThreadSections = Effect.fn("CodexAppServer.listThreadSections")(function* () {
    let ids: ReadonlyArray<CodexThreadSectionId> = []
    let cursors: ReadonlySet<CodexThreadListCursor> = new Set()
    let cursor: CodexThreadListCursor | undefined
    for (let page = 0; page < maximumThreadListPages; page += 1) {
      const response = yield* request("threadSection/list", { limit: 100, ...(cursor === undefined ? {} : { cursor }) })
      const parsed = yield* Schema.decodeUnknownEffect(CodexThreadSectionListEnvelope)(response).pipe(
        Effect.mapError((error) => failure("threadSection/list", "Malformed", String(error)))
      )
      for (const section of parsed.data) {
        if (ids.includes(section.id)) {
          return yield* failure("threadSection/list", "Malformed", "thread section identity repeated")
        }
        ids = [...ids, section.id]
      }
      if (parsed.nextCursor === null) return ids
      if (cursors.has(CodexThreadListCursor.make(parsed.nextCursor))) {
        return yield* failure("threadSection/list", "Malformed", "thread section cursor repeated")
      }
      cursors = new Set([...cursors, CodexThreadListCursor.make(parsed.nextCursor)])
      cursor = CodexThreadListCursor.make(parsed.nextCursor)
    }
    return yield* failure("threadSection/list", "Malformed", "thread section list exceeded page bound")
  })

  const sections = yield* listThreadSections()
  let pages: ReadonlyArray<ReadonlyArray<CodexThreadListSummary>> = []
  let totalPages = 0
  for (const sectionId of [null, ...sections]) {
    let cursors: ReadonlySet<CodexThreadListCursor> = new Set()
    let cursor: CodexThreadListCursor | undefined
    for (;;) {
      if (totalPages >= maximumThreadListPages) {
        return yield* failure("thread/list", "Malformed", "thread list exceeded page bound")
      }
      totalPages += 1
      const response = yield* request("thread/list", {
        // An explicit section filter reports database failure instead of
        // the native unfiltered StateDbOnly path's silent empty fallback.
        sectionId,
        limit: 100,
        modelProviders: [],
        sourceKinds: [
          "cli",
          "vscode",
          "exec",
          "appServer",
          "subAgent",
          "subAgentReview",
          "subAgentCompact",
          "subAgentThreadSpawn",
          "subAgentOther",
          "unknown"
        ],
        ...(cwd === undefined ? {} : { cwd }),
        ...(cursor === undefined ? {} : { cursor })
      })
      const parsed = parsePage(response)
      if (!("threads" in parsed)) return yield* Effect.fail(parsed)
      if (cwd !== undefined && parsed.threads.some((thread) => thread.cwd !== cwd)) {
        return yield* Effect.fail(
          failure("thread/list", "Ownership", "scoped thread list returned a foreign working directory")
        )
      }
      pages = [...pages, parsed.threads]
      if (parsed.nextCursor === undefined || parsed.nextCursor === null) {
        break
      }
      if (cursors.has(CodexThreadListCursor.make(parsed.nextCursor))) {
        return yield* Effect.fail(failure("thread/list", "Malformed", "thread list cursor repeated"))
      }
      cursors = new Set([...cursors, CodexThreadListCursor.make(parsed.nextCursor)])
      cursor = CodexThreadListCursor.make(parsed.nextCursor)
    }
  }
  const observedSections = yield* listThreadSections()
  if (sections.length !== observedSections.length || sections.some((id) => !observedSections.includes(id))) {
    return yield* failure("threadSection/list", "Ownership", "thread section catalogue changed")
  }
  const threads = pages.flatMap((items) => items)
  if (new Set(threads.map((thread) => thread.id)).size !== threads.length) {
    return yield* failure("thread/list", "Ownership", "persistent thread identity repeated")
  }
  return threads
})
