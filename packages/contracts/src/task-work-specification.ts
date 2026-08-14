import { Encoding, Schema } from "effect"
import { TaskId, TaskRevision } from "./task-identity.js"

const taskRevisionFingerprintEncodingVersion = "tr1."

/** Encodes normalized tracker-task JSON without exposing those bytes as the equality contract. */
export const encodeTaskRevisionFingerprint = (normalizedTaskJson: string): TaskRevision =>
  TaskRevision.make(`${taskRevisionFingerprintEncodingVersion}${Encoding.encodeBase64Url(normalizedTaskJson)}`)

/** Exact normalized tracker-authored instructions for one task. */
export const TaskWorkSpecification = Schema.Struct({
  body: Schema.String,
  fingerprint: TaskRevision,
  taskId: TaskId,
  title: Schema.NonEmptyString
}).check(
  Schema.makeFilter((specification) =>
    specification.fingerprint ===
    encodeTaskRevisionFingerprint(JSON.stringify({ body: specification.body, title: specification.title }))
      ? undefined
      : "task-work specification fingerprint must cover the exact normalized title and body"
  )
)
export type TaskWorkSpecification = typeof TaskWorkSpecification.Type

export const makeTaskWorkSpecification = (input: {
  readonly body: string
  readonly taskId: TaskId
  readonly title: string
}): TaskWorkSpecification => {
  const fingerprint = encodeTaskRevisionFingerprint(JSON.stringify({ body: input.body, title: input.title }))
  return TaskWorkSpecification.make({ ...input, fingerprint })
}
