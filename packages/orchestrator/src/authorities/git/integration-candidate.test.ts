import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { GitCommitSha, GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand, GitCommandInvocationFailure, GitCommandResult } from "./command.js"
import { nodeGitIntegrationCandidateLayer } from "./integration-candidate.js"
import { IntegrationCandidateGit } from "../../workflow/protocols/integration-candidate-construction/protocol.js"

const repository = GitRepositoryLocator.make("/repositories/candidate.git")
const candidate = GitCommitSha.make("3".repeat(40))
const head = GitCommitSha.make("1".repeat(40))
const accepted = GitCommitSha.make("2".repeat(40))

const readWith = (results: ReadonlyArray<GitCommandResult>) =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make(results)
    const commands = GitCommand.of({
      run: () =>
        Ref.modify(remaining, ([next, ...rest]) => [
          next ?? GitCommandResult.make({ exitCode: 2, stderr: "missing test response", stdout: "" }),
          rest
        ]),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })
    return yield* IntegrationCandidateGit.pipe(
      Effect.flatMap((git) => git.readSubmittedCommit(repository, candidate)),
      Effect.provide(nodeGitIntegrationCandidateLayer),
      Effect.provide(Layer.succeed(GitCommand, commands))
    )
  })

it.effect("reads the submitted commit's exact ordered direct parents without mutating Git", () =>
  Effect.gen(function* () {
    const observation = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "commit\n" }),
      GitCommandResult.make({
        exitCode: 0,
        stderr: "",
        stdout: `tree ${"a".repeat(40)}\nparent ${head}\nparent ${accepted}\nauthor Dalph\n\nmessage\n`
      })
    ])
    expect(observation).toEqual({ _tag: "Commit", directParents: [head, accepted] })
  })
)

it.effect("distinguishes a missing submitted object and a readable non-commit object", () =>
  Effect.gen(function* () {
    expect(
      yield* readWith([GitCommandResult.make({ exitCode: 128, stderr: "fatal: Not a valid object name", stdout: "" })])
    ).toEqual({ _tag: "Missing" })
    expect(yield* readWith([GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "blob\n" })])).toEqual({
      _tag: "NonCommit",
      objectType: "blob"
    })
  })
)

it.effect("keeps unreadable Git and transport failures retryable instead of calling the candidate missing", () =>
  Effect.gen(function* () {
    const unreadable = yield* readWith([
      GitCommandResult.make({ exitCode: 128, stderr: "fatal: repository is not readable", stdout: "" })
    ]).pipe(Effect.flip)
    expect(unreadable).toMatchObject({
      _tag: "IntegrationCandidateGitReadFailure",
      candidateCommit: candidate,
      detail: "fatal: repository is not readable",
      repository
    })
    const silentFailure = yield* readWith([GitCommandResult.make({ exitCode: 129, stderr: "", stdout: "" })]).pipe(
      Effect.flip
    )
    expect(silentFailure).toMatchObject({ detail: "git exited 129" })

    const commands = GitCommand.of({
      run: () => Effect.fail(new GitCommandInvocationFailure({ detail: "cat-file transport failed" })),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })
    const transport = yield* IntegrationCandidateGit.pipe(
      Effect.flatMap((git) => git.readSubmittedCommit(repository, candidate)),
      Effect.provide(nodeGitIntegrationCandidateLayer),
      Effect.provide(Layer.succeed(GitCommand, commands)),
      Effect.flip
    )
    expect(transport).toMatchObject({ detail: "cat-file transport failed" })

    const calls = yield* Ref.make(0)
    const secondCallFailure = GitCommand.of({
      run: () =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.flatMap((call) =>
            call === 1
              ? Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "commit\n" }))
              : Effect.fail(new GitCommandInvocationFailure({ detail: "commit-body transport failed" }))
          )
        ),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })
    const secondTransport = yield* IntegrationCandidateGit.pipe(
      Effect.flatMap((git) => git.readSubmittedCommit(repository, candidate)),
      Effect.provide(nodeGitIntegrationCandidateLayer),
      Effect.provide(Layer.succeed(GitCommand, secondCallFailure)),
      Effect.flip
    )
    expect(secondTransport).toMatchObject({ detail: "commit-body transport failed" })
  })
)

it.effect("treats failure after the type read as ambiguous Git rather than a candidate defect", () =>
  Effect.gen(function* () {
    const failure = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "commit\n" }),
      GitCommandResult.make({ exitCode: 128, stderr: "object became unreadable", stdout: "" })
    ]).pipe(Effect.flip)
    expect(failure).toMatchObject({ _tag: "IntegrationCandidateGitReadFailure", detail: "object became unreadable" })
  })
)

it.effect("types malformed parent object names as unreadable Git", () =>
  Effect.gen(function* () {
    const failure = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "commit\n" }),
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "parent not-a-sha\n\nmessage\n" })
    ]).pipe(Effect.flip)
    expect(failure).toMatchObject({
      _tag: "IntegrationCandidateGitReadFailure",
      detail: "git returned a commit with a malformed parent object name"
    })
  })
)
