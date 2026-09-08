const witnessLine = /^(\w+) was witnessed in (\d+) trace\(s\) out of \d+ explored/gm

/** Read the exact witness identities attached to one Quint command. */
export const quintWitnessesFromCommandArgs = (args) => {
  const positions = args.flatMap((arg, position) => (arg === "--witnesses" ? [position] : []))
  if (positions.length === 0) return []
  if (positions.length > 1) throw new Error("Quint sampled command has duplicate --witnesses options")

  const start = positions[0] + 1
  const endOffset = args.slice(start).findIndex((arg) => arg.startsWith("--"))
  const end = endOffset < 0 ? args.length : start + endOffset
  return args.slice(start, end)
}

/** Fail a sampled model gate when a declared witness is absent or reaches no trace. */
export const assertRequiredWitnessesObserved = (output, requiredWitnesses) => {
  const observed = new Map(Array.from(output.matchAll(witnessLine), (match) => [match[1], Number(match[2])]))
  const absent = requiredWitnesses.filter((witness) => !observed.has(witness))
  const unreachable = requiredWitnesses.filter((witness) => observed.get(witness) === 0)
  if (absent.length === 0 && unreachable.length === 0) return observed

  const failures = [
    ...(absent.length === 0 ? [] : [`missing witness output: ${absent.join(", ")}`]),
    ...(unreachable.length === 0 ? [] : [`unreachable witnesses: ${unreachable.join(", ")}`])
  ]
  throw new Error(`Quint sampled witness coverage failed: ${failures.join("; ")}`)
}

/** Fail one named sampled command when its declared reachability evidence is incomplete. */
export const assertQuintSampledCommandWitnessesObserved = ({ args, name, output }) => {
  const requiredWitnesses = quintWitnessesFromCommandArgs(args)
  if (requiredWitnesses.length === 0) throw new Error(`${name}: no declared --witnesses`)
  try {
    return assertRequiredWitnessesObserved(output, requiredWitnesses)
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.replace(/^Quint sampled witness coverage failed: /, "") : String(error)
    throw new Error(`${name}: ${detail}`, { cause: error })
  }
}
