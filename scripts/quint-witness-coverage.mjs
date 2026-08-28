const witnessLine = /^(\w+) was witnessed in (\d+) trace\(s\) out of \d+ explored/gm

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
