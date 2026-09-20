import { Schema } from "effect"
import { expect, it } from "vitest"
import {
  IntegrationTargetRef,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget,
  TaskBranchRef
} from "./git-locator.js"

it.each([
  "main",
  "refs/heads/",
  "refs/heads/a..b",
  "refs/heads/a//b",
  "refs/heads/a.lock",
  "refs/heads/a@{b",
  "refs/heads/.hidden",
  "refs/heads/trailing/",
  "refs/heads/trailing.",
  "refs/heads/space name",
  "refs/heads/caret^name"
])("rejects Git-invalid task branch ref %s", (branch) => {
  expect(() => Schema.decodeUnknownSync(TaskBranchRef)(branch)).toThrow()
  expect(() => Schema.decodeUnknownSync(IntegrationTargetRef)(branch)).toThrow()
})

it("accepts a full Git integration target branch ref", () => {
  expect(Schema.decodeUnknownSync(IntegrationTargetRef)("refs/heads/master")).toBe("refs/heads/master")
})

it.each([
  "https://token@example.invalid/repository.git",
  "https://example.invalid/repository.git?token=secret",
  "user:password@example.invalid:repository.git"
])("rejects credential-bearing remote publication endpoint %s", (endpoint) => {
  expect(() => Schema.decodeUnknownSync(RemotePublicationEndpoint)(endpoint)).toThrow()
})

it("accepts a credential-free SSH endpoint and distinct publication branch", () => {
  const endpoint = Schema.decodeUnknownSync(RemotePublicationEndpoint)("git@example.invalid:repository.git")
  const branch = Schema.decodeUnknownSync(RemotePublicationBranchRef)("refs/heads/master")
  expect(RemotePublicationTarget.make({ branch, endpoint })).toEqual({
    branch: "refs/heads/master",
    endpoint: "git@example.invalid:repository.git"
  })
})

it.each(["main", "refs/tags/v1", "refs/heads/a..b", "refs/heads/a//b", "refs/heads/.hidden"])(
  "rejects non-branch publication ref %s",
  (branch) => {
    expect(() => Schema.decodeUnknownSync(RemotePublicationBranchRef)(branch)).toThrow()
  }
)
