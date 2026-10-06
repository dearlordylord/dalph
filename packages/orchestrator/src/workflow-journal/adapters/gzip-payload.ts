/* eslint-disable import/no-nodejs-modules -- SQLite storage uses Node zlib and crypto; the semantic event codec stays platform-independent. */
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { gzipSync, gunzip } from "node:zlib"
import { Effect, Schema } from "effect"

const kibibyte = 1024
/** Compression eligibility only: larger existing events stay plain and are not rejected. */
const maximumDecodedBytes = kibibyte * kibibyte
const base64InputGroupBytes = 3
const base64OutputGroupCharacters = 4
const maximumBase64Characters =
  Math.ceil((maximumDecodedBytes + kibibyte) / base64InputGroupBytes) * base64OutputGroupCharacters
const gzipLevel = 6
const gunzipAsync = promisify(gunzip)
const Payload = Schema.Record(Schema.String, Schema.Json)
/** Exact byte count before gzip, bounded independently of the untrusted compressed stream. */
const DecodedByteLength = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(maximumDecodedBytes)
).pipe(Schema.brand("JournalGzipDecodedByteLength"))
const Sha256 = Schema.String.check(Schema.makeFilter((value) => /^[0-9a-f]{64}$/u.test(value)))
const GzipPayload = Schema.TaggedStruct("DalphJournalGzipPayloadV1", {
  codec: Schema.Literal("gzip"),
  data: Schema.String.check(Schema.isMaxLength(maximumBase64Characters)),
  decodedByteLength: DecodedByteLength,
  sha256: Sha256
})

/** Compressed storage failure remains evidence; the caller attaches the row's kind and semantic version. */
export class JournalGzipDecodeIssue extends Schema.TaggedError<JournalGzipDecodeIssue>()("JournalGzipDecodeIssue", {
  detail: Schema.String
}) {}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

/** Independent gzip is used only if the complete storage envelope is smaller than the exact source bytes. */
export const encodeJournalGzipPayload = (payloadJson: string): string => {
  const bytes = Buffer.from(payloadJson, "utf8")
  if (bytes.length < kibibyte || bytes.length > maximumDecodedBytes) return payloadJson
  const compressed = gzipSync(bytes, { level: gzipLevel })
  const envelope = JSON.stringify(
    GzipPayload.make({
      codec: "gzip",
      data: compressed.toString("base64"),
      decodedByteLength: DecodedByteLength.make(bytes.length),
      sha256: digest(bytes)
    })
  )
  return Buffer.byteLength(envelope, "utf8") < bytes.length ? envelope : payloadJson
}

/** Plain and compact rows remain explicit inputs; a malformed gzip envelope is never reinterpreted as plain. */
export const decodeJournalGzipPayload = Effect.fn("WorkflowJournal.decodeGzipPayload")(function* (
  payload: Schema.JsonObject
) {
  if (payload["_tag"] !== "DalphJournalGzipPayloadV1") return payload
  const envelope = yield* Schema.decodeUnknownEffect(GzipPayload)(payload, { onExcessProperty: "error" })
  const compressed = Buffer.from(envelope.data, "base64")
  if (compressed.toString("base64") !== envelope.data) {
    return yield* new JournalGzipDecodeIssue({ detail: "gzip payload Base64 is not canonical" })
  }
  const decoded = yield* Effect.tryPromise({
    try: () => gunzipAsync(compressed, { maxOutputLength: envelope.decodedByteLength }),
    catch: (cause) => new JournalGzipDecodeIssue({ detail: String(cause) })
  })
  if (decoded.length !== envelope.decodedByteLength || digest(decoded) !== envelope.sha256) {
    return yield* new JournalGzipDecodeIssue({ detail: "gzip decoded length or SHA-256 differs from its envelope" })
  }
  const json = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(decoded),
    catch: (cause) => new JournalGzipDecodeIssue({ detail: String(cause) })
  })
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Payload))(json)
})
