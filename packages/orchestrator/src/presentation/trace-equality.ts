/** Compares schema values without inventing a second domain-specific equality rule. */
export const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
