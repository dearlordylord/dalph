import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { CoordinatorOwnership, GitCommonDirectoryTarget } from "../../../authorities/coordinator-ownership/ownership.js"
import { productionCoordinatorOwnershipLayer } from "../../../authorities/coordinator-ownership/live-task-work-start.js"
import {
  GitCommand,
  GitCommandInvocationFailure,
  type GitCommandService,
  nodeGitCommandLayer
} from "../../../authorities/git/command.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalDatabaseLocator, JournalPosition } from "../../../workflow-journal/identity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { OperationId } from "../../identity.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  isCleanupEligibleDisposition,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner
} from "./disposition.js"
import { gitDispositionCleanupBoundaryLayer } from "./boundaries.js"
import { BranchCleanupBoundary } from "./branch.js"
import { runWorktreeCleanup, WorktreeCleanupBoundary } from "./worktree.js"
import {
  appendCandidateProvenance,
  appendCurrentQuarantineProvenance,
  appendReplacementProvenance
} from "./provenance-fixtures.js"
import { authorization, attempt, successor, runId as fixtureRunId } from "./fixtures.js"
import { makeDispositionCleanupActivation } from "./loop.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import { dispositionCleanupContract } from "../../../../test/contracts/disposition-cleanup-contract.js"
import {
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateProviderAuthority,
  runIntegratorCandidateCleanup
} from "./integrator-candidate.js"

const candidateAcceptedResult = AcceptedResult.make({
  commit: authorization.expectedHead,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const candidateTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("repo:production-cleanup"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: candidateAcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:production-cleanup-predecessor"),
  expectedTargetHead: authorization.expectedHead,
  integrationTarget: candidateTarget,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:production-cleanup-predecessor"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:production-cleanup-successor"),
  sessionId: IntegratorSessionId.make("session:production-cleanup-successor"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("production-provider-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make(`${candidatePredecessor.sessionId}:predecessor-lineage`),
  operationId: OperationId.make("production-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})

const makeAttempt = (input: {
  readonly baseSha: GitCommitSha
  readonly branch: TaskBranchRef
  readonly runId: RunId
  readonly worktree: WorktreeLocator
}) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make("production-cleanup-predecessor"),
    baseSha: input.baseSha,
    branch: input.branch,
    executor: TaskExecutorLocator.make("executor:production-cleanup"),
    runId: input.runId,
    taskId: TaskId.make("production-cleanup-task"),
    taskRevision: TaskRevision.make("production-cleanup-revision"),
    worktree: input.worktree
  })

const makeWorktreeAuthorization = (plannedAttempt: PlannedTaskAttempt) => {
  const successor = PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: AttemptId.make("production-cleanup-successor"),
    branch: TaskBranchRef.make("refs/heads/dalph/production-cleanup-successor"),
    worktree: WorktreeLocator.make(`${plannedAttempt.worktree}-successor`)
  })
  const disposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
    dispositionAt: JournalPosition.make(5),
    plannedAttempt,
    successorAttempt: successor
  })
  return WorktreeCleanupAuthorization.make({
    causalPredecessors: [OperationId.make("production-cleanup-predecessor-operation")],
    disposition,
    evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
    expectedHead: plannedAttempt.baseSha,
    locator: plannedAttempt.worktree,
    observationAt: JournalPosition.make(4),
    observationOperationId: OperationId.make("production-cleanup-observation"),
    operationId: OperationId.make("production-cleanup-worktree"),
    owner: WorktreeCleanupOwner.make({ attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch }),
    writerQuiescent: true
  })
}

const makeBranchAuthorization = (worktree: WorktreeCleanupAuthorization) =>
  BranchCleanupAuthorization.make({
    causalPredecessors: [worktree.operationId],
    disposition: worktree.disposition,
    evidenceRevision: BranchCleanupEvidenceRevision.make(1),
    expectedHead: worktree.expectedHead,
    locator: worktree.owner.branch,
    observationAt: worktree.observationAt,
    observationOperationId: worktree.observationOperationId,
    operationId: OperationId.make("production-cleanup-branch"),
    owner: BranchCleanupOwner.make({ attemptId: worktree.owner.attemptId }),
    worktreeCleanupOperationId: worktree.operationId,
    writerQuiescent: true
  })

const runGit = Effect.fn("ProductionCleanupQualification.runGit")(function* (
  git: GitCommandService,
  worktree: string,
  ...args: ReadonlyArray<string>
) {
  const result = yield* git.runInWorktree(worktree, args)
  if (result.exitCode !== 0) return yield* Effect.die(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
})

it.effect(
  "production Git cleanup removes only the authorized worktree and branch and leaves an unrelated task intact",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const git = yield* GitCommand
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-cleanup-" })
        const repository = `${root}/repository`
        const worktree = `${root}/worktree-p1`
        const unrelatedWorktree = `${root}/worktree-p2`
        yield* fileSystem.makeDirectory(repository)
        yield* runGit(git, repository, "init", "--initial-branch=main")
        yield* runGit(git, repository, "config", "user.email", "dalph@example.invalid")
        yield* runGit(git, repository, "config", "user.name", "Dalph Test")
        yield* fileSystem.writeFileString(`${repository}/README.md`, "production cleanup\n")
        yield* runGit(git, repository, "add", "README.md")
        yield* runGit(git, repository, "commit", "-m", "initial")
        const baseSha = GitCommitSha.make(yield* runGit(git, repository, "rev-parse", "HEAD"))
        const runId = RunId.make("production-cleanup-run")
        const branch = TaskBranchRef.make("refs/heads/dalph/production-cleanup-p1")
        const unrelatedBranch = "dalph/production-cleanup-p2"
        yield* runGit(git, repository, "worktree", "add", "-b", branch.slice("refs/heads/".length), worktree, baseSha)
        yield* runGit(git, repository, "worktree", "add", "-b", unrelatedBranch, unrelatedWorktree, baseSha)

        const plannedAttempt = makeAttempt({ baseSha, branch, runId, worktree: WorktreeLocator.make(worktree) })
        const worktreeAuthorization = makeWorktreeAuthorization(plannedAttempt)
        const branchAuthorization = makeBranchAuthorization(worktreeAuthorization)
        const boundaries = yield* Effect.gen(function* () {
          return { branch: yield* BranchCleanupBoundary, worktree: yield* WorktreeCleanupBoundary }
        }).pipe(
          Effect.provide(gitDispositionCleanupBoundaryLayer(GitCommonDirectoryTarget.make(`${repository}/.git`))),
          Effect.provide(
            Layer.succeed(
              CoordinatorOwnership,
              CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
            )
          ),
          Effect.provide(NodeServices.layer)
        )

        yield* dispositionCleanupContract({ authorization: worktreeAuthorization, boundary: boundaries.worktree })
        yield* dispositionCleanupContract({ authorization: branchAuthorization, boundary: boundaries.branch })

        expect(yield* fileSystem.exists(unrelatedWorktree)).toBe(true)
        expect(yield* runGit(git, repository, "show-ref", "--verify", `refs/heads/${unrelatedBranch}`)).toContain(
          `refs/heads/${unrelatedBranch}`
        )
      })
    ).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
)

it.effect(
  "production cleanup preserves changed, foreign, unreadable, and malformed Git facts with zero mutation calls",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-cleanup-preserve-" })
        const plainPath = `${root}/plain-directory`
        yield* fileSystem.makeDirectory(plainPath)
        const foreignHead = GitCommitSha.make("2".repeat(40))
        const foreignBranch = TaskBranchRef.make("refs/heads/dalph/foreign-owner")
        const cases = [
          {
            name: "changed",
            stdout: `worktree ${authorization.locator}\nHEAD ${foreignHead}\nbranch ${foreignBranch}\n\n`,
            exitCode: 0,
            stderr: ""
          },
          {
            name: "malformed",
            stdout: `worktree ${authorization.locator}\nHEAD ${authorization.expectedHead}\nunknown field\n\n`,
            exitCode: 0,
            stderr: ""
          },
          { name: "unreadable", stdout: "", exitCode: 2, stderr: "permission denied" }
        ] as const
        for (const current of cases) {
          const mutationCalls = yield* Ref.make(0)
          const commands = GitCommand.of({
            run: (_target, args) => {
              if (args[0] === "worktree" && args[1] === "remove") {
                return Ref.update(mutationCalls, (count) => count + 1).pipe(
                  Effect.as({ exitCode: 0, stderr: "", stdout: "" })
                )
              }
              if (args[0] === "worktree" && args[1] === "list") return Effect.succeed(current)
              return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
            },
            runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "not a git repository", stdout: "" }),
            runBytesInWorktree: () => Effect.die("byte command is outside preservation qualification")
          } satisfies GitCommandService)
          const result = yield* Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* journal.beginRun(
              fixtureRunId,
              FixtureTarget.make(`production-cleanup-preserve-${current.name}`),
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
            )
            yield* appendReplacementProvenance(attempt, successor)
            return yield* runWorktreeCleanup(authorization)
          }).pipe(
            Effect.provide(memoryJournalTestLayer),
            Effect.provide(gitDispositionCleanupBoundaryLayer(GitCommonDirectoryTarget.make(`${root}/repository.git`))),
            Effect.provide(Layer.succeed(GitCommand, commands)),
            Effect.provide(
              Layer.succeed(
                CoordinatorOwnership,
                CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
              )
            ),
            Effect.provide(NodeServices.layer)
          )
          expect(result._tag).toBe("Preserved")
          expect(yield* Ref.get(mutationCalls)).toBe(0)
        }

        const plainAttempt = PlannedTaskAttempt.make({ ...attempt, worktree: WorktreeLocator.make(plainPath) })
        const plainSuccessor = PlannedTaskAttempt.make({
          ...successor,
          worktree: WorktreeLocator.make(`${plainPath}-next`)
        })
        const plainAuthorization = WorktreeCleanupAuthorization.make({
          ...authorization,
          disposition: PlannedAttemptCleanupDisposition.cases.Superseded.make({
            dispositionAt: JournalPosition.make(5),
            plannedAttempt: plainAttempt,
            successorAttempt: plainSuccessor
          }),
          locator: plainAttempt.worktree,
          owner: WorktreeCleanupOwner.make({ attemptId: plainAttempt.attemptId, branch: plainAttempt.branch })
        })
        const plainCommands = GitCommand.of({
          run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
          runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "not a git repository", stdout: "" }),
          runBytesInWorktree: () => Effect.die("byte command is outside plain-path qualification")
        } satisfies GitCommandService)
        const plainObservation = yield* Effect.gen(function* () {
          const boundary = yield* WorktreeCleanupBoundary
          return yield* boundary.observe(plainAuthorization)
        }).pipe(
          Effect.provide(gitDispositionCleanupBoundaryLayer(GitCommonDirectoryTarget.make(`${root}/repository.git`))),
          Effect.provide(Layer.succeed(GitCommand, plainCommands)),
          Effect.provide(
            Layer.succeed(
              CoordinatorOwnership,
              CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
            )
          ),
          Effect.provide(NodeServices.layer)
        )
        expect(plainObservation._tag).toBe("Unregistered")
      })
    ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("production SQLite cleanup reopens after a lost Git response without a duplicate delete", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-cleanup-recovery-" })
      const filename = JournalDatabaseLocator.make(`${root}/journal.sqlite`)
      const present = yield* Ref.make(true)
      const removeCalls = yield* Ref.make(0)
      const commands = GitCommand.of({
        run: (_target, args) => {
          if (args[0] === "worktree" && args[1] === "list") {
            return Ref.get(present).pipe(
              Effect.map((isPresent) => ({
                exitCode: 0,
                stderr: "",
                stdout: isPresent
                  ? `worktree ${authorization.locator}\nHEAD ${authorization.expectedHead}\nbranch ${authorization.owner.branch}\n\n`
                  : ""
              }))
            )
          }
          if (args[0] === "worktree" && args[1] === "remove") {
            return Ref.update(removeCalls, (count) => count + 1).pipe(
              Effect.andThen(Ref.set(present, false)),
              Effect.andThen(
                Effect.fail(
                  new GitCommandInvocationFailure({ detail: "response lost after Git applied worktree removal" })
                )
              )
            )
          }
          return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
        },
        runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "not a git repository", stdout: "" }),
        runBytesInWorktree: () => Effect.die("byte command is outside production cleanup recovery")
      } satisfies GitCommandService)
      const target = GitCommonDirectoryTarget.make(`${root}/repository.git`)
      yield* Effect.gen(function* () {
        const git = yield* GitCommand
        const initialized = yield* git.run(target, ["init", "--bare"])
        expect(initialized.exitCode).toBe(0)
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
      const run = (seed: boolean) =>
        Effect.gen(function* () {
          const journal = yield* JournalStore
          if (seed) {
            yield* journal.beginRun(
              fixtureRunId,
              FixtureTarget.make("production-cleanup-recovery-target"),
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
            )
            yield* appendReplacementProvenance(attempt, successor)
          }
          return yield* runWorktreeCleanup(authorization)
        }).pipe(
          Effect.provide(sqliteJournalTestLayer({ filename })),
          Effect.provide(gitDispositionCleanupBoundaryLayer(target)),
          Effect.provide(Layer.succeed(GitCommand, commands)),
          Effect.provide(productionCoordinatorOwnershipLayer(target)),
          Effect.provide(NodeServices.layer)
        )
      const first = yield* Effect.scoped(run(true))
      const second = yield* Effect.scoped(run(false))
      expect(first._tag).toBe("Pending")
      expect(second._tag).toBe("Settled")
      expect(yield* Ref.get(removeCalls)).toBe(1)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect(
  "production SQLite cleanup reopens after a lost provider response without a duplicate delete for an exact FullRerun predecessor",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-candidate-recovery-" })
        const filename = JournalDatabaseLocator.make(`${root}/journal.sqlite`)
        const activeResources = yield* Ref.make<ReadonlyArray<IntegratorCandidateResourceLocator>>([
          candidatePredecessor.candidateResource,
          candidateSuccessor.candidateResource
        ])
        const observedResources = yield* Ref.make<ReadonlyArray<IntegratorCandidateResourceLocator>>([])
        const removedResources = yield* Ref.make<ReadonlyArray<IntegratorCandidateResourceLocator>>([])
        const providerAuthorityLayer = Layer.succeed(
          IntegratorCandidateProviderAuthority,
          IntegratorCandidateProviderAuthority.of({
            observe: (subject) =>
              Effect.gen(function* () {
                yield* Ref.update(observedResources, (resources) => [...resources, subject.locator])
                const active = yield* Ref.get(activeResources)
                if (!active.includes(subject.locator)) {
                  return IntegratorCandidateCleanupObservation.cases.Absent.make({
                    locator: subject.locator,
                    revision: subject.evidenceRevision
                  })
                }
                const ownerSessionId =
                  subject.locator === candidatePredecessor.candidateResource
                    ? candidatePredecessor.sessionId
                    : candidateSuccessor.sessionId
                return IntegratorCandidateCleanupObservation.cases.Present.make({
                  locator: subject.locator,
                  revision: subject.evidenceRevision,
                  sessionId: ownerSessionId,
                  writerQuiescent: true
                })
              }),
            remove: (subject) =>
              Ref.update(removedResources, (resources) => [...resources, subject.locator]).pipe(
                Effect.andThen(
                  Ref.update(activeResources, (resources) =>
                    resources.filter((resource) => resource !== subject.locator)
                  )
                ),
                // The provider applied the deletion but could not return its
                // ordinary response; the protocol records this as Unknown.
                Effect.as(
                  IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
                    detail: "provider response lost after predecessor removal",
                    locator: subject.locator,
                    sessionId: subject.owner.sessionId
                  })
                )
              )
          })
        )
        const target = GitCommonDirectoryTarget.make(`${root}/repository.git`)
        yield* Effect.gen(function* () {
          const git = yield* GitCommand
          const initialized = yield* git.run(target, ["init", "--bare"])
          expect(initialized.exitCode).toBe(0)
        }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
        const commands = GitCommand.of({
          run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
          runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "not a git repository", stdout: "" }),
          runBytesInWorktree: () => Effect.die("byte command is outside provider authority")
        } satisfies GitCommandService)
        const run = (seed: boolean) =>
          Effect.gen(function* () {
            const journal = yield* JournalStore
            if (seed) {
              yield* journal.beginRun(
                fixtureRunId,
                FixtureTarget.make("production-provider-cleanup-target"),
                InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
              )
              yield* appendCandidateProvenance(
                candidatePredecessor,
                candidateSuccessor,
                "production-provider-full-rerun"
              )
            }
            const outcome = yield* runIntegratorCandidateCleanup(candidateAuthorization)
            return { outcome, records: yield* journal.read(fixtureRunId) }
          }).pipe(
            Effect.provide(sqliteJournalTestLayer({ filename })),
            Effect.provide(gitDispositionCleanupBoundaryLayer(target, providerAuthorityLayer)),
            Effect.provide(Layer.succeed(GitCommand, commands)),
            Effect.provide(productionCoordinatorOwnershipLayer(target)),
            Effect.provide(NodeServices.layer)
          )
        const first = yield* Effect.scoped(run(true))
        const second = yield* Effect.scoped(run(false))
        expect(first.outcome._tag).toBe("Pending")
        expect(second.outcome._tag).toBe("Settled")
        expect(yield* Ref.get(observedResources)).toEqual([
          candidatePredecessor.candidateResource,
          candidatePredecessor.candidateResource
        ])
        expect(yield* Ref.get(removedResources)).toEqual([candidatePredecessor.candidateResource])
        expect(yield* Ref.get(activeResources)).toEqual([candidateSuccessor.candidateResource])
        const records = second.records
        expect(records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
        expect(records.some(({ event }) => event._tag === "IntegrationQuarantined")).toBe(true)
        const successorFixed = records.find(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")?.event
        expect(successorFixed?._tag).toBe("IntegratorSuccessorSessionFixed")
        if (successorFixed?._tag === "IntegratorSuccessorSessionFixed") {
          expect(successorFixed.predecessor.candidateResource).toBe(candidatePredecessor.candidateResource)
          expect(successorFixed.successor.candidateResource).toBe(candidateSuccessor.candidateResource)
          expect(successorFixed.successor.acceptedResult).toEqual(candidatePredecessor.acceptedResult)
        }
        const predecessorFixed = records.find(({ event }) => event._tag === "IntegratorSessionFixed")?.event
        expect(predecessorFixed?._tag).toBe("IntegratorSessionFixed")
        if (predecessorFixed?._tag === "IntegratorSessionFixed") {
          expect(predecessorFixed.correlation.candidateResource).toBe(candidatePredecessor.candidateResource)
          expect(predecessorFixed.correlation.acceptedResult).toEqual(candidateAcceptedResult)
        }
      })
    ).pipe(Effect.provide(NodeServices.layer))
)

it.effect(
  "production provider authority preserves live, foreign, and unreadable candidate facts with zero mutation calls",
  () =>
    Effect.gen(function* () {
      const otherSession = IntegratorSessionId.make("session:production-cleanup-foreign")
      const observations = [
        IntegratorCandidateCleanupObservation.cases.Foreign.make({
          locator: candidateAuthorization.locator,
          observedSessionId: otherSession,
          reason: "OtherSession",
          revision: candidateAuthorization.evidenceRevision
        }),
        IntegratorCandidateCleanupObservation.cases.Foreign.make({
          locator: candidateAuthorization.locator,
          observedSessionId: candidateAuthorization.owner.sessionId,
          reason: "LiveWriter",
          revision: candidateAuthorization.evidenceRevision
        }),
        IntegratorCandidateCleanupObservation.cases.Unreadable.make({
          detail: "provider returned malformed ownership evidence",
          locator: candidateAuthorization.locator
        })
      ]
      const providerMutations = yield* Ref.make(0)
      const providerAuthorityLayer = Layer.succeed(
        IntegratorCandidateProviderAuthority,
        IntegratorCandidateProviderAuthority.of({
          observe: () => {
            const next = observations.shift()
            return next === undefined ? Effect.die("provider observation script exhausted") : Effect.succeed(next)
          },
          remove: (subject) =>
            Ref.update(providerMutations, (count) => count + 1).pipe(
              Effect.as(
                IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
                  detail: "provider mutation must not be reached",
                  locator: subject.locator,
                  sessionId: subject.owner.sessionId
                })
              )
            )
        })
      )
      const candidate = yield* Effect.gen(function* () {
        return yield* IntegratorCandidateCleanupBoundary
      }).pipe(
        Effect.provide(
          gitDispositionCleanupBoundaryLayer(
            GitCommonDirectoryTarget.make("/tmp/production-provider-preservation"),
            providerAuthorityLayer
          )
        ),
        Effect.provide(
          Layer.succeed(
            GitCommand,
            GitCommand.of({
              run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
              runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "not a git repository", stdout: "" }),
              runBytesInWorktree: () => Effect.die("byte command is outside provider preservation")
            })
          )
        ),
        Effect.provide(
          Layer.succeed(
            CoordinatorOwnership,
            CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
          )
        ),
        Effect.provide(NodeServices.layer)
      )
      for (const expected of ["Foreign", "Foreign", "Unreadable"] as const) {
        expect((yield* candidate.observe(candidateAuthorization))._tag).toBe(expected)
      }
      expect(yield* Ref.get(providerMutations)).toBe(0)
    })
)

it.effect("production candidate cleanup satisfies the shared boundary contract", () =>
  Effect.gen(function* () {
    const active = yield* Ref.make(true)
    const providerAuthorityLayer = Layer.succeed(
      IntegratorCandidateProviderAuthority,
      IntegratorCandidateProviderAuthority.of({
        observe: (subject) =>
          Ref.get(active).pipe(
            Effect.map((isActive) =>
              isActive
                ? IntegratorCandidateCleanupObservation.cases.Present.make({
                    locator: subject.locator,
                    revision: subject.evidenceRevision,
                    sessionId: subject.owner.sessionId,
                    writerQuiescent: true
                  })
                : IntegratorCandidateCleanupObservation.cases.Absent.make({
                    locator: subject.locator,
                    revision: subject.evidenceRevision
                  })
            )
          ),
        remove: (subject) =>
          Ref.set(active, false).pipe(
            Effect.as(
              IntegratorCandidateCleanupMutationResult.cases.Removed.make({
                locator: subject.locator,
                revision: subject.evidenceRevision,
                sessionId: subject.owner.sessionId
              })
            )
          )
      })
    )
    const candidate = yield* Effect.gen(function* () {
      return yield* IntegratorCandidateCleanupBoundary
    }).pipe(
      Effect.provide(
        gitDispositionCleanupBoundaryLayer(
          GitCommonDirectoryTarget.make("/tmp/production-provider-contract"),
          providerAuthorityLayer
        )
      ),
      Effect.provide(
        Layer.succeed(
          GitCommand,
          GitCommand.of({
            run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
            runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "not a git repository", stdout: "" }),
            runBytesInWorktree: () => Effect.die("byte command is outside provider contract")
          })
        )
      ),
      Effect.provide(
        Layer.succeed(
          CoordinatorOwnership,
          CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
        )
      ),
      Effect.provide(NodeServices.layer)
    )
    yield* dispositionCleanupContract({ authorization: candidateAuthorization, boundary: candidate })
  })
)

it.effect("production current quarantine performs no cleanup boundary call", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-cleanup-quarantine-" })
      const filename = JournalDatabaseLocator.make(`${root}/journal.sqlite`)
      const gitCalls = yield* Ref.make(0)
      const providerObserveCalls = yield* Ref.make(0)
      const providerRemoveCalls = yield* Ref.make(0)
      const commands = GitCommand.of({
        run: () =>
          Ref.update(gitCalls, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("current quarantine must not observe or mutate Git"))
          ),
        runInWorktree: () =>
          Ref.update(gitCalls, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("current quarantine must not observe or mutate Git"))
          ),
        runBytesInWorktree: () =>
          Ref.update(gitCalls, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("current quarantine must not observe or mutate Git"))
          )
      } satisfies GitCommandService)
      const providerAuthorityLayer = Layer.succeed(
        IntegratorCandidateProviderAuthority,
        IntegratorCandidateProviderAuthority.of({
          observe: (subject) =>
            Ref.update(providerObserveCalls, (count) => count + 1).pipe(
              Effect.andThen(
                Effect.die(`current quarantine must not observe provider candidate ${String(subject.locator)}`)
              )
            ),
          remove: (subject) =>
            Ref.update(providerRemoveCalls, (count) => count + 1).pipe(
              Effect.andThen(
                Effect.die(`current quarantine must not mutate provider candidate ${String(subject.locator)}`)
              )
            )
        })
      )
      const target = GitCommonDirectoryTarget.make(`${root}/repository.git`)
      const evidence = yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          fixtureRunId,
          FixtureTarget.make("production-current-quarantine-target"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        // The journal contains the terminal integrator facts for a current
        // quarantine, but no FullRerun direction or successor evidence. The
        // authorization is therefore not retained or derived at activation.
        yield* appendCurrentQuarantineProvenance(candidatePredecessor)
        const activation = yield* makeDispositionCleanupActivation(fixtureRunId)
        const result = yield* activation.run
        return {
          activation,
          result,
          gitCalls: yield* Ref.get(gitCalls),
          providerObserveCalls: yield* Ref.get(providerObserveCalls),
          providerRemoveCalls: yield* Ref.get(providerRemoveCalls)
        }
      }).pipe(
        Effect.provide(sqliteJournalTestLayer({ filename })),
        Effect.provide(gitDispositionCleanupBoundaryLayer(target, providerAuthorityLayer)),
        Effect.provide(Layer.succeed(GitCommand, commands)),
        Effect.provide(
          Layer.succeed(
            CoordinatorOwnership,
            CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
          )
        ),
        Effect.provide(NodeServices.layer)
      )

      expect(evidence.activation.responsibilities).toEqual({ branch: [], candidate: [], worktree: [] })
      expect(evidence.result.selected).toEqual({ branch: undefined, candidate: undefined, worktree: undefined })
      expect(evidence.result.branchOutcomes).toEqual([])
      expect(evidence.result.candidateOutcomes).toEqual([])
      expect(evidence.result.worktreeOutcomes).toEqual([])
      expect(isCleanupEligibleDisposition({ _tag: "CurrentQuarantine", sessionId: "current-session" })).toBe(false)
      expect(evidence.gitCalls).toBe(0)
      expect(evidence.providerObserveCalls).toBe(0)
      expect(evidence.providerRemoveCalls).toBe(0)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
