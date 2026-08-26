/**
 * Run independent formal-gate commands in a small, fixed family. The caller
 * supplies the command identity and receives an AbortSignal so a failed child
 * can stop its siblings before another command is admitted.
 */
export const quintGateFamilyConcurrency = 2

const batchResults = Symbol("quintGateBatchResults")

const asError = (failure) => (failure instanceof Error ? failure : new Error(String(failure)))

const attachBatchResults = (failure, results) => {
  const error = asError(failure)
  Object.defineProperty(error, batchResults, { value: results })
  return error
}

/**
 * Return the ordered outcomes captured when a bounded family fails. Entries
 * after the first failure are absent because fail-fast admission never starts
 * them; already running siblings have either a fulfilled or rejected entry.
 */
export const quintGateBatchResults = (failure) => (failure instanceof Error ? failure[batchResults] : undefined)

/**
 * Execute a fixed family with bounded concurrency. Results retain input order,
 * while completion order cannot change which command identity the caller
 * reports. The first failure aborts the shared signal and prevents new work.
 */
export const runQuintGateFamily = async ({ commands, concurrency = quintGateFamilyConcurrency, run }) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Quint gate family concurrency must be a positive integer; received ${concurrency}`)
  }
  if (commands.length === 0) return []

  const controller = new AbortController()
  const outcomes = new Array(commands.length)
  let nextIndex = 0
  const failureState = { error: undefined, occurred: false }

  const recordFailure = (error) => {
    if (failureState.occurred) return
    failureState.occurred = true
    failureState.error = error
    controller.abort(error)
  }

  const worker = async () => {
    while (!failureState.occurred) {
      const index = nextIndex
      nextIndex += 1
      if (index >= commands.length) return
      const command = commands[index]

      try {
        outcomes[index] = { status: "fulfilled", value: await run(command, controller.signal) }
      } catch (error) {
        outcomes[index] = { status: "rejected", reason: error }
        recordFailure(error)
        return
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, commands.length) }, () => worker()))

  if (failureState.occurred) throw attachBatchResults(failureState.error, outcomes)
  return outcomes.map((outcome) => outcome.value)
}
