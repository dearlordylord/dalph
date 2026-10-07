/* eslint-disable import/no-nodejs-modules -- Controls construct actual gzip bytes and integrity envelopes at the Node SQLite boundary. */
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { it } from "@effect/vitest"
import * as fc from "fast-check"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { decodeJournalGzipPayload, encodeJournalGzipPayload } from "./gzip-payload.js"

const ObjectPayload = Schema.Record(Schema.String, Schema.Json)
const parse = (text: string) => Schema.decodeUnknownSync(Schema.fromJsonString(ObjectPayload))(text)
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const envelopeFor = (bytes: Buffer) => ({
  _tag: "DalphJournalGzipPayloadV1",
  codec: "gzip",
  data: gzipSync(bytes).toString("base64"),
  decodedByteLength: bytes.length,
  sha256: digest(bytes)
})
const source = JSON.stringify({ text: "Привет 🌲 \u0000".repeat(500) })

it("round-trips generated JSON payloads through plain or gzip without increasing stored bytes", async () => {
  await fc.assert(
    fc.asyncProperty(fc.jsonValue({ maxDepth: 5 }), async (value) => {
      const payload = { value, repeated: "x".repeat(2000) }
      const original = JSON.stringify(payload)
      const stored = encodeJournalGzipPayload(original)
      expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(Buffer.byteLength(original))
      const decoded = await Effect.runPromise(decodeJournalGzipPayload(parse(stored)))
      // The codec receives JSON text; stringify has already normalized signed zero.
      expect(decoded).toEqual(JSON.parse(original))
      expect(encodeJournalGzipPayload(JSON.stringify(decoded))).toBe(stored)
    }),
    { examples: [[-0], [{ "": -0 }]], numRuns: 100 }
  )
})

it.effect("keeps small and oversized payloads plain while gzip restores Unicode and NUL exactly", () =>
  Effect.gen(function* () {
    for (const text of ["{}", JSON.stringify({ text: "x".repeat(1024 * 1024) })]) {
      expect(encodeJournalGzipPayload(text)).toBe(text)
      expect(yield* decodeJournalGzipPayload(parse(text))).toEqual(JSON.parse(text))
    }
    const stored = encodeJournalGzipPayload(source)
    expect(parse(stored)["_tag"]).toBe("DalphJournalGzipPayloadV1")
    expect(yield* decodeJournalGzipPayload(parse(stored))).toEqual(JSON.parse(source))
  })
)

it.effect("rejects truncated gzip, noncanonical Base64, wrong digest or size, and foreign envelope fields", () =>
  Effect.gen(function* () {
    const valid = envelopeFor(Buffer.from(source))
    for (const payload of [
      { ...valid, data: valid.data.slice(0, 8) },
      { ...valid, data: valid.data + "\n" },
      { ...valid, sha256: "0".repeat(64) },
      { ...valid, decodedByteLength: 1 },
      { ...valid, decodedByteLength: valid.decodedByteLength + 1 },
      { ...valid, decodedByteLength: 1024 * 1024 + 1 },
      { ...valid, codec: "unknown" },
      { ...valid, data: "x".repeat(2 * 1024 * 1024) },
      { ...valid, unexpected: "extra" }
    ]) {
      expect((yield* decodeJournalGzipPayload(parse(JSON.stringify(payload))).pipe(Effect.result))._tag).toBe("Failure")
    }
  })
)

it.effect("rejects expanding streams and invalid UTF-8 even with a matching digest", () =>
  Effect.gen(function* () {
    const expanding = envelopeFor(Buffer.alloc(2 * 1024 * 1024, 120))
    expect(
      (yield* decodeJournalGzipPayload(parse(JSON.stringify({ ...expanding, decodedByteLength: 1024 * 1024 }))).pipe(
        Effect.result
      ))._tag
    ).toBe("Failure")
    const invalidUtf8 = envelopeFor(Buffer.from([0xff, 0xfe]))
    expect((yield* decodeJournalGzipPayload(parse(JSON.stringify(invalidUtf8))).pipe(Effect.result))._tag).toBe(
      "Failure"
    )
  })
)
