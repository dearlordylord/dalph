/* eslint-disable import/no-nodejs-modules -- the property checks the path boundary with Node's canonical path rules. */
import { NodeFileSystem } from "@effect/platform-node"
import nodePath from "node:path"
import {
  AcceptedResult,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import * as fc from "fast-check"
import { Context, Effect, FileSystem, Layer, Ref, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  CodexIntegratorConfiguration,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  candidateWorktreePathFor,
  codexIntegratorLayer,
  memoryCodexIntegratorPrivateStoreLayer
} from "./codex-integrator.js"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import { CodexServerIncarnation, CodexThreadId, CodexTurnId } from "./codex-attempt-store.js"
import {
  CleanupMutationOrdinal,
  CoordinatorOwnership,
  GitCommand,
  Integrator,
  IntegratorCandidateProviderAuthority,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateResourceLocator,
  IntegratorRequest,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  OperationId,
  type GitCommandService,
  integratorCandidateCleanupAuthorizationEquals
} from "@dalph/orchestrator"

const root = IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-property")
const config = CodexIntegratorConfiguration.make({
  candidateWorktreeRoot: root,
  commonDirectory: "/repositories/property.git",
  privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-property/store.json"),
  repository: GitRepositoryLocator.make("/repositories/property.git")
})

const baseSession = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: GitCommitSha.make("b".repeat(40)),
    evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: "0".repeat(64) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:property"),
  expectedTargetHead: GitCommitSha.make("a".repeat(40)),
  integrationTarget: IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/property.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  }),
  plannedAttempt: PlannedTaskAttempt.make({
    attemptId: "attempt:property",
    baseSha: GitCommitSha.make("a".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/property"),
    executor: TaskExecutorLocator.make("executor:property"),
    runId: "run:property",
    taskId: TaskId.make("task:property"),
    taskRevision: TaskRevision.make("revision:property"),
    worktree: WorktreeLocator.make("/planned/property")
  }),
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("session:property"),
  startedAt: JournalPosition.make(2),
  targetLineageObservedAt: JournalPosition.make(3)
})

const locatorArbitrary = fc
  .string({ minLength: 1, maxLength: 80 })
  .map((value) => IntegratorCandidateResourceLocator.make(value))

const sessionIdArbitrary = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((value) => IntegratorSessionId.make(`session-${value}`))
const operationIdArbitrary = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((value) => OperationId.make(`cleanup-${value}`))
const cleanupIdentityArbitrary = fc.record({
  locator: locatorArbitrary,
  sessionId: sessionIdArbitrary,
  evidenceRevision: fc.integer({ min: 1, max: 100 }),
  observationOperationId: operationIdArbitrary,
  operationId: operationIdArbitrary,
  causalPredecessor: operationIdArbitrary
})
const authorityIdentityArbitrary = fc.record({
  locator: fc
    .string({ minLength: 1, maxLength: 30 })
    .map((value) => IntegratorCandidateResourceLocator.make(`candidate:authority:${value}`)),
  sessionId: fc
    .string({ minLength: 1, maxLength: 20 })
    .map((value) => IntegratorSessionId.make(`authority-session-${value}`)),
  evidenceRevision: fc.integer({ min: 1, max: 20 }),
  writerState: fc.constantFrom("Absent", "ExactLive", "Unreadable", "Contradictory"),
  ownerMatches: fc.boolean(),
  registration: fc.constantFrom<AuthorityRegistration>("exact", "foreign", "missing"),
  operationId: operationIdArbitrary,
  observationOperationId: operationIdArbitrary,
  causalPredecessor: operationIdArbitrary
})

const sessionForCleanup = (sessionId: IntegratorSessionId, locator: IntegratorCandidateResourceLocator) =>
  IntegratorSessionCorrelation.make({
    ...baseSession,
    candidateResource: locator,
    sessionId,
    targetLineageObservedAt: JournalPosition.make(2)
  })

type AuthorityRegistration = "exact" | "foreign" | "missing"

type AuthorityPropertyOptions = {
  readonly candidatePath: string
  readonly registration: { value: AuthorityRegistration }
  readonly activitySequence: ReadonlyArray<CodexOwnedActivityCensusProjection>
  readonly gitCalls: Array<ReadonlyArray<string>>
}

const authorityFixtureLayer = (
  options: AuthorityPropertyOptions
): Layer.Layer<
  CodexAppServer | CodexOwnedActivityCensus | GitCommand | CoordinatorOwnership,
  never,
  FileSystem.FileSystem
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const registered = yield* Ref.make(false)
      const turns = yield* Ref.make<ReadonlyArray<CodexTurnSnapshot>>([])
      const activityReads = yield* Ref.make(0)
      const app: CodexAppServerService = {
        incarnation: CodexServerIncarnation.make("property-incarnation"),
        startThread: (cwd) =>
          Effect.succeed({ id: CodexThreadId.make("property-thread"), cwd, status: "idle" as const, turns: [] }),
        readThread: () =>
          Ref.get(turns).pipe(
            Effect.map((current) => ({
              id: CodexThreadId.make("property-thread"),
              cwd: options.candidatePath,
              status: "idle" as const,
              turns: current
            }))
          ),
        resumeThread: (_threadId, cwd) =>
          Ref.get(turns).pipe(
            Effect.map((current) => ({
              id: CodexThreadId.make("property-thread"),
              cwd,
              status: "idle" as const,
              turns: current
            }))
          ),
        startTurn: (_threadId, cwd, _prompt, token) => {
          if (token === undefined) return Effect.die("property fixture received no owned token")
          const turn: CodexTurnSnapshot = {
            id: CodexTurnId.make("property-turn"),
            status: "completed",
            ownedTurnToken: token,
            items: [
              {
                type: "agentMessage",
                text: '{"version":1,"outcome":"PreparedCandidate","candidate":"property-candidate"}'
              }
            ]
          }
          return Ref.update(turns, (current) => [...current, turn]).pipe(Effect.as({ ...turn, cwd }))
        },
        interruptTurn: () => Effect.void,
        listBackgroundTerminals: () => Effect.succeed([]),
        terminateBackgroundTerminal: () => Effect.succeed(true),
        close: Effect.void
      }
      const git: GitCommandService = {
        run: (_directory, args) =>
          Effect.gen(function* () {
            options.gitCalls.push(args)
            if (args[0] === "worktree" && args[1] === "list") {
              const visible = options.registration.value !== "missing" && (yield* Ref.get(registered))
              if (!visible) return { exitCode: 0, stderr: "", stdout: "" }
              return options.registration.value === "foreign"
                ? {
                    exitCode: 0,
                    stderr: "",
                    stdout: `worktree ${options.candidatePath}\nHEAD ${"c".repeat(40)}\nbranch refs/heads/foreign\n\n`
                  }
                : {
                    exitCode: 0,
                    stderr: "",
                    stdout: `worktree ${options.candidatePath}\nHEAD ${"a".repeat(40)}\ndetached\n\n`
                  }
            }
            if (args[0] === "worktree" && args[1] === "add") {
              yield* Ref.set(registered, true)
              yield* fileSystem.makeDirectory(options.candidatePath, { recursive: true })
            }
            if (args[0] === "worktree" && args[1] === "remove") {
              yield* Ref.set(registered, false)
              if (yield* fileSystem.exists(options.candidatePath)) {
                yield* fileSystem.remove(options.candidatePath, { recursive: true })
              }
            }
            return { exitCode: 0, stderr: "", stdout: "" }
          }),
        runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
        runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
      }
      const census = CodexOwnedActivityCensus.of({
        observe: () =>
          Ref.modify(activityReads, (index) => {
            const projection = options.activitySequence[Math.min(index, options.activitySequence.length - 1)] ?? {
              _tag: "Absent" as const
            }
            return [projection, index + 1] as const
          }),
        terminateDescendants: () => Effect.void
      })
      const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
      yield* Effect.addFinalizer(() =>
        fileSystem.exists(options.candidatePath).pipe(
          Effect.flatMap((exists) =>
            exists ? fileSystem.remove(options.candidatePath, { recursive: true }) : Effect.void
          ),
          Effect.orDie
        )
      )
      return Context.empty().pipe(
        Context.add(CodexAppServer, app),
        Context.add(CodexOwnedActivityCensus, census),
        Context.add(GitCommand, git),
        Context.add(CoordinatorOwnership, ownership)
      )
    })
  )

const authorityProviderLayer = (config: CodexIntegratorConfiguration, options: AuthorityPropertyOptions) =>
  codexIntegratorLayer(config).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeFileSystem.layer,
        memoryCodexIntegratorPrivateStoreLayer(),
        authorityFixtureLayer(options).pipe(Layer.provide(NodeFileSystem.layer))
      )
    )
  )

describe("Codex Integrator candidate mapping", () => {
  it("keeps every arbitrary resource locator beneath the configured root", () => {
    fc.assert(
      fc.property(locatorArbitrary, (locator) => {
        const candidate = candidateWorktreePathFor(config, locator)
        const relative = nodePath.relative(root, candidate)
        expect(relative.length).toBeGreaterThan(0)
        expect(relative.startsWith(".." + nodePath.sep)).toBe(false)
        expect(nodePath.isAbsolute(relative)).toBe(false)
        expect(candidateWorktreePathFor(config, locator)).toBe(candidate)
      })
    )
  })

  it("gives distinct arbitrary resource locators distinct candidate paths", () => {
    fc.assert(
      fc.property(fc.uniqueArray(locatorArbitrary, { minLength: 2, maxLength: 2 }), (locators) => {
        const candidates = locators.map((locator) => candidateWorktreePathFor(config, locator))
        expect(new Set(candidates).size).toBe(locators.length)
      })
    )
  })

  it("preserves the exact cleanup identity table and rejects subject drift", () => {
    fc.assert(
      fc.property(cleanupIdentityArbitrary, (identity) => {
        const predecessor = sessionForCleanup(identity.sessionId, identity.locator)
        const successor = IntegratorSessionCorrelation.make({
          ...baseSession,
          candidateResource: IntegratorCandidateResourceLocator.make(`${identity.locator}:successor`),
          sessionId: IntegratorSessionId.make(`${identity.sessionId}:successor`),
          targetLineageObservedAt: JournalPosition.make(12)
        })
        const authorization = IntegratorCandidateCleanupAuthorization.make({
          causalPredecessors: [identity.causalPredecessor],
          disposition: IntegratorCandidateCleanupDisposition.make({
            directionAppliedAt: JournalPosition.make(10),
            dispositionAt: JournalPosition.make(9),
            predecessor,
            successor
          }),
          evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(identity.evidenceRevision),
          locator: identity.locator,
          observationAt: JournalPosition.make(4),
          observationOperationId: identity.observationOperationId,
          operationId: identity.operationId,
          owner: IntegratorCandidateCleanupOwner.make({ sessionId: identity.sessionId }),
          writerQuiescent: true
        })
        expect(Schema.is(IntegratorCandidateCleanupAuthorization)(authorization)).toBe(true)
        expect(authorization.locator).toBe(identity.locator)
        expect(authorization.owner.sessionId).toBe(identity.sessionId)
        expect(authorization.evidenceRevision).toBe(identity.evidenceRevision)
        expect(authorization.writerQuiescent).toBe(true)
        expect(authorization.operationId).toBe(identity.operationId)
        expect(authorization.observationOperationId).toBe(identity.observationOperationId)

        const otherLocator = IntegratorCandidateResourceLocator.make(`${identity.locator}:other`)
        const otherSession = IntegratorSessionId.make(`${identity.sessionId}:other`)
        expect(Schema.is(IntegratorCandidateCleanupAuthorization)({ ...authorization, locator: otherLocator })).toBe(
          false
        )
        expect(
          Schema.is(IntegratorCandidateCleanupAuthorization)({
            ...authorization,
            owner: IntegratorCandidateCleanupOwner.make({ sessionId: otherSession })
          })
        ).toBe(false)
        expect(Schema.is(IntegratorCandidateCleanupAuthorization)({ ...authorization, writerQuiescent: false })).toBe(
          false
        )
        expect(
          integratorCandidateCleanupAuthorizationEquals(authorization, {
            ...authorization,
            evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(identity.evidenceRevision + 1)
          })
        ).toBe(false)
        expect(
          integratorCandidateCleanupAuthorizationEquals(authorization, {
            ...authorization,
            operationId: OperationId.make(`${identity.operationId}:other`)
          })
        ).toBe(false)
      })
    )
  })

  it("proves cleanup mutates only for exact ownership, registration, and quiescent activity", async () => {
    await fc.assert(
      fc.asyncProperty(authorityIdentityArbitrary, async (identity) => {
        const predecessor = sessionForCleanup(identity.sessionId, identity.locator)
        const successor = IntegratorSessionCorrelation.make({
          ...baseSession,
          candidateResource: IntegratorCandidateResourceLocator.make(`${identity.locator}:successor`),
          sessionId: IntegratorSessionId.make(`${identity.sessionId}:successor`),
          targetLineageObservedAt: JournalPosition.make(12)
        })
        const authorization = IntegratorCandidateCleanupAuthorization.make({
          causalPredecessors: [identity.causalPredecessor],
          disposition: IntegratorCandidateCleanupDisposition.make({
            directionAppliedAt: JournalPosition.make(10),
            dispositionAt: JournalPosition.make(9),
            predecessor,
            successor
          }),
          evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(identity.evidenceRevision),
          locator: identity.locator,
          observationAt: JournalPosition.make(4),
          observationOperationId: identity.observationOperationId,
          operationId: identity.operationId,
          owner: IntegratorCandidateCleanupOwner.make({ sessionId: identity.sessionId }),
          writerQuiescent: true
        })
        const registration = { value: "exact" as AuthorityRegistration }
        const providerSession = identity.ownerMatches
          ? predecessor
          : IntegratorSessionCorrelation.make({
              ...predecessor,
              sessionId: IntegratorSessionId.make(`${identity.sessionId}:foreign-owner`)
            })
        const writer: CodexOwnedActivityCensusProjection =
          identity.writerState === "Absent"
            ? { _tag: "Absent" }
            : identity.writerState === "ExactLive"
              ? {
                  _tag: "ExactLive",
                  activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("authority-live-turn") }]
                }
              : { _tag: identity.writerState, detail: `authority ${identity.writerState.toLowerCase()}` }
        const gitCalls: Array<ReadonlyArray<string>> = []
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const integrator = yield* Integrator
            yield* integrator.prepare(
              IntegratorRequest.make({
                correlation: IntegratorRunCorrelation.make({
                  ordinal: IntegratorRunOrdinal.make(1),
                  session: providerSession
                })
              })
            )
            registration.value = identity.registration
            const authority = yield* IntegratorCandidateProviderAuthority
            const observed = yield* authority.observe(authorization)
            const removed = yield* authority.remove(authorization, CleanupMutationOrdinal.make(1))
            return { observed, removed }
          }).pipe(
            Effect.provide(
              authorityProviderLayer(config, {
                activitySequence: [{ _tag: "Absent" }, { _tag: "Absent" }, writer],
                candidatePath: candidateWorktreePathFor(config, identity.locator),
                gitCalls,
                registration
              })
            )
          )
        )
        const canMutate =
          identity.ownerMatches && identity.registration === "exact" && identity.writerState === "Absent"
        expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(
          canMutate ? 1 : 0
        )
        expect(result.removed._tag).toBe(canMutate ? "Removed" : "DefinitelyNotApplied")
        expect(result.observed._tag).toBe(
          canMutate
            ? "Present"
            : identity.ownerMatches && identity.registration === "exact"
              ? identity.writerState === "ExactLive"
                ? "Foreign"
                : "Unreadable"
              : "Foreign"
        )
      }),
      { numRuns: 12 }
    )
  })
})
