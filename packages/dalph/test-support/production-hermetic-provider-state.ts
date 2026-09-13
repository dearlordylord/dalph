import { GitCommitSha, PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  GitCommand,
  GithubGraphqlRequest,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "@dalph/orchestrator"
import { Effect, FileSystem, Match, Ref, Schema, Stream } from "effect"
import {
  CodexAppServerFailure,
  CodexThreadListSummary,
  CodexThreadWorkingDirectory,
  type CodexAppServerService,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "../src/application/codex-app-server.js"
import { CodexServerIncarnation, CodexThreadId, CodexTurnId } from "../src/application/codex-attempt-store.js"
import type { BoundaryReached } from "../src/application/production-hermetic-contract.js"
import type { ProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"

/** Calls observed at this controlled provider, not workflow retry ordinals. */
const ProviderCallCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("HermeticProviderCallCount")
)
type ProviderCallCount = typeof ProviderCallCount.Type
type ProviderCallTag =
  | GithubGraphqlRequest["_tag"]
  | "CodexStartThread"
  | "CodexListThreads"
  | "CodexReadThread"
  | "CodexResumeThread"
  | "CodexStartTurn"
  | "CodexInterruptTurn"
  | "CodexListBackgroundTerminals"
  | "CodexTerminateBackgroundTerminal"
  | "CodexClose"
type ProviderCounts = ReadonlyArray<{ readonly tag: ProviderCallTag; readonly count: ProviderCallCount }>

const GraphqlBody = Schema.Struct({
  query: Schema.NonEmptyString,
  variables: Schema.Record(Schema.String, Schema.Unknown)
})
const FixtureLabel = Schema.Struct({ id: GithubLabelNodeId, name: GithubLabelName, description: Schema.NonEmptyString })
type FixtureLabel = typeof FixtureLabel.Type

/** A malformed or out-of-fixture request never changes controlled provider state. */
export class HermeticProviderRequestFailure extends Schema.TaggedError<HermeticProviderRequestFailure>()(
  "HermeticProviderRequestFailure",
  { detail: Schema.NonEmptyString }
) {}

const repositoryId = GithubRepositoryNodeId.make("hermetic-repository")
const issueId = GithubIssueNodeId.make("hermetic-issue")
const badRequest = (detail: string) => new HermeticProviderRequestFailure({ detail })
const providerFailure = (operation: "thread/start" | "thread/read" | "thread/resume" | "turn/start", detail: string) =>
  new CodexAppServerFailure({ operation, kind: "Protocol", detail })

const promptFact = (text: string, name: string) => {
  const prefix = `${name}: `
  const entries = text.split("\n").filter((line) => line.startsWith(prefix))
  return entries.length === 1 ? entries[0]?.slice(prefix.length) : undefined
}

/** Parent-resident outer provider state survives child death; Git, evidence and workflow interpretation remain real. */
export const makeHermeticProviderState = Effect.fn("HermeticProvider.makeState")(function* (
  configuration: ProductionRepositoryHostConfiguration,
  observeBoundary: (boundary: BoundaryReached) => Effect.Effect<void>
) {
  const fileSystem = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const lifecycle = yield* Ref.make<"Open" | "Completed">("Open")
  const completionResponse = yield* Ref.make<"Applied" | "Throttled">("Applied")
  const labels = yield* Ref.make<ReadonlyMap<GithubLabelName, FixtureLabel>>(new Map())
  const threads = yield* Ref.make<ReadonlyMap<CodexThreadId, CodexThreadSnapshot>>(new Map())
  const counts = yield* Ref.make<ProviderCounts>([])
  const count = (tag: ProviderCallTag) =>
    Ref.update(counts, (values) => {
      const current = values.find((value) => value.tag === tag)
      return current === undefined
        ? [...values, { tag, count: ProviderCallCount.make(1) }]
        : values.map((value) => (value.tag === tag ? { tag, count: ProviderCallCount.make(value.count + 1) } : value))
    })
  const requireRequestIdentity = Effect.fn("HermeticProvider.requireIdentity")(function* (
    request: GithubGraphqlRequest
  ) {
    if ("issueNodeId" in request && request.issueNodeId !== issueId) return yield* badRequest("foreign issue node")
    if ("repositoryNodeId" in request && request.repositoryNodeId !== repositoryId)
      return yield* badRequest("foreign repository node")
    if (
      request._tag === "ResolveRepository" &&
      (request.owner !== configuration.target.owner || request.repository !== configuration.target.repository)
    )
      return yield* badRequest("foreign repository locator")
    if (
      request._tag === "ResolveIssue" &&
      (request.target.owner !== configuration.target.owner ||
        request.target.repository !== configuration.target.repository ||
        request.target.issueNumber !== configuration.target.issueNumber)
    )
      return yield* badRequest("foreign issue locator")
  })
  const github = Effect.fn("HermeticProvider.github")(function* (input: unknown) {
    const body = yield* Schema.decodeUnknownEffect(GraphqlBody)(input).pipe(
      Effect.mapError(() => badRequest("malformed GraphQL request body"))
    )
    const operation = /^(?:query|mutation) ([A-Za-z]+)\(/u.exec(body.query)?.[1]
    const request = yield* Schema.decodeUnknownEffect(GithubGraphqlRequest)(
      operation === "ResolveIssue"
        ? { _tag: operation, target: { ...body.variables, _tag: "GithubIssue" } }
        : { ...body.variables, _tag: operation }
    ).pipe(Effect.mapError(() => badRequest("unsupported or malformed named GraphQL request")))
    yield* requireRequestIdentity(request)
    yield* count(request._tag)
    const data = yield* Match.valueTags(request, {
      ResolveIssue: () => Effect.succeed({ repository: { id: repositoryId, issue: { id: issueId } } }),
      ResolveRepository: () => Effect.succeed({ repository: { id: repositoryId } }),
      ReadIssue: () =>
        Ref.get(lifecycle).pipe(
          Effect.map((state) => ({
            node: {
              __typename: "Issue",
              id: issueId,
              repository: { id: repositoryId },
              parent: null,
              state: state === "Open" ? "OPEN" : "CLOSED",
              stateReason: state === "Open" ? null : "COMPLETED"
            }
          }))
        ),
      ReadTaskWorkSpecification: () =>
        Effect.succeed({
          node: {
            __typename: "Issue",
            id: issueId,
            repository: { id: repositoryId },
            title: "Hermetic task",
            body: "Create the exact controlled qualification result."
          }
        }),
      ReadBlockedBy: () =>
        Effect.succeed({
          node: {
            __typename: "Issue",
            id: issueId,
            blockedBy: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } }
          }
        }),
      ReadSubIssues: () =>
        Effect.succeed({
          node: {
            __typename: "Issue",
            id: issueId,
            subIssues: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } }
          }
        }),
      FindClaimLabel: (find) =>
        Ref.get(labels).pipe(
          Effect.map((values) => ({ node: { id: repositoryId, label: values.get(find.labelName) ?? null } }))
        ),
      CreateClaimLabel: (create) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(labels)).has(create.labelName)) return yield* badRequest("claim label already exists")
          const label = FixtureLabel.make({
            id: GithubLabelNodeId.make(`hermetic-label:${create.operationId}`),
            name: create.labelName,
            description: create.description
          })
          yield* Ref.update(labels, (values) => new Map([...values, [label.name, label]]))
          return { createLabel: { label } }
        }),
      DeleteClaimLabel: (remove) =>
        Effect.gen(function* () {
          const values = yield* Ref.get(labels)
          if (![...values.values()].some((label) => label.id === remove.labelNodeId))
            return yield* badRequest("foreign label node")
          yield* Ref.set(labels, new Map([...values].filter(([, label]) => label.id !== remove.labelNodeId)))
          return { deleteLabel: { clientMutationId: remove.operationId } }
        }),
      CloseIssue: (close) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(completionResponse)) === "Throttled") {
            yield* observeBoundary({ _tag: "CompletionThrottle", operationId: close.operationId })
            return { _tag: "ThrottledResponse" as const }
          }
          yield* Ref.set(lifecycle, "Completed")
          yield* observeBoundary({ _tag: "CompletionResponse", operationId: close.operationId })
          return {
            closeIssue: {
              clientMutationId: close.operationId,
              issue: { id: issueId, state: "CLOSED", stateReason: "COMPLETED" }
            }
          }
        }),
      AddBlockedBy: () => Effect.fail(badRequest("fixture cannot add blockers")),
      AddIssueComment: () => Effect.fail(badRequest("fixture cannot add comments")),
      AddSubIssue: () => Effect.fail(badRequest("fixture cannot add subissues")),
      CreateIssue: () => Effect.fail(badRequest("fixture issue is already established")),
      DeleteIssue: () => Effect.fail(badRequest("workflow cannot delete fixture issue")),
      ReadIssueDetails: () => Effect.fail(badRequest("fixture does not expose issue details")),
      ReopenIssue: () => Effect.fail(badRequest("fixture cannot reopen issue"))
    })
    return "_tag" in data
      ? { status: 429, body: { message: "Controlled completion throttle" } }
      : { status: 200, body: { data } }
  })
  const runGit = Effect.fn("HermeticProvider.runGit")(function* (cwd: string, args: ReadonlyArray<string>) {
    const result = yield* git.runInWorktree(cwd, args)
    if (result.exitCode !== 0) return yield* providerFailure("turn/start", "controlled Git command failed")
    return result.stdout.trim()
  })
  const readThread = Effect.fn("HermeticProvider.readThread")(function* (id: CodexThreadId) {
    const thread = (yield* Ref.get(threads)).get(id)
    if (thread === undefined) return yield* providerFailure("thread/read", "unknown controlled thread")
    return thread
  })
  const produceResult = Effect.fn("HermeticProvider.produceResult")(function* (cwd: string, text: string) {
    if (text.startsWith("You are the Dalph integration provider.\n")) {
      if (
        !cwd.startsWith(`${configuration.integratorCandidateWorktreeRoot}/`) ||
        promptFact(text, "Candidate worktree") !== cwd
      )
        return yield* providerFailure("turn/start", "foreign candidate worktree")
      const head = yield* Schema.decodeUnknownEffect(GitCommitSha)(promptFact(text, "Unchanged target head H"))
      const accepted = yield* Schema.decodeUnknownEffect(GitCommitSha)(promptFact(text, "Accepted commit C"))
      if ((yield* runGit(cwd, ["rev-parse", "HEAD"])) !== head)
        return yield* providerFailure("turn/start", "candidate head differs from supplied H")
      yield* runGit(cwd, [
        "-c",
        "user.name=Hermetic provider",
        "-c",
        "user.email=hermetic@example.invalid",
        "merge",
        "--no-ff",
        "--no-edit",
        accepted
      ])
      const candidate = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(cwd, ["rev-parse", "HEAD"]))
      if ((yield* runGit(cwd, ["show", "-s", "--format=%P", candidate])) !== `${head} ${accepted}`)
        return yield* providerFailure("turn/start", "candidate parents differ from H C")
      return JSON.stringify({ version: 1, outcome: "PreparedCandidate", candidate })
    }
    if (!cwd.startsWith(`${configuration.plannedAttemptWorktreeRoot}/`) || promptFact(text, "worktree") !== cwd)
      return yield* providerFailure("turn/start", "foreign task worktree")
    const correlation = yield* Schema.decodeUnknownEffect(PlannedAttemptExecutorCorrelation)({
      runId: promptFact(text, "run_id"),
      attemptId: promptFact(text, "attempt_id")
    })
    const base = yield* Schema.decodeUnknownEffect(GitCommitSha)(promptFact(text, "base_sha"))
    if (base !== configuration.plannedAttemptBaseSha || (yield* runGit(cwd, ["rev-parse", "HEAD"])) !== base)
      return yield* providerFailure("turn/start", "task head differs from planned Base")
    yield* fileSystem.writeFileString(`${cwd}/hermetic-result.txt`, "Controlled immutable accepted result.\n")
    yield* runGit(cwd, ["add", "hermetic-result.txt"])
    yield* runGit(cwd, [
      "-c",
      "user.name=Hermetic provider",
      "-c",
      "user.email=hermetic@example.invalid",
      "commit",
      "-m",
      "controlled accepted result"
    ])
    const commit = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(cwd, ["rev-parse", "HEAD"]))
    return JSON.stringify({ commit, correlation })
  })
  const codex: CodexAppServerService = {
    incarnation: CodexServerIncarnation.make("hermetic-provider-incarnation"),
    attachTurnCompletedHints: Effect.succeed(Stream.never),
    attachOwnedActivityHints: Effect.succeed(Stream.never),
    startThread: (cwd, ownedThreadToken) =>
      Effect.gen(function* () {
        yield* count("CodexStartThread")
        if (
          !cwd.startsWith(`${configuration.plannedAttemptWorktreeRoot}/`) &&
          !cwd.startsWith(`${configuration.integratorCandidateWorktreeRoot}/`)
        )
          return yield* providerFailure("thread/start", "foreign thread worktree")
        const id = CodexThreadId.make(`hermetic-thread:${(yield* Ref.get(threads)).size}`)
        const thread: CodexThreadSnapshot = {
          id,
          cwd: CodexThreadWorkingDirectory.make(cwd),
          status: "idle",
          turns: [],
          ...(ownedThreadToken === undefined ? {} : { ownedThreadToken })
        }
        yield* Ref.update(threads, (values) => new Map([...values, [id, thread]]))
        return thread
      }),
    listThreadsComplete: true,
    listThreads: () =>
      count("CodexListThreads").pipe(
        Effect.andThen(Ref.get(threads)),
        Effect.map((values) =>
          [...values.values()].map((thread) =>
            CodexThreadListSummary.CompleteSummary({
              id: thread.id,
              cwd: thread.cwd,
              summary: { status: thread.status, turns: thread.turns }
            })
          )
        )
      ),
    readThread: (id) => count("CodexReadThread").pipe(Effect.andThen(readThread(id))),
    resumeThread: (id, cwd) =>
      Effect.gen(function* () {
        yield* count("CodexResumeThread")
        const thread = yield* readThread(id)
        if (thread.cwd !== cwd) return yield* providerFailure("thread/resume", "thread worktree changed")
        return thread
      }),
    startTurn: (id, cwd, text, ownedTurnToken) =>
      Effect.gen(function* () {
        yield* count("CodexStartTurn")
        const thread = yield* readThread(id)
        if (thread.cwd !== cwd || ownedTurnToken === undefined)
          return yield* providerFailure("turn/start", "thread or turn ownership is missing")
        const retained = thread.turns.find((turn) => turn.ownedTurnToken === ownedTurnToken)
        if (retained !== undefined) return retained
        const response = yield* produceResult(cwd, text).pipe(
          Effect.mapError(() => providerFailure("turn/start", "controlled result could not be produced"))
        )
        const turn: CodexTurnSnapshot = {
          id: CodexTurnId.make(`hermetic-turn:${id}:${thread.turns.length}`),
          status: "completed",
          ownedTurnToken,
          items: [{ type: "agentMessage", text: response }]
        }
        yield* Ref.update(
          threads,
          (values) => new Map([...values, [id, { ...thread, turns: [...thread.turns, turn] }]])
        )
        return turn
      }),
    interruptTurn: () => count("CodexInterruptTurn"),
    listBackgroundTerminals: () => count("CodexListBackgroundTerminals").pipe(Effect.as([])),
    terminateBackgroundTerminal: () => count("CodexTerminateBackgroundTerminal").pipe(Effect.as(false)),
    close: count("CodexClose")
  }
  return {
    github,
    codex,
    snapshot: () =>
      Effect.gen(function* () {
        const retained = [...(yield* Ref.get(labels)).values()]
        return {
          taskLifecycle: yield* Ref.get(lifecycle),
          activeClaimCount: retained.filter((label) => label.name.startsWith("dalph-claim-")).length,
          completionClaimCount: retained.filter((label) => label.name.startsWith("dalph-completion-")).length,
          operationCounts: yield* Ref.get(counts)
        }
      }),
    setCompletionResponse: (mode: "Applied" | "Throttled") => Ref.set(completionResponse, mode)
  }
})
