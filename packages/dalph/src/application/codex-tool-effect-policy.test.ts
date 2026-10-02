import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { CodexToolEffectPolicy, codexToolEffectLimit } from "./codex-tool-effect-policy.js"

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
  })
})
