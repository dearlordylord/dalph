import { Schema } from "effect"
import { KimiAcpPromptObservation } from "./kimi-acp.js"
import { ProviderResultInstantMilliseconds } from "./provider-result-correction.js"

/** Private intent recorded before ACP; Observed means a matching RPC response was received. */
export const KimiPromptRequestRecord = Schema.Struct({
  ...KimiAcpPromptObservation.fields,
  intendedAt: ProviderResultInstantMilliseconds
})
export type KimiPromptRequestRecord = typeof KimiPromptRequestRecord.Type

/** Session restore cannot manufacture an acknowledgement for any retained request. */
export const KimiPromptRequestHistory = Schema.Array(KimiPromptRequestRecord).check(
  Schema.makeFilter((entries) => {
    if (entries.length === 0) return "prompt history requires an intent"
    const tokens = new Set<string>()
    for (const [index, entry] of entries.entries()) {
      if (tokens.has(entry.token)) return "prompt tokens cannot be reused"
      tokens.add(entry.token)
      const previous = entries[index - 1]
      if (previous !== undefined && entry.intendedAt < previous.intendedAt) return "prompt chronology cannot reverse"
      if (entry.response === "Pending" && index !== entries.length - 1)
        return "an unresolved prompt prevents another request"
    }
    return undefined
  })
)
export type KimiPromptRequestHistory = typeof KimiPromptRequestHistory.Type

/** Both native and memory stores enforce the same retained-prefix law before writing. */
const lastEntryOffset = -1

export const kimiPromptHistoryTransitionProblem = (
  previous: KimiPromptRequestHistory | undefined,
  next: KimiPromptRequestHistory | undefined
): string | undefined => {
  if (previous === undefined)
    return next === undefined || (next.length === 1 && next[0]?.response === "Pending")
      ? undefined
      : "new prompt history starts with one pending intent"
  if (next === undefined || next.length < previous.length) return "prompt history cannot be removed or reset"
  if (next.length > previous.length + 1) return "only one prompt intent may be added"
  for (const [index, before] of previous.entries()) {
    const after = next[index]
    if (after === undefined || after.token !== before.token || after.intendedAt !== before.intendedAt)
      return "retained prompt identity cannot change"
    if (before.response === after.response) continue
    if (
      before.response !== "Pending" ||
      after.response !== "Observed" ||
      index !== previous.length - 1 ||
      next.length !== previous.length
    )
      return "only the latest pending prompt may receive its acknowledgement"
  }
  if (
    next.length > previous.length &&
    (previous.at(lastEntryOffset)?.response !== "Observed" || next.at(lastEntryOffset)?.response !== "Pending")
  )
    return "another prompt requires a settled predecessor and its own pending intent"
  return undefined
}
