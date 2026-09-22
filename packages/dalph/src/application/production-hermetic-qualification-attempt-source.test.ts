import { Cause, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  HermeticQualificationSourceRejected,
  sourceRejected,
  sourceRejectedBecause,
  sourceRejectedAt
} from "./production-hermetic-qualification-attempt-source.js"
import { encodeRuntimeDiagnostic, projectRuntimeCause } from "./runtime-diagnostic.js"

describe("hermetic qualification source diagnostics", () => {
  it("preserves a closed rejection code while adding the operation and projecting safe diagnostics", () => {
    const rejected = sourceRejectedAt("ObservePlannedAttemptExecutorWork")(
      sourceRejectedBecause("PlannedAttemptMismatch")()
    )
    const diagnostic = JSON.parse(encodeRuntimeDiagnostic(projectRuntimeCause(Cause.die(rejected), [])))
    expect(diagnostic.reasons[0].error).toMatchObject({
      code: "PlannedAttemptMismatch",
      safeMessage: "ObservePlannedAttemptExecutorWork failed with PlannedAttemptMismatch"
    })
    expect(() =>
      Schema.decodeUnknownSync(HermeticQualificationSourceRejected)({
        _tag: "HermeticQualificationSourceRejected",
        code: "private-provider-data"
      })
    ).toThrow()
  })

  it("rejects diagnostic tags outside the closed qualification domain", () => {
    expect(() =>
      Schema.decodeUnknownSync(HermeticQualificationSourceRejected)({
        _tag: "HermeticQualificationSourceRejected",
        operation: "private-provider-operation",
        transitionTag: "private-provider-operation"
      })
    ).toThrow()
    expect(sourceRejectedAt("private-provider-operation")(sourceRejected())).toEqual(sourceRejected())
  })

  it("projects a declared operation through the runtime diagnostic encoder", () => {
    const rejected = sourceRejectedAt("IntegratorCandidateCleanupObservationIntended")(sourceRejected())
    const diagnostic = JSON.parse(encodeRuntimeDiagnostic(projectRuntimeCause(Cause.die(rejected), [])))

    expect(rejected).toMatchObject({
      operation: "IntegratorCandidateCleanupObservationIntended",
      transitionTag: "IntegratorCandidateCleanupObservationIntended"
    })
    expect(diagnostic.reasons[0].error).toMatchObject({
      errorTag: "HermeticQualificationSourceRejected",
      operation: "IntegratorCandidateCleanupObservationIntended",
      safeMessage: "IntegratorCandidateCleanupObservationIntended failed"
    })
  })
})
