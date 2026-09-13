import { makeTaskWorkSpecification, type TaskWorkSpecification } from "@dalph/contracts"
import { GithubGraphqlRequest, GithubLabelName, GithubLabelNodeId, githubTaskIdFor } from "@dalph/orchestrator"
import { Effect, Match, MutableList, Ref, Schema, Stream } from "effect"
import {
  CodexThreadListSummary,
  CodexThreadWorkingDirectory,
  type CodexAppServerService,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "../src/application/codex-app-server.js"
import { CodexServerIncarnation, CodexThreadId, CodexTurnId } from "../src/application/codex-attempt-store.js"
import {
  hermeticQualificationPublicTaskSpecification,
  hermeticQualificationTrackerIdentity,
  type BoundaryReached,
  type HermeticInvocationId
} from "../src/application/production-hermetic-contract.js"
import {
  DisposableGithubCleanupBoundaryFailure,
  type DisposableGithubCleanupAdapter,
  type DisposableGithubQualificationManifest,
  type DisposableGithubQualificationResource
} from "./disposable-github-qualification-cleanup.js"
import { makeHermeticProviderFingerprint } from "./production-hermetic-provider-fingerprint.js"
import { makeHermeticProviderResult, providerFailure } from "./production-hermetic-provider-result.js"
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
  | "QualificationReadRepository"
  | "QualificationReadIssue"
  | "QualificationReadLabel"
  | "QualificationDeleteIssue"
  | "QualificationDeleteLabel"
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

const badRequest = (detail: string) => new HermeticProviderRequestFailure({ detail })

/** Parent-resident outer provider state survives child death; Git, evidence and workflow interpretation remain real. */
export const makeHermeticProviderState = Effect.fn("HermeticProvider.makeState")(function* (
  configuration: ProductionRepositoryHostConfiguration,
  observeBoundary: (boundary: BoundaryReached) => Effect.Effect<void>,
  invocationId: HermeticInvocationId
) {
  const produceResult = yield* makeHermeticProviderResult(configuration)
  const fingerprint = yield* makeHermeticProviderFingerprint()
  const { issueNodeId: issueId, repositoryNodeId: repositoryId } = hermeticQualificationTrackerIdentity
  const repositoryIdentity = {
    owner: configuration.target.owner,
    name: configuration.target.repository,
    nodeId: repositoryId
  }
  const originalIssue: DisposableGithubQualificationResource = {
    _tag: "Issue",
    number: configuration.target.issueNumber,
    nodeId: issueId,
    fingerprint: yield* fingerprint(
      JSON.stringify({ invocationId, specification: hermeticQualificationPublicTaskSpecification })
    )
  }
  const creationReceipts = MutableList.make<DisposableGithubQualificationResource>()
  MutableList.append(creationReceipts, originalIssue)
  const issuePresent = yield* Ref.make(true)
  const taskId = githubTaskIdFor(repositoryId, issueId)
  const taskSpecification = yield* Ref.make(
    makeTaskWorkSpecification({ ...hermeticQualificationPublicTaskSpecification, taskId })
  )
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
  const repositoryLocatorMatches = (request: Extract<GithubGraphqlRequest, { readonly _tag: "ResolveRepository" }>) =>
    request.owner === configuration.target.owner && request.repository === configuration.target.repository
  const issueLocatorMatches = (request: Extract<GithubGraphqlRequest, { readonly _tag: "ResolveIssue" }>) =>
    request.target.owner === configuration.target.owner &&
    request.target.repository === configuration.target.repository &&
    request.target.issueNumber === configuration.target.issueNumber
  const requireNodeIdentity = Effect.fn("HermeticProvider.requireNodeIdentity")(function* (
    request: GithubGraphqlRequest
  ) {
    if ("issueNodeId" in request && request.issueNodeId !== issueId) return yield* badRequest("foreign issue node")
    if ("repositoryNodeId" in request && request.repositoryNodeId !== repositoryId)
      return yield* badRequest("foreign repository node")
  })
  const requireRequestIdentity = Effect.fn("HermeticProvider.requireIdentity")(function* (
    request: GithubGraphqlRequest
  ) {
    yield* requireNodeIdentity(request)
    if (request._tag === "ResolveRepository" && !repositoryLocatorMatches(request))
      return yield* badRequest("foreign repository locator")
    if (request._tag === "ResolveIssue" && !issueLocatorMatches(request))
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
        Ref.get(taskSpecification).pipe(
          Effect.map((specification) => ({
            node: {
              __typename: "Issue",
              id: issueId,
              repository: { id: repositoryId },
              title: specification.title,
              body: specification.body
            }
          }))
        ),
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
          MutableList.append(creationReceipts, {
            _tag: "Label",
            nodeId: label.id,
            name: label.name,
            fingerprint: yield* fingerprint(label.description)
          })
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
  const readThread = Effect.fn("HermeticProvider.readThread")(function* (id: CodexThreadId) {
    const thread = (yield* Ref.get(threads)).get(id)
    if (thread === undefined) return yield* providerFailure("thread/read", "unknown controlled thread")
    return thread
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
  const cleanupAdapter: DisposableGithubCleanupAdapter = {
    readRepository: () =>
      count("QualificationReadRepository").pipe(Effect.as({ _tag: "Present", repository: repositoryIdentity })),
    readResource: (_, resource) =>
      Effect.gen(function* () {
        yield* count(resource._tag === "Issue" ? "QualificationReadIssue" : "QualificationReadLabel")
        if (resource._tag === "Issue") {
          return (yield* Ref.get(issuePresent))
            ? {
                _tag: "Present" as const,
                resource: {
                  ...originalIssue,
                  fingerprint: yield* Ref.get(taskSpecification).pipe(
                    Effect.flatMap((specification) =>
                      fingerprint(
                        JSON.stringify({
                          invocationId,
                          specification: { title: specification.title, body: specification.body }
                        })
                      )
                    )
                  )
                }
              }
            : { _tag: "Absent" as const }
        }
        const label = [...(yield* Ref.get(labels)).values()].find((item) => item.id === resource.nodeId)
        if (label === undefined) return { _tag: "Absent" as const }
        return {
          _tag: "Present" as const,
          resource: {
            _tag: "Label" as const,
            nodeId: label.id,
            name: label.name,
            fingerprint: yield* fingerprint(label.description)
          }
        }
      }).pipe(Effect.mapError(() => new DisposableGithubCleanupBoundaryFailure({ reason: "Unreadable" }))),
    deleteResource: (_, resource) =>
      resource._tag === "Issue"
        ? count("QualificationDeleteIssue").pipe(Effect.andThen(Ref.set(issuePresent, false)))
        : count("QualificationDeleteLabel").pipe(
            Effect.andThen(
              Ref.update(labels, (values) => new Map([...values].filter(([, label]) => label.id !== resource.nodeId)))
            )
          )
  }
  return {
    github,
    codex,
    setPublicTaskSpecification: (specification: TaskWorkSpecification) =>
      specification.taskId === taskId
        ? Ref.set(taskSpecification, specification)
        : Effect.fail(
            new HermeticProviderRequestFailure({ detail: "task specification is outside the exact fixture task" })
          ),
    cleanupAdapter,
    creationManifest: Effect.sync(
      (): DisposableGithubQualificationManifest => ({
        invocationId,
        repository: repositoryIdentity,
        resources: MutableList.toArray(creationReceipts)
      })
    ),
    finalTrackerFacts: Effect.gen(function* () {
      const resources: Array<DisposableGithubQualificationResource> = []
      for (const label of (yield* Ref.get(labels)).values())
        resources.push({
          _tag: "Label",
          nodeId: label.id,
          name: label.name,
          fingerprint: yield* fingerprint(label.description)
        })
      return {
        repository: repositoryIdentity,
        issue: originalIssue,
        issuePresent: yield* Ref.get(issuePresent),
        taskLifecycle: yield* Ref.get(lifecycle),
        claims: resources
      }
    }),
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
