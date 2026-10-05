import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  bindCodexToolEffectPolicy,
  CodexToolEffectPolicy,
  codexToolEffectLimit,
  PlannedCodexWorktree
} from "./codex-tool-effect-policy.js"

const policy = Schema.decodeUnknownSync(CodexToolEffectPolicy)({
  longCommands: [
    {
      command: "pnpm check:all --candidate=0123456789abcdef0123456789abcdef01234567",
      cwd: "/repo/task",
      limitMilliseconds: 3_900_000
    }
  ]
})

describe("Codex tool-effect allowance", () => {
  it("matches the observed native shell command and rejects raw input, foreign cwd and opaque items", () => {
    const admitted = bindCodexToolEffectPolicy(
      Schema.decodeUnknownSync(CodexToolEffectPolicy)({
        defaultLimitMilliseconds: 1_000,
        longCommands: [
          { command: "/bin/bash -lc 'sleep 3'", cwd: { _tag: "PlannedWorktree" }, limitMilliseconds: 8_000 }
        ]
      }),
      "/repo/task"
    )
    expect(
      codexToolEffectLimit(admitted, {
        kind: "commandExecution",
        command: "/bin/bash -lc 'sleep 3'",
        cwd: "/repo/task"
      })
    ).toBe(8_000)
    expect(codexToolEffectLimit(admitted, { kind: "commandExecution", command: "sleep 3", cwd: "/repo/task" })).toBe(
      1_000
    )
    expect(
      codexToolEffectLimit(admitted, {
        kind: "commandExecution",
        command: "/bin/bash -lc 'sleep 3'",
        cwd: "/repo/other"
      })
    ).toBe(1_000)
    expect(
      codexToolEffectLimit(admitted, { kind: "dynamicToolCall", command: "/bin/bash -lc 'sleep 3'", cwd: "/repo/task" })
    ).toBe(1_000)
  })
  it("binds a declared long check to the owned worktree before turn start", () => {
    const configured = Schema.decodeUnknownSync(CodexToolEffectPolicy)({
      longCommands: [
        {
          command: "pnpm check:lab",
          cwd: PlannedCodexWorktree.make({ _tag: "PlannedWorktree" }),
          limitMilliseconds: 420_000
        }
      ]
    })
    const admitted = bindCodexToolEffectPolicy(configured, "/repo/generated-task")
    expect(admitted.longCommands[0]?.cwd).toBe("/repo/generated-task")
    expect(
      codexToolEffectLimit(admitted, {
        kind: "commandExecution",
        command: "pnpm check:lab",
        cwd: "/repo/generated-task"
      })
    ).toBe(420_000)
    expect(
      codexToolEffectLimit(admitted, { kind: "commandExecution", command: "pnpm check:lab", cwd: "/repo/other-task" })
    ).toBe(60_000)
    expect(
      codexToolEffectLimit(admitted, {
        kind: "commandExecution",
        command: "pnpm check:lab && echo done",
        cwd: "/repo/generated-task"
      })
    ).toBe(60_000)
  })

  it("gives the exact configured quiet command a longer allowance", () => {
    expect(
      codexToolEffectLimit(policy, {
        kind: "commandExecution",
        command: "pnpm check:all --candidate=0123456789abcdef0123456789abcdef01234567",
        cwd: "/repo/task"
      })
    ).toBe(3_900_000)
  })

  it("does not give a wrapper, lookalike, or unknown tool the long allowance", () => {
    expect(
      codexToolEffectLimit(policy, {
        kind: "commandExecution",
        command: "sh -c 'pnpm check:all --candidate=0123456789abcdef0123456789abcdef01234567'",
        cwd: "/repo/task"
      })
    ).toBe(60_000)
    expect(
      codexToolEffectLimit(policy, {
        kind: "commandExecution",
        command: "pnpm check:all --candidate=0123456789abcdef0123456789abcdef01234567 && echo done",
        cwd: "/repo/task"
      })
    ).toBe(60_000)
    expect(
      codexToolEffectLimit(policy, {
        kind: "dynamicToolCall",
        command: "pnpm check:all --candidate=0123456789abcdef0123456789abcdef01234567",
        cwd: "/repo/task"
      })
    ).toBe(60_000)
  })

  it("allows a configured opaque tool past the old one-minute boundary", () => {
    const configured = Schema.decodeUnknownSync(CodexToolEffectPolicy)({
      defaultLimitMilliseconds: 420_000,
      longCommands: [{ command: "pnpm check:submit", cwd: "/repo/task", limitMilliseconds: 600_000 }]
    })
    const admitted = bindCodexToolEffectPolicy(configured, "/repo/task")
    expect(codexToolEffectLimit(admitted, { kind: "dynamicToolCall" })).toBe(420_000)
    expect(
      codexToolEffectLimit(admitted, { kind: "commandExecution", command: "pnpm check:submit", cwd: "/repo/task" })
    ).toBe(600_000)
    expect(
      codexToolEffectLimit(admitted, { kind: "commandExecution", command: "pnpm check:submit", cwd: "/other" })
    ).toBe(420_000)
  })

  it("rejects duplicate and unbounded configuration", () => {
    expect(() =>
      Schema.decodeUnknownSync(CodexToolEffectPolicy)({
        longCommands: [
          { command: "pnpm check:fast", cwd: "/repo/task", limitMilliseconds: 120_000 },
          { command: "pnpm check:fast", cwd: "/repo/task", limitMilliseconds: 180_000 }
        ]
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CodexToolEffectPolicy)({ defaultLimitMilliseconds: Number.POSITIVE_INFINITY })
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(CodexToolEffectPolicy)({ defaultLimitMilliseconds: 0 })).toThrow()
    expect(() => Schema.decodeUnknownSync(CodexToolEffectPolicy)({ defaultLimitMilliseconds: 600_001 })).toThrow()
  })
})
