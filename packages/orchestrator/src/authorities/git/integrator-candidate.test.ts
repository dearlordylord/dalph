import { it } from "@effect/vitest"
import { GitCommitSha, GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { IntegratorCandidateText, IntegratorGit } from "../../workflow/protocols/integrator/protocol.js"
import { GitCommand, GitCommandInvocationFailure, GitCommandResult } from "./command.js"
import { nodeGitIntegratorCandidateLayer } from "./integrator-candidate.js"

const target = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/integrator.git")
})
const candidateText = IntegratorCandidateText.make("reported-candidate")
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
    return yield* IntegratorGit.pipe(
      Effect.flatMap((git) => git.readCandidate(target, candidateText)),
      Effect.provide(nodeGitIntegratorCandidateLayer),
      Effect.provide(Layer.succeed(GitCommand, commands))
    )
  })

it.effect("canonicalizes the reported text and reads that commit's exact ordered direct parents", () =>
  Effect.gen(function* () {
    const observation = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: `${candidate}\n` }),
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "commit\n" }),
      GitCommandResult.make({
        exitCode: 0,
        stderr: "",
        stdout: `tree ${"a".repeat(40)}\nparent ${head}\nparent ${accepted}\n\nmessage\n`
      })
    ])
    expect(observation).toEqual({ _tag: "Commit", candidateText, commit: candidate, directParents: [head, accepted] })
  })
)

it.effect("reads commit headers even when Git returns no message separator", () =>
  Effect.gen(function* () {
    const observation = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: `${candidate}\n` }),
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "commit\n" }),
      GitCommandResult.make({
        exitCode: 0,
        stderr: "",
        stdout: `tree ${"a".repeat(40)}\nparent ${head}\nparent ${accepted}`
      })
    ])
    expect(observation).toEqual({ _tag: "Commit", candidateText, commit: candidate, directParents: [head, accepted] })
  })
)

it.effect("distinguishes missing and non-commit reported objects", () =>
  Effect.gen(function* () {
    expect(
      yield* readWith([GitCommandResult.make({ exitCode: 128, stderr: "fatal: needed a single revision", stdout: "" })])
    ).toEqual({ _tag: "Missing", candidateText })
    expect(
      yield* readWith([
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: `${candidate}\n` }),
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "blob\n" })
      ])
    ).toEqual({ _tag: "NonCommit", candidateText, objectType: "blob" })
  })
)

it.effect("keeps an unreadable canonical object retryable", () =>
  Effect.gen(function* () {
    const failure = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: `${candidate}\n` }),
      GitCommandResult.make({ exitCode: 128, stderr: "object became unreadable", stdout: "" })
    ]).pipe(Effect.flip)
    expect(failure).toMatchObject({
      _tag: "IntegratorGitReadFailure",
      candidateText,
      detail: "object became unreadable",
      target
    })
  })
)

it.effect("passes option-shaped reported candidate text to Git strictly as revision data", () =>
  Effect.gen(function* () {
    const optionShapedCandidate = IntegratorCandidateText.make("--help")
    const commands = GitCommand.of({
      run: (_repository, args) =>
        Effect.sync(() => {
          expect(args).toEqual(["rev-parse", "--verify", "--end-of-options", `${optionShapedCandidate}^{object}`])
          return GitCommandResult.make({ exitCode: 128, stderr: "fatal: needed a single revision", stdout: "" })
        }),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })

    const observation = yield* IntegratorGit.pipe(
      Effect.flatMap((git) => git.readCandidate(target, optionShapedCandidate)),
      Effect.provide(nodeGitIntegratorCandidateLayer),
      Effect.provide(Layer.succeed(GitCommand, commands))
    )

    expect(observation).toEqual({ _tag: "Missing", candidateText: optionShapedCandidate })
  })
)

it.effect("keeps every ambiguous Git command and malformed object response retryable", () =>
  Effect.gen(function* () {
    const runScript = (script: ReadonlyArray<Effect.Effect<GitCommandResult, GitCommandInvocationFailure>>) =>
      Effect.gen(function* () {
        const remaining = yield* Ref.make(script)
        const commands = GitCommand.of({
          run: () =>
            Ref.modify(remaining, ([next, ...rest]) => [
              next ?? Effect.die("missing scripted Git response"),
              rest
            ]).pipe(Effect.flatten),
          runBytesInWorktree: () => Effect.die("unused"),
          runInWorktree: () => Effect.die("unused")
        })
        return yield* IntegratorGit.pipe(
          Effect.flatMap((git) => git.readCandidate(target, candidateText)),
          Effect.provide(nodeGitIntegratorCandidateLayer),
          Effect.provide(Layer.succeed(GitCommand, commands)),
          Effect.flip
        )
      })
    const ok = (stdout: string) => Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout }))
    const commandFailure = Effect.fail(new GitCommandInvocationFailure({ detail: "Git process disappeared" }))
    const nonzero = (stderr = "") => Effect.succeed(GitCommandResult.make({ exitCode: 2, stderr, stdout: "" }))

    const failures = yield* Effect.all([
      runScript([commandFailure]),
      runScript([nonzero()]),
      runScript([ok("not-a-sha\n")]),
      runScript([ok(`${candidate}\n`), commandFailure]),
      runScript([ok(`${candidate}\n`), ok("commit\n"), commandFailure]),
      runScript([ok(`${candidate}\n`), ok("commit\n"), nonzero("commit object became unreadable")]),
      runScript([
        ok(`${candidate}\n`),
        ok("commit\n"),
        ok(`tree ${"a".repeat(40)}\nparent malformed-parent\n\nmessage\n`)
      ])
    ])

    expect(failures.map(({ _tag }) => _tag)).toEqual(Array.from({ length: 7 }, () => "IntegratorGitReadFailure"))
    expect(failures[0]).toMatchObject({ detail: "Git process disappeared" })
    expect(failures[1]).toMatchObject({ detail: "git exited 2" })
    expect(failures[2]).toMatchObject({ detail: "git resolved the reported candidate to a malformed object name" })
    expect(failures[6]).toMatchObject({ detail: "git returned a commit with a malformed parent object name" })
  })
)
