import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, makeTaskWorkSpecification } from "@dalph/contracts"
import { GitCommand, githubTaskIdFor, nodeGitCommandLayer } from "@dalph/orchestrator"
import { Deferred, Effect, Exit, FileSystem, Fiber, Layer, Ref, Schema } from "effect"
import { expect } from "vitest"
import { CodexOwnedTurnToken, CodexThreadOwnershipToken } from "../src/application/codex-attempt-store.js"
import { decodeProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import { makeHermeticProviderState } from "./production-hermetic-provider-state.js"
import {
  HermeticInvocationId,
  hermeticQualificationPublicTaskSpecification,
  hermeticQualificationTrackerIdentity
} from "../src/application/production-hermetic-contract.js"

const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const invocationId = HermeticInvocationId.make("q-provider-evidence")

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-hermetic-provider-" })
  const repository = `${root}/repository`
  yield* fs.makeDirectory(repository)
  const runGit = Effect.fn("HermeticProviderTest.git")(function* (cwd: string, args: ReadonlyArray<string>) {
    const result = yield* git.runInWorktree(cwd, args)
    expect(result.exitCode).toBe(0)
    return result.stdout.trim()
  })
  yield* runGit(repository, ["init", "--initial-branch=master"])
  yield* runGit(repository, ["config", "user.name", "Hermetic test"])
  yield* runGit(repository, ["config", "user.email", "hermetic@example.invalid"])
  yield* fs.writeFileString(`${repository}/base.txt`, "base\n")
  yield* runGit(repository, ["add", "base.txt"])
  yield* runGit(repository, ["commit", "-m", "base"])
  const head = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(repository, ["rev-parse", "HEAD"]))
  const configuration = yield* decodeProductionRepositoryHostConfiguration({
    target: { _tag: "GithubIssue", owner: "hermetic", repository: "fixture", issueNumber: 1 },
    repository,
    commonDirectory: `${repository}/.git`,
    integrationRef: "refs/heads/master",
    plannedAttemptBaseSha: head,
    plannedAttemptExecutor: "codex:hermetic",
    claimOwner: "dalph:hermetic",
    taskWorkCapacity: 1,
    journalDatabase: `${root}/journal.sqlite`,
    evidenceStoreRoot: `${root}/evidence`,
    plannedAttemptWorktreeRoot: `${root}/tasks`,
    codexExecutorPrivateStateDirectory: `${root}/codex-executor-private`,
    integratorCandidateWorktreeRoot: `${root}/candidates`,
    integratorPrivateStore: `${root}/private`,
    activationInterval: "1 second",
    failureCooldown: "1 second",
    codexExecutable: "controlled-codex",
    codexClientName: "hermetic",
    codexClientVersion: "1",
    githubToken: "sentinel-secret"
  })
  return { root, repository, head, configuration, runGit }
})

const request = (operation: string, variables: Readonly<Record<string, unknown>>) => ({
  query: `query ${operation}($fixture: String!) { fixture }`,
  variables
})

it.effect(
  "keeps the original issue receipt while the actual tracker source and fresh ownership fingerprint change",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { configuration } = yield* setup
        const provider = yield* makeHermeticProviderState(configuration, () => Effect.void, invocationId)
        const original = yield* provider.creationManifest
        const issue = original.resources.find((resource) => resource._tag === "Issue")
        if (issue === undefined) return yield* Effect.die("the actual issue creation receipt must exist")
        expect(yield* provider.cleanupAdapter.readResource(original.repository, issue)).toEqual({
          _tag: "Present",
          resource: issue
        })
        const specification = makeTaskWorkSpecification({
          taskId: githubTaskIdFor(
            hermeticQualificationTrackerIdentity.repositoryNodeId,
            hermeticQualificationTrackerIdentity.issueNodeId
          ),
          title: hermeticQualificationPublicTaskSpecification.title,
          body: "qualification-private-source-sentinel"
        })
        yield* provider.setPublicTaskSpecification(specification)
        const response = yield* provider.github(request("ReadTaskWorkSpecification", { issueNodeId: issue.nodeId }))
        expect(response).toEqual({
          status: 200,
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: issue.nodeId,
                repository: { id: original.repository.nodeId },
                title: specification.title,
                body: specification.body
              }
            }
          }
        })
        const observed = yield* provider.cleanupAdapter.readResource(original.repository, issue)
        expect(observed._tag).toBe("Present")
        if (observed._tag === "Present") {
          expect(observed.resource.nodeId).toBe(issue.nodeId)
          expect(observed.resource.fingerprint).not.toBe(issue.fingerprint)
          expect(JSON.stringify(observed).includes(specification.body)).toBe(false)
        }
        expect((yield* provider.creationManifest).resources[0]).toBe(issue)
        expect(yield* provider.creationManifest).toEqual(original)
        expect((yield* provider.finalTrackerFacts).issuePresent).toBe(true)
      })
    ).pipe(Effect.provide(fixtureLayer))
)

it.effect("keeps exact claims and applied completion in parent state while the response is withheld", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { configuration } = yield* setup
      const reached = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const provider = yield* makeHermeticProviderState(
        configuration,
        () => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(release))),
        invocationId
      )
      expect(
        (yield* provider.github(request("ResolveIssue", { owner: "hermetic", repository: "fixture", issueNumber: 1 })))
          .status
      ).toBe(200)
      const create = yield* provider.github(
        request("CreateClaimLabel", {
          repositoryNodeId: "hermetic-repository",
          labelName: "dalph-claim-exact",
          description: "exact claim",
          operationId: "claim-one"
        })
      )
      expect(create.body).toEqual({
        data: {
          createLabel: {
            label: { id: "hermetic-label:claim-one", name: "dalph-claim-exact", description: "exact claim" }
          }
        }
      })
      yield* provider.github(
        request("CreateClaimLabel", {
          repositoryNodeId: "hermetic-repository",
          labelName: "dalph-completion-exact",
          description: "exact completion",
          operationId: "completion-one"
        })
      )
      const originals = yield* provider.creationManifest
      expect(originals.invocationId).toBe(invocationId)
      expect(originals.resources.map(({ _tag, nodeId }) => ({ _tag, nodeId }))).toEqual([
        { _tag: "Issue", nodeId: "hermetic-issue" },
        { _tag: "Label", nodeId: "hermetic-label:claim-one" },
        { _tag: "Label", nodeId: "hermetic-label:completion-one" }
      ])
      expect(JSON.stringify(originals)).not.toContain("exact claim")
      expect(JSON.stringify(originals)).not.toContain("exact completion")
      const closing = yield* provider
        .github(request("CloseIssue", { issueNodeId: "hermetic-issue", operationId: "close-one" }))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(reached)
      expect(yield* provider.snapshot()).toMatchObject({
        taskLifecycle: "Completed",
        activeClaimCount: 1,
        completionClaimCount: 1
      })
      expect((yield* provider.snapshot()).operationCounts.filter(({ tag }) => tag === "CloseIssue")).toEqual([
        { tag: "CloseIssue", count: 1 }
      ])
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(closing)).body).toEqual({
        data: {
          closeIssue: {
            clientMutationId: "close-one",
            issue: { id: "hermetic-issue", state: "CLOSED", stateReason: "COMPLETED" }
          }
        }
      })
      yield* provider.codex.close
      expect((yield* provider.github(request("ReadIssue", { issueNodeId: "hermetic-issue" }))).body).toMatchObject({
        data: { node: { state: "CLOSED", stateReason: "COMPLETED" } }
      })
      yield* provider.github(
        request("DeleteClaimLabel", { labelNodeId: "hermetic-label:claim-one", operationId: "delete-one" })
      )
      yield* provider.github(
        request("DeleteClaimLabel", { labelNodeId: "hermetic-label:completion-one", operationId: "delete-two" })
      )
      expect(
        (yield* provider.github(
          request("FindClaimLabel", { repositoryNodeId: "hermetic-repository", labelName: "dalph-claim-exact" })
        )).body
      ).toEqual({ data: { node: { id: "hermetic-repository", label: null } } })
      expect(yield* provider.snapshot()).toMatchObject({ activeClaimCount: 0, completionClaimCount: 0 })
      expect(yield* provider.creationManifest).toEqual(originals)
      expect((yield* provider.finalTrackerFacts).claims).toEqual([])
      for (const resource of originals.resources) {
        const observed = yield* provider.cleanupAdapter.readResource(originals.repository, resource)
        expect(observed._tag).toBe(resource._tag === "Issue" ? "Present" : "Absent")
      }
      const issue = originals.resources.find((resource) => resource._tag === "Issue")
      expect(issue).toBeDefined()
      if (issue === undefined) return yield* Effect.die("the original issue receipt must be retained")
      yield* provider.cleanupAdapter.deleteResource(originals.repository, issue)
      expect(yield* provider.cleanupAdapter.readResource(originals.repository, issue)).toEqual({ _tag: "Absent" })
      expect(yield* provider.creationManifest).toEqual(originals)
    })
  ).pipe(Effect.provide(fixtureLayer))
)

it.effect("returns one actual HTTP throttle response without closing and rejects foreign or malformed requests", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { configuration } = yield* setup
      const boundaries = yield* Ref.make<ReadonlyArray<string>>([])
      const reached = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const provider = yield* makeHermeticProviderState(
        configuration,
        (boundary) =>
          Ref.update(boundaries, (values) => [...values, boundary._tag]).pipe(
            Effect.andThen(Deferred.succeed(reached, undefined)),
            Effect.andThen(Deferred.await(release))
          ),
        invocationId
      )
      yield* provider.setCompletionResponse("Throttled")
      const throttled = yield* provider
        .github(request("CloseIssue", { issueNodeId: "hermetic-issue", operationId: "throttle-one" }))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(reached)
      expect(yield* Ref.get(boundaries)).toEqual(["CompletionThrottle"])
      expect(yield* provider.snapshot()).toMatchObject({
        taskLifecycle: "Open",
        operationCounts: [{ tag: "CloseIssue", count: 1 }]
      })
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(throttled)).toEqual({ status: 429, body: { message: "Controlled completion throttle" } })
      expect(
        Exit.isFailure(yield* Effect.exit(provider.github(request("ReadIssue", { issueNodeId: "foreign-issue" }))))
      ).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(provider.github({ query: "not a named request", variables: {} })))).toBe(
        true
      )
      expect((yield* provider.snapshot()).operationCounts).toEqual([{ tag: "CloseIssue", count: 1 }])
    })
  ).pipe(Effect.provide(fixtureLayer))
)

it.effect("creates real accepted and two-parent candidate commits through owned Codex turns", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { configuration, head, repository, runGit } = yield* setup
      const provider = yield* makeHermeticProviderState(configuration, () => Effect.void, invocationId)
      const worktree = `${configuration.plannedAttemptWorktreeRoot}/task-one`
      const candidate = `${configuration.integratorCandidateWorktreeRoot}/candidate-one`
      yield* runGit(repository, ["worktree", "add", "-b", "task-one", worktree, head])
      const thread = yield* provider.codex.startThread(worktree, CodexThreadOwnershipToken.make("owned-task"))
      const text = `# Hermetic task\nCreate the exact result.\n\nDalph immutable attempt facts:\nrun_id: run:hermetic\nattempt_id: attempt:hermetic\ntask_id: task:hermetic\ntask_revision: revision:hermetic\nbase_sha: ${head}\nbranch: refs/heads/task-one\nworktree: ${worktree}`
      const token = CodexOwnedTurnToken.make("owned-task-turn")
      const turn = yield* provider.codex.startTurn(thread.id, worktree, text, token)
      const envelope = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ type: Schema.Literal("agentMessage"), text: Schema.String })
      )(turn.items[0])
      const result = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            commit: GitCommitSha,
            correlation: Schema.Struct({ runId: Schema.String, attemptId: Schema.String })
          })
        )
      )(envelope.text)
      expect(result.correlation).toEqual({ runId: "run:hermetic", attemptId: "attempt:hermetic" })
      expect(yield* runGit(worktree, ["rev-parse", "HEAD"])).toBe(result.commit)
      expect(yield* runGit(worktree, ["show", "-s", "--format=%P", result.commit])).toBe(head)
      expect(yield* provider.codex.startTurn(thread.id, worktree, text, token)).toEqual(turn)
      expect((yield* provider.codex.readThread(thread.id)).turns).toEqual([turn])
      yield* runGit(repository, ["worktree", "add", "--detach", candidate, head])
      const integration = yield* provider.codex.startThread(
        candidate,
        CodexThreadOwnershipToken.make("owned-integrator")
      )
      const integrationTurn = yield* provider.codex.startTurn(
        integration.id,
        candidate,
        `You are the Dalph integration provider.\nUnchanged target head H: ${head}\nAccepted commit C: ${result.commit}\nCandidate worktree: ${candidate}`,
        CodexOwnedTurnToken.make("owned-integrator-turn")
      )
      const preparedMessage = yield* Schema.decodeUnknownEffect(Schema.Struct({ text: Schema.String }))(
        integrationTurn.items[0]
      )
      const prepared = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            version: Schema.Literal(1),
            outcome: Schema.Literal("PreparedCandidate"),
            candidate: GitCommitSha
          })
        )
      )(preparedMessage.text)
      expect(yield* runGit(candidate, ["show", "-s", "--format=%P", prepared.candidate])).toBe(
        `${head} ${result.commit}`
      )
      expect(yield* runGit(repository, ["rev-parse", configuration.integrationRef])).toBe(head)
    })
  ).pipe(Effect.provide(fixtureLayer))
)
