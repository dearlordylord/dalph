import { Effect } from "effect"
import { CodexThreadWorkingDirectory, type CodexAppServer, type CodexThreadSnapshot } from "./codex-app-server.js"
import {
  bump,
  CodexIntegratorPrivateLifecycle,
  type CodexIntegratorPrivateRecord,
  type CodexIntegratorPrivateStoreService
} from "./codex-integrator-private-store.js"
import { boundary, observedThread, providerFailure } from "./codex-integrator-runtime.js"

const adoptListedThread = Effect.fn("CodexIntegrator.adoptListedThread")(function* (
  app: CodexAppServer["Service"],
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService,
  matching: CodexThreadSnapshot
) {
  if (record.lifecycle._tag !== "ThreadStartIntentRecorded") {
    return yield* Effect.fail(providerFailure("persistent candidate thread is unowned"))
  }
  const thread = yield* observedThread(app, matching.id, record.candidatePath)
  if (thread.ownedThreadToken !== record.threadToken) {
    return yield* Effect.fail(providerFailure("listed thread does not carry the exact recorded ownership token"))
  }
  const attached = bump(record, {
    appServerIncarnation: app.incarnation,
    lifecycle: CodexIntegratorPrivateLifecycle.cases.ThreadStarted.make({ threadId: thread.id })
  })
  yield* boundary(store.write(attached))
  return { record: attached, thread }
})

const startOwnedThread = Effect.fn("CodexIntegrator.startOwnedThread")(function* (
  app: CodexAppServer["Service"],
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService
) {
  const intent =
    record.lifecycle._tag === "ThreadStartIntentRecorded" && record.appServerIncarnation === app.incarnation
      ? record
      : bump(record, {
          lifecycle: CodexIntegratorPrivateLifecycle.cases.ThreadStartIntentRecorded.make({}),
          appServerIncarnation: app.incarnation
        })
  if (intent !== record) yield* boundary(store.write(intent))
  const started = yield* boundary(app.startThread(record.candidatePath, record.threadToken))
  if (
    started.cwd !== CodexThreadWorkingDirectory.make(record.candidatePath) ||
    started.correlation !== undefined ||
    started.ownedThreadToken !== record.threadToken
  ) {
    return yield* Effect.fail(providerFailure("thread/start returned a foreign candidate cwd"))
  }
  const next = bump(intent, {
    lifecycle: CodexIntegratorPrivateLifecycle.cases.ThreadStarted.make({ threadId: started.id })
  })
  yield* boundary(store.write(next))
  return { record: next, thread: started }
})

const ensureExistingThread = Effect.fn("CodexIntegrator.ensureExistingThread")(function* (
  app: CodexAppServer["Service"],
  record: CodexIntegratorPrivateRecord,
  threadId: CodexThreadSnapshot["id"]
) {
  const thread = yield* observedThread(app, threadId, record.candidatePath)
  if (thread.ownedThreadToken !== record.threadToken) {
    return yield* Effect.fail(providerFailure("Codex thread ownership token is foreign"))
  }
  return { record, thread }
})

const adoptOrStartListedThread = Effect.fn("CodexIntegrator.adoptOrStartListedThread")(function* (
  app: CodexAppServer["Service"],
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService,
  listed: ReadonlyArray<CodexThreadSnapshot>
) {
  const candidateDirectory = CodexThreadWorkingDirectory.make(record.candidatePath)
  const matches = listed.filter((thread) => thread.cwd === candidateDirectory)
  if (matches.length > 1) {
    return yield* Effect.fail(providerFailure("persistent thread list has duplicate candidate cwd"))
  }
  const matching = matches[0]
  return matching === undefined
    ? yield* startOwnedThread(app, record, store)
    : yield* adoptListedThread(app, record, store, matching)
})

export const ensureThread = Effect.fn("CodexIntegrator.ensureThread")(function* (
  app: CodexAppServer["Service"],
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService
) {
  if (record.lifecycle._tag === "ThreadStarted" || record.lifecycle._tag === "RemovalIntentRecorded") {
    return yield* ensureExistingThread(app, record, record.lifecycle.threadId)
  }
  if (app.listThreads === undefined || app.listThreadsComplete !== true) {
    return yield* Effect.fail(providerFailure("persistent thread list is unavailable or incomplete"))
  }
  const listed = yield* boundary(app.listThreads())
  return yield* adoptOrStartListedThread(app, record, store, listed)
})
