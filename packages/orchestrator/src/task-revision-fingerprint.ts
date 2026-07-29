import { Encoding } from "effect"
import { TaskRevision } from "./domain.js"

/** Version prefix for the diagnostically reversible task revision fingerprint encoding. */
const taskRevisionFingerprintEncodingVersion = "tr1."

/** Encodes normalized tracker-task JSON without exposing those bytes as the equality contract. */
export const encodeTaskRevisionFingerprint = (normalizedTaskJson: string): TaskRevision =>
  TaskRevision.make(`${taskRevisionFingerprintEncodingVersion}${Encoding.encodeBase64Url(normalizedTaskJson)}`)
