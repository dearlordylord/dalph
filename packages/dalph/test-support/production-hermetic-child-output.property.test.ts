import { it } from "@effect/vitest"
import { Effect, HashSet, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import fc from "fast-check"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { type ProductionCliRecord } from "../src/application/production-cli.js"
import { hermeticCanonicalRecordDigest } from "../src/application/production-hermetic-provider-bridge.js"
import {
  HermeticChildOutputCanonicalFailure,
  makeHermeticChildOutput,
  QualificationInputRejected,
  validateQualificationRecordBinding
} from "./production-hermetic-child-output.js"

const record: ProductionCliRecord = {
  _tag: "RunSelected",
  runId: RunId.make("controlled-parser-run"),
  selection: "Allocated",
  version: 1
}

it.effect("rejects every added unknown original-frame field without publication or rejected-byte diagnostics", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (suffix, value) => {
        let published = 0
        const unknownKey = `qualification_unknown_${suffix}`
        const frame = JSON.stringify({ ...record, [unknownKey]: value }) + "\n"
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const output = yield* makeHermeticChildOutput(
              {
                stdout: Stream.make(new TextEncoder().encode(frame)),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                kill: () => Effect.void
              },
              () =>
                Effect.sync(() => {
                  published += 1
                })
            )
            return yield* output.read().pipe(Effect.result)
          })
        )
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") {
          expect(result.failure).toBeInstanceOf(HermeticChildOutputCanonicalFailure)
          expect(JSON.stringify(result.failure)).not.toContain(unknownKey)
        }
        expect(published).toBe(0)
      })
    )
  )
)

it.effect("requires this original record's exact registered digest and preserves its source object", () =>
  Effect.gen(function* () {
    expect(yield* validateQualificationRecordBinding(record, HashSet.empty()).pipe(Effect.flip)).toBeInstanceOf(
      QualificationInputRejected
    )
    const original = yield* validateQualificationRecordBinding(
      record,
      HashSet.make(hermeticCanonicalRecordDigest(record))
    )
    expect(original).toBe(record)
    const counterfeit = { ...record, runId: RunId.make("counterfeit-parser-run") }
    expect(
      yield* validateQualificationRecordBinding(counterfeit, HashSet.make(hermeticCanonicalRecordDigest(record))).pipe(
        Effect.flip
      )
    ).toBeInstanceOf(QualificationInputRejected)
  })
)
