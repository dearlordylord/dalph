/* eslint-disable no-magic-numbers -- JSON/UTF-8 code point widths and declared logical allocation charges. */
import { Effect } from "effect"
import type { RunningHostError } from "./running-host-contract.js"

/** Logical allocation admission charges, independent of V8 heap/RSS layout.
 * Shared delivery/inspection inputs are borrowed; no clone is made by this walk. */
export const observerRetentionLimits = {
  preparationBytes: 16 * 1024 * 1024,
  presentationBytes: 8 * 1024 * 1024,
  depth: 64
} as const

const refusal = (boundary: "Preparation" | "Presentation", maximumBytes: number): RunningHostError => ({
  _tag: "ObserverRetentionExceeded",
  boundary,
  maximumBytes
})

/** Visit without Object.entries, JSON.stringify, or a width-sized scratch array.
 * Repeated references are charged each time; ancestors bound cycle/depth work. */
export const observerStructuralBytes = (
  value: unknown,
  maximumBytes: number,
  boundary: "Preparation" | "Presentation"
): Effect.Effect<number, RunningHostError> =>
  Effect.suspend(() => {
    let bytes = 0
    const ancestors = new Set<object>()
    const charge = (amount: number) => {
      bytes += amount
      return bytes <= maximumBytes
    }
    const visit = (input: unknown, depth: number): boolean => {
      if (!charge(64) || depth > observerRetentionLimits.depth) return false
      if (typeof input === "string") return charge(2 * input.length)
      if (typeof input !== "object" || input === null) return true
      if (ancestors.has(input)) return false
      ancestors.add(input)
      if (input instanceof Map) {
        for (const [key, entry] of input) if (!visit(key, depth + 1) || !visit(entry, depth + 1)) return false
      } else if (input instanceof Set) {
        for (const entry of input) if (!visit(entry, depth + 1)) return false
      } else {
        for (const key in input) {
          if (!Object.hasOwn(input, key)) continue
          if (!charge(64 + 2 * key.length) || !visit(Reflect.get(input, key), depth + 1)) return false
        }
      }
      ancestors.delete(input)
      return true
    }
    return visit(value, 0) ? Effect.succeed(bytes) : Effect.fail(refusal(boundary, maximumBytes))
  })

/** Exact UTF-8 JSON charge for plain public wire values. Stop at the first byte
 * beyond capacity, including inside a single oversized string, before encoding.
 * A refusal reports the observed lower bound, not the unvisited full size. */
export const observerJsonBytes = (value: unknown, maximumBytes: number): Effect.Effect<number, RunningHostError> =>
  Effect.suspend(() => {
    let bytes = 0
    const add = (amount: number) => {
      bytes += amount
      return bytes <= maximumBytes
    }
    const string = (text: string): boolean => {
      if (!add(2)) return false
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index)
        let size = 1
        if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13)
          size = 2
        else if (code < 32) size = 6
        else if (code < 128) size = 1
        else if (code < 2048) size = 2
        else if (code >= 0xd800 && code <= 0xdbff) {
          const next = text.charCodeAt(index + 1)
          if (next >= 0xdc00 && next <= 0xdfff) {
            size = 4
            index += 1
          } else size = 6
        } else if (code >= 0xdc00 && code <= 0xdfff) size = 6
        else size = 3
        if (!add(size)) return false
      }
      return true
    }
    const visit = (input: unknown): boolean => {
      if (typeof input === "string") return string(input)
      if (input === null) return add(4)
      if (typeof input === "boolean") return add(input ? 4 : 5)
      if (typeof input === "number") return add(JSON.stringify(input).length)
      if (Array.isArray(input)) {
        if (!add(2)) return false
        for (let index = 0; index < input.length; index += 1) {
          if (index > 0 && !add(1)) return false
          if (!visit(input[index] ?? null)) return false
        }
        return true
      }
      if (typeof input === "object") {
        if (!add(2)) return false
        let first = true
        for (const key in input) {
          if (!Object.hasOwn(input, key)) continue
          const entry: unknown = Reflect.get(input, key)
          if (entry === undefined) continue
          if ((!first && !add(1)) || !string(key) || !add(1) || !visit(entry)) return false
          first = false
        }
        return true
      }
      return true // Schema validation, after bounded admission, rejects non-wire values.
    }
    return visit(value)
      ? Effect.succeed(bytes)
      : Effect.fail<RunningHostError>({
          _tag: "FrameTooLarge",
          direction: "Outgoing",
          maximumBytes,
          measuredBytes: bytes
        })
  })
