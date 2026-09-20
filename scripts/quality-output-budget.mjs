/** Presentation policy is recorded separately from command success and exact output counts. */
export const outputPresentationPolicy = "retained-logs-bounded-console-v1"

export const addSuccessfulOutputLines = ({ currentOutputLines, stageName, stageOutputLines }) => {
  const nextOutputLines = currentOutputLines + stageOutputLines
  if (
    ![currentOutputLines, stageOutputLines, nextOutputLines].every((count) => Number.isSafeInteger(count) && count >= 0)
  )
    throw new Error(`Invalid output count for '${stageName}'`)
  return nextOutputLines
}

/** Bound forwarded child output only when the caller retains the complete log. */
export const createConsoleOutputPresenter = ({
  logPath,
  maximumBytes = 64 * 1024,
  maximumLines = 550,
  name,
  report = (text) => process.stderr.write(text),
  tailBytes = 8 * 1024
}) => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("Invalid maximum output bytes")
  if (!Number.isSafeInteger(maximumLines) || maximumLines < 0) throw new Error("Invalid maximum output lines")
  if (!Number.isSafeInteger(tailBytes) || tailBytes < 0) throw new Error("Invalid output tail bytes")
  let lines = 0
  let bytes = 0
  let truncated = false
  let tail = Buffer.alloc(0)
  return {
    write(output, destination) {
      tail = tailBytes === 0 ? Buffer.alloc(0) : Buffer.concat([tail, output]).subarray(-tailBytes)
      let visible = 0
      while (visible < output.length && lines < maximumLines && bytes < maximumBytes) {
        if (output[visible] === 10) lines += 1
        visible += 1
        bytes += 1
      }
      if (visible > 0) destination.write(output.subarray(0, visible))
      if (visible === output.length) return
      if (truncated) return
      truncated = true
    },
    finish({ failed, logAvailable = true, logFailure } = {}) {
      if (!truncated) return
      if (logAvailable) report(`\n${name}: console output truncated; complete log: ${logPath}\n`)
      else {
        const detail = logFailure === undefined ? "retained log is unavailable" : `retained log failed: ${logFailure}`
        report(`\n${name}: console output truncated; complete log unavailable (${detail})\n`)
      }
      if (failed) {
        report(`\n${name}: failed; final retained output (up to ${tailBytes} bytes):\n`)
        report(tail.toString("utf8"))
        report(
          logAvailable
            ? `\nComplete log: ${logPath}\n`
            : `\nComplete log unavailable${logFailure === undefined ? "" : `: ${logFailure}`}\n`
        )
      }
    }
  }
}

/** Present captured failure output once without allowing it to bypass the console budget. */
export const presentCapturedFailureOutput = ({
  logPath,
  logAvailable = logPath !== undefined,
  logFailure,
  name,
  output,
  report = (text) => process.stderr.write(text),
  ...limits
}) => {
  if (typeof output !== "string" || output.length === 0) return
  const presenter = createConsoleOutputPresenter({ logPath: logPath ?? "retained log", name, report, ...limits })
  presenter.write(Buffer.from(output), { write: (bytes) => report(bytes.toString("utf8")) })
  presenter.finish({ failed: true, logAvailable, logFailure })
}
