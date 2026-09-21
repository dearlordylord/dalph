import { it } from "@effect/vitest"
import {
  GitCommitSha,
  GitRepositoryLocator,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint
} from "@dalph/contracts"
import { Clock, Duration, Effect, Schema } from "effect"
import { describe, expect } from "vitest"
import {
  EndpointMappingUnstable,
  failureReasonForCommand,
  observationFailure,
  operationDeadline,
  pushFailure,
  RemoteOperationDeadline,
  repositoryFromRequest,
  resolvePinnedEndpoint,
  runBounded
} from "./direct-publication-command.js"
import {
  GitCommandInvocationFailure,
  GitCommandInterrupted,
  GitCommandResponseDeadline,
  GitCommandSenderStopUnproven,
  type GitCommandResult,
  type GitCommandService
} from "./command.js"
import {
  RemotePublicationGitRequest,
  RemotePublicationPushFailure,
  RemotePublicationPushResult,
  RemotePublicationRequestId,
  remotePublicationRefspecFor
} from "../../workflow/protocols/direct-publication/events.js"

const target = {
  branch: RemotePublicationBranchRef.make("refs/heads/main"),
  endpoint: RemotePublicationEndpoint.make("https://example.invalid/dalph.git")
}
const repository = GitRepositoryLocator.make("/tmp/dalph-direct-publication.git")
const candidate = GitCommitSha.make("a".repeat(40))
const request = RemotePublicationGitRequest.make({
  candidateCommit: candidate,
  refspec: remotePublicationRefspecFor(candidate, target.branch),
  requestId: RemotePublicationRequestId.make("direct-publication-command-test"),
  target
})
const deadline = RemoteOperationDeadline.make(9_999_999_999_999_999_999n)
const result = (overrides: Partial<GitCommandResult> = {}): GitCommandResult => ({
  exitCode: 0,
  stderr: "",
  stdout: "",
  ...overrides
})
const commandService = (bounded: GitCommandService["runBoundedInRepository"]): GitCommandService => {
  const base = {
    run: () => Effect.fail(new GitCommandInvocationFailure({ detail: "unused" })),
    runInWorktree: () => Effect.fail(new GitCommandInvocationFailure({ detail: "unused" })),
    runBytesInWorktree: () => Effect.fail(new GitCommandInvocationFailure({ detail: "unused" }))
  }
  return bounded === undefined ? base : { ...base, runBoundedInRepository: bounded }
}

describe("remote Git operation deadline", () => {
  it.effect("constructs an absolute deadline from the monotonic clock", () =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.monotonicTimeNanos
      const deadline = yield* operationDeadline(Duration.seconds(30))

      expect(deadline - startedAt).toBe(30_000_000_000n)
    })
  )

  it("accepts only nonnegative monotonic nanosecond positions at the type boundary", () => {
    expect(Schema.decodeUnknownSync(RemoteOperationDeadline)(0n)).toBe(0n)
    expect(() => Schema.decodeUnknownSync(RemoteOperationDeadline)(-1n)).toThrow()
    expect(() => Schema.decodeUnknownSync(RemoteOperationDeadline)(0)).toThrow()
  })
})

describe("direct publication command boundaries", () => {
  it("selects configured or request repositories and rejects invalid requests", () => {
    expect(repositoryFromRequest(request, repository)).toBe(repository)
    expect(repositoryFromRequest(request, undefined)).toBeUndefined()
    expect(
      repositoryFromRequest(
        { ...request, repository } as typeof request & { readonly repository: GitRepositoryLocator },
        undefined
      )
    ).toBe(repository)
    expect(
      repositoryFromRequest(
        { ...request, repository: "not-a-repository" } as typeof request & { readonly repository: unknown },
        undefined
      )
    ).toBe("not-a-repository")
  })

  it("maps bounded command failures to redacted reasons", () => {
    expect(failureReasonForCommand(new GitCommandResponseDeadline(), "TargetUnreadable")).toBe("ResponseDeadline")
    expect(failureReasonForCommand(new GitCommandSenderStopUnproven(), "TargetUnreadable")).toBe("SenderStopUnproven")
    expect(failureReasonForCommand(new GitCommandInterrupted(), "AncestryUnavailable")).toBe("SenderStopUnproven")
    expect(failureReasonForCommand(new GitCommandInvocationFailure({ detail: "x" }), "AncestryUnavailable")).toBe(
      "AncestryUnavailable"
    )
    expect(observationFailure(target, new EndpointMappingUnstable(), "TargetUnreadable").reason).toBe(
      "EndpointMappingChanged"
    )
    expect(pushFailure(target, new GitCommandResponseDeadline()).reason).toBe("ResponseDeadline")
    expect(pushFailure(target, new GitCommandSenderStopUnproven()).reason).toBe("SenderStopUnproven")
    expect(pushFailure(target, new GitCommandInvocationFailure({ detail: "x" })).reason).toBe("TransportUnavailable")
    expect(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target })).toBeInstanceOf(
      RemotePublicationPushFailure
    )
  })

  it("pins an unchanged endpoint and fails closed on unavailable or changing mappings", async () => {
    const noRules = await Effect.runPromise(
      resolvePinnedEndpoint(
        commandService(() => Effect.succeed(result({ exitCode: 1 }))),
        repository,
        target,
        deadline
      )
    )
    expect(noRules).toEqual([
      "-c",
      `url.${target.endpoint}.insteadOf=${target.endpoint}`,
      "-c",
      `url.${target.endpoint}.pushInsteadOf=${target.endpoint}`
    ])
    await expect(
      Effect.runPromise(resolvePinnedEndpoint(commandService(undefined), repository, target, deadline))
    ).rejects.toBeInstanceOf(GitCommandSenderStopUnproven)
    await expect(
      Effect.runPromise(
        resolvePinnedEndpoint(
          commandService(() => Effect.succeed(result({ exitCode: 2 }))),
          repository,
          target,
          deadline
        )
      )
    ).rejects.toBeInstanceOf(EndpointMappingUnstable)
    const selfRule = `url.${target.endpoint}.insteadOf\n${target.endpoint}\u0000`
    const pushRule = `url.other://prefix/.pushInsteadOf\n${target.endpoint}\u0000`
    await expect(
      Effect.runPromise(
        resolvePinnedEndpoint(
          commandService(() => Effect.succeed(result({ stdout: selfRule + pushRule }))),
          repository,
          target,
          deadline
        )
      )
    ).rejects.toBeInstanceOf(EndpointMappingUnstable)
    for (const malformed of [
      "garbage",
      "url.example.invalid.bad\nhttps://example.invalid/dalph.git\u0000",
      "url..insteadOf\nhttps://example.invalid/dalph.git\u0000",
      "url.example.invalid.insteadOf\n\u0000"
    ]) {
      await expect(
        Effect.runPromise(
          resolvePinnedEndpoint(
            commandService(() => Effect.succeed(result({ stdout: malformed }))),
            repository,
            target,
            deadline
          )
        )
      ).rejects.toBeInstanceOf(EndpointMappingUnstable)
    }
    const readRule = `url.${target.endpoint}.insteadOf\n${target.endpoint}\u0000`
    expect(
      await Effect.runPromise(
        resolvePinnedEndpoint(
          commandService(() => Effect.succeed(result({ stdout: readRule }))),
          repository,
          target,
          deadline
        )
      )
    ).toHaveLength(4)
    const pushOnlyRule = `url.${target.endpoint}.pushInsteadOf\n${target.endpoint}\u0000`
    expect(
      await Effect.runPromise(
        resolvePinnedEndpoint(
          commandService(() => Effect.succeed(result({ stdout: pushOnlyRule }))),
          repository,
          target,
          deadline
        )
      )
    ).toHaveLength(4)
  })

  it("runs a bounded command only while its deadline and command member exist", async () => {
    const service = commandService(() => Effect.succeed(result({ stdout: "ok" })))
    await expect(Effect.runPromise(runBounded(service, repository, ["status"], deadline))).resolves.toMatchObject({
      stdout: "ok"
    })
    await expect(
      Effect.runPromise(runBounded(service, repository, ["status"], RemoteOperationDeadline.make(0n)))
    ).rejects.toBeInstanceOf(GitCommandResponseDeadline)
    await expect(
      Effect.runPromise(runBounded(commandService(undefined), repository, ["status"], deadline))
    ).rejects.toBeInstanceOf(GitCommandSenderStopUnproven)
    expect(RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidate })).toMatchObject({ _tag: "Applied" })
  })
})
