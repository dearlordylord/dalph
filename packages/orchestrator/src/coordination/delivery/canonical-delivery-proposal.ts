/** Recursively orders object keys so structural proposal identities do not depend on construction order. */
export const canonicalDeliveryProposal = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalDeliveryProposal)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalDeliveryProposal(entry)])
    )
  }
  return value
}
