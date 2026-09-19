import { Option, Schema } from "effect"

const cassetteParameter = "cassette"
const stepParameter = "step"

const PositiveStepFromString = Schema.FiniteFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1)
)

/** URL-owned Lab presentation state. `stepIndex` is zero-based inside the application. */
export interface CassetteLabUrlSelection {
  readonly cassetteKey: string | null
  readonly invalid: boolean
  readonly stepIndex: number | null
}

const decodedStepIndex = (value: string): number | null => {
  const decoded = Schema.decodeUnknownOption(PositiveStepFromString)(value)
  return Option.isSome(decoded) ? decoded.value - 1 : null
}

/** Decodes only the two query keys owned by the Reducer Lab selection surface. */
export const decodeCassetteLabUrlSelection = (url: URL): CassetteLabUrlSelection => {
  const cassetteValues = url.searchParams.getAll(cassetteParameter)
  const stepValues = url.searchParams.getAll(stepParameter)
  const cassetteValue = cassetteValues.length === 1 && cassetteValues[0]?.length !== 0
    ? cassetteValues[0] ?? null
    : null
  const stepIndex = stepValues.length === 1 ? decodedStepIndex(stepValues[0] ?? "") : null
  const invalidCassette = cassetteValues.length > 1 || cassetteValues.length === 1 && cassetteValue === null
  const invalidStep = stepValues.length > 1
    || stepValues.length === 1 && stepIndex === null
    || stepValues.length === 1 && cassetteValue === null
  return {
    cassetteKey: cassetteValue,
    invalid: invalidCassette || invalidStep,
    stepIndex: invalidStep ? null : stepIndex
  }
}

/** Replaces the Lab-owned keys while preserving pathname, hash, and every unowned query key. */
export const encodeCassetteLabUrlSelection = (
  current: URL,
  selection: Pick<CassetteLabUrlSelection, "cassetteKey" | "stepIndex">
): URL => {
  const next = new URL(current.href)
  next.searchParams.delete(cassetteParameter)
  next.searchParams.delete(stepParameter)
  if (selection.cassetteKey !== null) {
    next.searchParams.set(cassetteParameter, selection.cassetteKey)
    if (selection.stepIndex !== null) next.searchParams.set(stepParameter, String(selection.stepIndex + 1))
  }
  return next
}

/** Browser navigation seam; tests provide a controlled implementation. */
export interface CassetteLabUrlAdapter {
  readonly read: () => URL
  readonly replace: (url: URL) => void
  readonly subscribe: (listener: () => void) => () => void
}

export const browserCassetteLabUrlAdapter = (): CassetteLabUrlAdapter => {
  let nonBrowserUrl = new URL("http://localhost/")
  return {
    read: () => typeof globalThis.location === "undefined" ? nonBrowserUrl : new URL(globalThis.location.href),
    replace: (url) => {
      if (typeof globalThis.history === "undefined") {
        nonBrowserUrl = url
        return
      }
      globalThis.history.replaceState(globalThis.history.state, "", url)
    },
    subscribe: (listener) => {
      if (typeof globalThis.addEventListener !== "function") return () => undefined
      globalThis.addEventListener("popstate", listener)
      return () => globalThis.removeEventListener("popstate", listener)
    }
  }
}
