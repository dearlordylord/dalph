import { Crypto, Effect, Encoding, Result, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import { TrackerTarget } from "../../authorities/task-tracker/target.js"

const AllocatedFreshWorkflowRunId = RunId.pipe(Schema.brand("AllocatedFreshWorkflowRunId"))
export type AllocatedFreshWorkflowRunId = typeof AllocatedFreshWorkflowRunId.Type

const freshWorkflowRunUuidVersion = 7

/** Distinguishes repeated fresh allocations for one exact tracker target. */
const FreshWorkflowRunFreshness = Schema.String.check(Schema.isUUID(freshWorkflowRunUuidVersion)).pipe(
  Schema.brand("FreshWorkflowRunFreshness")
)

/** The structured information only the fresh-run diagnostic decoder interprets. */
const FreshWorkflowRunIdentityPayload = Schema.Struct({ freshness: FreshWorkflowRunFreshness, target: TrackerTarget })
type FreshWorkflowRunIdentityPayload = typeof FreshWorkflowRunIdentityPayload.Type

/** Diagnostic decoding could not restore one exact fresh-run identity payload. */
export class FreshWorkflowRunIdDiagnosticDecodeFailure extends Schema.TaggedErrorClass<FreshWorkflowRunIdDiagnosticDecodeFailure>()(
  "FreshWorkflowRunIdDiagnosticDecodeFailure",
  { detail: Schema.String, runId: RunId }
) {}

const freshWorkflowRunIdEncodingVersion = "r1."

const encodeFreshWorkflowRunId = (payload: FreshWorkflowRunIdentityPayload): AllocatedFreshWorkflowRunId =>
  AllocatedFreshWorkflowRunId.make(
    `${freshWorkflowRunIdEncodingVersion}${Encoding.encodeBase64Url(
      JSON.stringify(Schema.encodeUnknownSync(FreshWorkflowRunIdentityPayload)(payload))
    )}`
  )

/** Restores fresh-run details for explicit diagnostics without making ordinary RunId consumers parse them. */
export const decodeFreshWorkflowRunIdForDiagnostics = Effect.fn("Workflow.decodeFreshRunIdForDiagnostics")(function* (
  runId: RunId
) {
  if (!runId.startsWith(freshWorkflowRunIdEncodingVersion)) {
    return yield* new FreshWorkflowRunIdDiagnosticDecodeFailure({
      detail: "run identity is not owned by the fresh-run codec",
      runId
    })
  }
  const encodedPayload = runId.slice(freshWorkflowRunIdEncodingVersion.length)
  const input = yield* Effect.try({
    try: (): unknown => JSON.parse(Result.getOrThrow(Encoding.decodeBase64UrlString(encodedPayload))),
    catch: (cause) => new FreshWorkflowRunIdDiagnosticDecodeFailure({ detail: String(cause), runId })
  })
  return yield* Schema.decodeUnknownEffect(FreshWorkflowRunIdentityPayload, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError((cause) => new FreshWorkflowRunIdDiagnosticDecodeFailure({ detail: String(cause), runId }))
  )
})

/** Allocates the only identity accepted by Dalph's production fresh-run path. */
export const freshWorkflowRunId = Effect.fn("Workflow.freshRunId")(function* (target: TrackerTarget) {
  const crypto = yield* Crypto.Crypto
  return encodeFreshWorkflowRunId(
    FreshWorkflowRunIdentityPayload.make({
      freshness: FreshWorkflowRunFreshness.make(yield* crypto.randomUUIDv7),
      target
    })
  )
})
