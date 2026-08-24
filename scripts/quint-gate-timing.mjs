import { performance } from "node:perf_hooks"

export const quintCommandKinds = Object.freeze(["typecheck", "test", "sampled-run", "verify"])

const isQuintCommandKind = (kind) => quintCommandKinds.includes(kind)

export const quintCommandKindForArgs = (args) => {
  const [command] = args
  if (command === "typecheck" || command === "test" || command === "verify") return command
  if (command === "run") return "sampled-run"
  throw new Error(`Unknown Quint command: ${command ?? "missing"}`)
}

export const formatQuintGateTimingReport = (timing) => {
  const lines = []
  for (const record of timing.records()) {
    lines.push(
      `Quint command timing: ${record.kind} ${record.name} ${(record.durationMilliseconds / 1000).toFixed(2)}s`
    )
  }
  for (const kind of quintCommandKinds) {
    const aggregate = timing.aggregates()[kind]
    lines.push(
      `Quint phase timing: ${kind} ${aggregate.count} command(s), ${(aggregate.durationMilliseconds / 1000).toFixed(
        2
      )}s`
    )
  }
  return `${lines.join("\n")}\n`
}

/**
 * Keep the formal gate's measured command phases independent from its process
 * runner. Tests can provide a monotonic fake clock and runner while the
 * hosted gate records the same per-command and phase totals.
 */
export const createQuintGateTiming = ({ now = () => performance.now() } = {}) => {
  const records = []

  const measure = async ({ kind, name, run }) => {
    if (!isQuintCommandKind(kind)) throw new Error(`Unknown Quint command kind: ${kind}`)
    const startedAt = now()
    try {
      return await run()
    } finally {
      records.push({ kind, name, durationMilliseconds: now() - startedAt })
    }
  }

  const copyRecords = () => records.map((record) => ({ ...record }))

  const aggregates = () =>
    Object.fromEntries(
      quintCommandKinds.map((kind) => {
        const phaseRecords = records.filter((record) => record.kind === kind)
        return [
          kind,
          {
            count: phaseRecords.length,
            durationMilliseconds: phaseRecords.reduce((total, record) => total + record.durationMilliseconds, 0)
          }
        ]
      })
    )

  return { aggregates, measure, records: copyRecords }
}

export const runWithQuintGateTiming = async ({ timing, run, write = (report) => process.stdout.write(report) }) => {
  let result
  let runSucceeded = false
  let runFailure
  let reportFailure
  try {
    result = await run()
    runSucceeded = true
  } catch (error) {
    runFailure = error
  } finally {
    try {
      write(formatQuintGateTimingReport(timing))
    } catch (error) {
      reportFailure = error
    }
  }
  if (!runSucceeded) throw runFailure
  if (reportFailure !== undefined) throw reportFailure
  return result
}
