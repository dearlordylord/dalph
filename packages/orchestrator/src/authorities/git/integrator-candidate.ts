import { GitCommitSha } from "@dalph/contracts"
import { Effect, Layer, Schema } from "effect"
import {
  IntegratorGit,
  IntegratorGitObservation,
  IntegratorGitReadFailure,
  type IntegratorCandidateText
} from "../../workflow/protocols/integrator/protocol.js"
import { GitCommand, type GitCommandResult } from "./command.js"

const missingObject = (result: GitCommandResult): boolean =>
  result.exitCode !== 0 &&
  /(?:unknown revision|needed a single revision|not a valid object name|could not get object info|bad object)/iu.test(
    result.stderr
  )

const directParentNames = (commit: string): ReadonlyArray<string> => {
  const headers = commit.split("\n")
  const headerEnd = headers.indexOf("")
  return headers
    .slice(0, headerEnd < 0 ? undefined : headerEnd)
    .flatMap((line) => (line.startsWith("parent ") ? [line.slice("parent ".length)] : []))
}

const readFailure = (
  target: Parameters<IntegratorGit["Service"]["readCandidate"]>[0],
  candidateText: IntegratorCandidateText,
  result: GitCommandResult
): IntegratorGitReadFailure =>
  new IntegratorGitReadFailure({
    candidateText,
    detail: result.stderr.trim() || `git exited ${result.exitCode}`,
    target
  })

/** Read-only Git proof for exactly the candidate text reported by the outer Integrator. */
export const nodeGitIntegratorCandidateLayer = Layer.effect(
  IntegratorGit,
  Effect.gen(function* () {
    const commands = yield* GitCommand
    return IntegratorGit.of({
      readCandidate: Effect.fn("IntegratorGit.Node.readCandidate")(function* (target, candidateText) {
        const resolved = yield* commands
          .run(target.repository, ["rev-parse", "--verify", "--end-of-options", `${candidateText}^{object}`])
          .pipe(
            Effect.mapError(
              (failure) => new IntegratorGitReadFailure({ candidateText, detail: failure.detail, target })
            )
          )
        if (missingObject(resolved)) return IntegratorGitObservation.cases.Missing.make({ candidateText })
        if (resolved.exitCode !== 0) return yield* readFailure(target, candidateText, resolved)
        const commit = yield* Schema.decodeUnknownEffect(GitCommitSha)(resolved.stdout.trim()).pipe(
          Effect.mapError(
            () =>
              new IntegratorGitReadFailure({
                candidateText,
                detail: "git resolved the reported candidate to a malformed object name",
                target
              })
          )
        )
        const type = yield* commands
          .run(target.repository, ["cat-file", "-t", commit])
          .pipe(
            Effect.mapError(
              (failure) => new IntegratorGitReadFailure({ candidateText, detail: failure.detail, target })
            )
          )
        if (type.exitCode !== 0) return yield* readFailure(target, candidateText, type)
        const objectType = type.stdout.trim()
        if (objectType !== "commit") {
          return IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType })
        }
        const object = yield* commands
          .run(target.repository, ["cat-file", "-p", commit])
          .pipe(
            Effect.mapError(
              (failure) => new IntegratorGitReadFailure({ candidateText, detail: failure.detail, target })
            )
          )
        if (object.exitCode !== 0) return yield* readFailure(target, candidateText, object)
        const directParents = yield* Schema.decodeUnknownEffect(Schema.Array(GitCommitSha))(
          directParentNames(object.stdout)
        ).pipe(
          Effect.mapError(
            () =>
              new IntegratorGitReadFailure({
                candidateText,
                detail: "git returned a commit with a malformed parent object name",
                target
              })
          )
        )
        return IntegratorGitObservation.cases.Commit.make({ candidateText, commit, directParents })
      })
    })
  })
)
