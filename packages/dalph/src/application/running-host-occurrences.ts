import { type OccurrencePage } from "./running-host-occurrences-contract.js"
import { TraceCursor, type TraceReaderService } from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { type RunningHostRequest, type RunningHostError, runningHostSuccessEnvelope } from "./running-host-contract.js"

type PageRequest = RunningHostRequest & {
  readonly operation: Extract<RunningHostRequest["operation"], { readonly _tag: "ReadOccurrencePage" }>
}
const lastItemOffset = -1
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength
const sameCursor = Schema.toEquivalence(TraceCursor)

/** Reads only the journal. The budget includes the actual request correlation envelope. */
export const readRunningHostOccurrences = Effect.fn("RunningHost.readOccurrences")(function* (
  request: PageRequest,
  read: TraceReaderService["readOccurrencesAt"]
) {
  const { capacityBytes, continuation, prefix } = request.operation
  if (prefix.runId !== request.runId || (continuation !== null && !sameCursor(prefix, continuation.prefix)))
    return yield* Effect.fail<RunningHostError>({
      _tag: "InvalidRequest",
      fieldPath: "operation.prefix",
      code: "ForeignHistoryPrefix"
    })
  const history = yield* read(prefix).pipe(
    Effect.mapError(
      (error): RunningHostError => ({
        _tag: "ReadFailed",
        causeTag: error._tag,
        detail: "The exact retained historical prefix could not be read."
      })
    )
  )
  const start =
    continuation === null ? 0 : history.items.findIndex((item) => sameCursor(item.identity, continuation.next))
  if (start < 0)
    return yield* Effect.fail<RunningHostError>({
      _tag: "InvalidRequest",
      fieldPath: "operation.continuation",
      code: "OccurrenceContinuationInvalid"
    })
  const items: Array<(typeof history.items)[number]> = []
  const page = (end: number): OccurrencePage => {
    const first = items[0]
    const last = items.at(lastItemOffset)
    return {
      _tag: "OccurrencePage",
      prefix,
      covered: first === undefined || last === undefined ? null : { first: first.identity, last: last.identity },
      items,
      progress:
        history.items[end] === undefined
          ? { _tag: "Complete" }
          : { _tag: "Partial", continuation: { prefix, next: history.items[end].identity } }
    }
  }
  let itemBytes = 0
  for (let end = start; end < history.items.length; end++) {
    const item = history.items[end]
    if (item === undefined) break
    items.push(item)
    const occurrenceBytes = bytes(item)
    itemBytes += occurrenceBytes
    const candidate = page(end + 1)
    // Measure the changing envelope without re-encoding all previously accepted items.
    const requiredResponseBytes =
      bytes(runningHostSuccessEnvelope(request, { ...candidate, items: [] })) + itemBytes + items.length - 1
    if (requiredResponseBytes > capacityBytes) {
      items.pop()
      if (items.length > 0) return runningHostSuccessEnvelope(request, page(end))
      const refusal = runningHostSuccessEnvelope(request, {
        _tag: "OccurrenceTooLarge",
        prefix,
        identity: item.identity,
        capacityBytes,
        occurrenceBytes,
        requiredResponseBytes,
        continuation: { prefix, next: item.identity }
      })
      if (bytes(refusal) > capacityBytes)
        return yield* Effect.fail<RunningHostError>({
          _tag: "FrameTooLarge",
          direction: "Outgoing",
          maximumBytes: capacityBytes,
          measuredBytes: bytes(refusal)
        })
      return refusal
    }
    yield* Effect.yieldNow
  }
  const result = runningHostSuccessEnvelope(request, page(history.items.length))
  if (bytes(result) > capacityBytes)
    return yield* Effect.fail<RunningHostError>({
      _tag: "FrameTooLarge",
      direction: "Outgoing",
      maximumBytes: capacityBytes,
      measuredBytes: bytes(result)
    })
  return result
})
