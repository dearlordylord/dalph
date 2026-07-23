import { Encoding } from "effect"
import { TaskRevision } from "./domain.js"

/** Version prefix for the diagnostically reversible task revision fingerprint encoding. */
const taskRevisionFingerprintEncodingVersion = "tr1."

/** Encodes normalized tracker-task JSON without exposing those bytes as the equality contract. */
export const encodeTaskRevisionFingerprint = (normalizedTaskJson: string): TaskRevision =>
  TaskRevision.make(
    `${taskRevisionFingerprintEncodingVersion}${Encoding.encodeBase64Url(normalizedTaskJson)}`
  )

/** Upcasts the raw normalized JSON used by journal events before event version 4. */
export const upcastLegacyTaskRevisionFingerprint = (value: unknown): unknown => {
  if (typeof value !== "string" || !value.startsWith("{")) return value
  try {
    const candidate: unknown = JSON.parse(value)
    if (candidate === null || Array.isArray(candidate) || typeof candidate !== "object") return value
    return encodeTaskRevisionFingerprint(value)
  } catch {
    return value
  }
}
