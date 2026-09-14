import { Cause, Option, Schema } from "effect"

const RuntimeDiagnosticByteCapacity = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticByteCapacity")
)
const RuntimeDiagnosticReasonCapacity = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticReasonCapacity")
)
const RuntimeDiagnosticCauseDepth = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticCauseDepth")
)
const RuntimeDiagnosticFrameCapacity = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticFrameCapacity")
)
const RuntimeDiagnosticCauseCapacity = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticCauseCapacity")
)
const RuntimeDiagnosticTextByteCapacity = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticTextByteCapacity")
)

const diagnosticByteCapacity = 4_096
const diagnosticReasonCapacity = 4
const diagnosticCauseDepth = 4
const diagnosticFrameCapacity = 4
const diagnosticCauseCapacity = 2
const diagnosticTextByteCapacity = 256
export const runtimeDiagnosticByteLimit = RuntimeDiagnosticByteCapacity.make(diagnosticByteCapacity)
export const runtimeDiagnosticReasonLimit = RuntimeDiagnosticReasonCapacity.make(diagnosticReasonCapacity)
export const runtimeDiagnosticCauseDepthLimit = RuntimeDiagnosticCauseDepth.make(diagnosticCauseDepth)
export const runtimeDiagnosticFrameLimit = RuntimeDiagnosticFrameCapacity.make(diagnosticFrameCapacity)
const runtimeDiagnosticCauseLimit = RuntimeDiagnosticCauseCapacity.make(diagnosticCauseCapacity)
const runtimeDiagnosticTextByteLimit = RuntimeDiagnosticTextByteCapacity.make(diagnosticTextByteCapacity)
const fallbackIdentityByteLimit = 96
const fallbackMessageByteLimit = 128
const maximumUtf8CodePointBytes = 4

const RuntimeDiagnosticSource = Schema.Struct({
  _tag: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Unknown),
  code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
  kind: Schema.optionalKey(Schema.String),
  method: Schema.optionalKey(Schema.String),
  module: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  operation: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.Unknown),
  stack: Schema.optionalKey(Schema.String),
  syscall: Schema.optionalKey(Schema.String)
})

const RuntimeDiagnosticLinePosition = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticLinePosition")
)
const RuntimeDiagnosticColumnPosition = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RuntimeDiagnosticColumnPosition")
)
const RuntimeDiagnosticText = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    new TextEncoder().encode(value).byteLength <= runtimeDiagnosticTextByteLimit
      ? undefined
      : `must contain at most ${runtimeDiagnosticTextByteLimit} UTF-8 bytes`
  )
)

export const RuntimeDiagnosticFrame = Schema.Struct({
  column: RuntimeDiagnosticColumnPosition,
  function: RuntimeDiagnosticText,
  line: RuntimeDiagnosticLinePosition,
  module: RuntimeDiagnosticText
})
export type RuntimeDiagnosticFrame = typeof RuntimeDiagnosticFrame.Type

export interface RuntimeDiagnosticError {
  readonly category?: string
  readonly causes?: readonly [RuntimeDiagnosticError, ...Array<RuntimeDiagnosticError>]
  readonly code?: string
  readonly errorTag: string
  readonly frames?: readonly [RuntimeDiagnosticFrame, ...Array<RuntimeDiagnosticFrame>]
  readonly operation?: string
  readonly safeMessage: string
  readonly syscall?: string
}

export const RuntimeDiagnosticError: Schema.Codec<RuntimeDiagnosticError, unknown> = Schema.Struct({
  category: Schema.optionalKey(RuntimeDiagnosticText),
  causes: Schema.optionalKey(
    Schema.NonEmptyArray(
      Schema.suspend((): Schema.Codec<RuntimeDiagnosticError, unknown> => RuntimeDiagnosticError)
    ).check(Schema.isMaxLength(runtimeDiagnosticCauseLimit))
  ),
  code: Schema.optionalKey(RuntimeDiagnosticText),
  errorTag: RuntimeDiagnosticText,
  frames: Schema.optionalKey(
    Schema.NonEmptyArray(RuntimeDiagnosticFrame).check(Schema.isMaxLength(runtimeDiagnosticFrameLimit))
  ),
  operation: Schema.optionalKey(RuntimeDiagnosticText),
  safeMessage: RuntimeDiagnosticText,
  syscall: Schema.optionalKey(RuntimeDiagnosticText)
})

export const RuntimeDiagnosticReason = Schema.TaggedUnion({
  Defect: { error: RuntimeDiagnosticError },
  Failure: { error: RuntimeDiagnosticError },
  Interruption: { error: RuntimeDiagnosticError }
})
export type RuntimeDiagnosticReason = typeof RuntimeDiagnosticReason.Type

/** A process-boundary observation of a terminal Cause; it is diagnostic evidence, never workflow authority. */
export const DalphRuntimeDiagnostic = Schema.TaggedStruct("DalphRuntimeDiagnostic", {
  boundary: Schema.Literal("NodeMainExit"),
  omitted: Schema.Boolean,
  outcome: Schema.Literal("Failed"),
  reasons: Schema.NonEmptyArray(RuntimeDiagnosticReason).check(Schema.isMaxLength(runtimeDiagnosticReasonLimit)),
  version: Schema.Literal(1)
})
export type DalphRuntimeDiagnostic = typeof DalphRuntimeDiagnostic.Type

interface Projection<A> {
  readonly omitted: boolean
  readonly value: A
}

const nonEmpty = <A>(values: ReadonlyArray<A>): readonly [A, ...Array<A>] | undefined => {
  const first = values[0]
  return first === undefined ? undefined : [first, ...values.slice(1)]
}

const redactExactValues = (text: string, sensitiveValues: ReadonlyArray<string>) =>
  Array.from(new Set(sensitiveValues.filter((value) => value.length > 0)))
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, value) => redacted.replaceAll(value, "[REDACTED]"), text)

const boundUtf8 = (text: string, byteLimit: number): Projection<string> => {
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength <= byteLimit) return { omitted: false, value: text }
  const prefixes = Array.from({ length: maximumUtf8CodePointBytes }, (_, removed) => removed).flatMap((removed) => {
    try {
      return [new TextDecoder("utf-8", { fatal: true }).decode(encoded.slice(0, byteLimit - removed))]
    } catch {
      return []
    }
  })
  return { omitted: true, value: prefixes[0] ?? "" }
}

const diagnosticText = (text: string, sensitiveValues: ReadonlyArray<string>) =>
  boundUtf8(redactExactValues(text, sensitiveValues), runtimeDiagnosticTextByteLimit)

const normalizeStackModule = (locator: string) => {
  const withoutScheme = locator.replace(/^file:\/\//, "")
  if (withoutScheme.startsWith("node:")) return withoutScheme
  for (const marker of ["/packages/", "/scripts/", "/node_modules/"]) {
    const index = withoutScheme.lastIndexOf(marker)
    if (index >= 0) return withoutScheme.slice(index + 1)
  }
  return "<external>"
}

const projectFrames = (
  stack: string | undefined,
  sensitiveValues: ReadonlyArray<string>
): Projection<ReadonlyArray<RuntimeDiagnosticFrame>> => {
  if (stack === undefined) return { omitted: false, value: [] }
  const lines = stack.split("\n").slice(1)
  const parsed = lines.flatMap<{ readonly frame?: RuntimeDiagnosticFrame; readonly omitted: boolean }>((line) => {
    const matched = /^\s*at (?:(.*?) \()?(.+):(\d+):(\d+)\)?$/.exec(line)
    if (matched === null) return []
    const [, rawFunction, rawModule, rawLine, rawColumn] = matched
    const linePosition = Option.getOrUndefined(
      Schema.decodeUnknownOption(RuntimeDiagnosticLinePosition)(Number(rawLine))
    )
    const columnPosition = Option.getOrUndefined(
      Schema.decodeUnknownOption(RuntimeDiagnosticColumnPosition)(Number(rawColumn))
    )
    if (linePosition === undefined || columnPosition === undefined) return [{ omitted: true }]
    const projectedFunction = diagnosticText(rawFunction ?? "<anonymous>", sensitiveValues)
    const projectedModule = diagnosticText(normalizeStackModule(rawModule ?? ""), sensitiveValues)
    return [
      {
        frame: {
          column: columnPosition,
          function: projectedFunction.value,
          line: linePosition,
          module: projectedModule.value
        },
        omitted: projectedFunction.omitted || projectedModule.omitted
      }
    ]
  })
  return {
    omitted: parsed.length > runtimeDiagnosticFrameLimit || parsed.some(({ omitted }) => omitted),
    value: parsed.flatMap(({ frame }) => (frame === undefined ? [] : [frame])).slice(0, runtimeDiagnosticFrameLimit)
  }
}

const diagnosticSource = (value: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(RuntimeDiagnosticSource)(value))

const sourceTag = (value: unknown, source: typeof RuntimeDiagnosticSource.Type | undefined) => {
  if (source?._tag !== undefined && source._tag.length > 0) return source._tag
  if (source?.name !== undefined && source.name.length > 0) return source.name
  if (value instanceof Error && value.name.length > 0) return value.name
  if (value === null) return "Null"
  if (Array.isArray(value)) return "Array"
  const primitive = typeof value
  return primitive === "object" ? "UnknownObject" : primitive
}

const sourceOperation = (source: typeof RuntimeDiagnosticSource.Type | undefined) => {
  if (source?.operation !== undefined && source.operation.length > 0) return source.operation
  if (source?.module !== undefined && source.method !== undefined) return `${source.module}.${source.method}`
  if (source?.syscall !== undefined && source.syscall.length > 0) return source.syscall
  return undefined
}

const sourceSafeMessage = (
  tag: string,
  operation: string | undefined,
  source: typeof RuntimeDiagnosticSource.Type | undefined
) => {
  if (source?.code !== undefined) return `${operation ?? tag} failed with ${String(source.code)}`
  return `${operation ?? tag} failed`
}

const projectError = (
  value: unknown,
  sensitiveValues: ReadonlyArray<string>,
  depth: number,
  ancestors: ReadonlyArray<unknown>
): Projection<RuntimeDiagnosticError> => {
  const source = diagnosticSource(value)
  const tag = diagnosticText(sourceTag(value, source), sensitiveValues)
  const rawOperation = sourceOperation(source)
  const operation = rawOperation === undefined ? undefined : diagnosticText(rawOperation, sensitiveValues)
  const category = source?.kind === undefined ? undefined : diagnosticText(source.kind, sensitiveValues)
  const code = source?.code === undefined ? undefined : diagnosticText(String(source.code), sensitiveValues)
  const syscall = source?.syscall === undefined ? undefined : diagnosticText(source.syscall, sensitiveValues)
  const message = diagnosticText(sourceSafeMessage(tag.value, operation?.value, source), sensitiveValues)
  const frames = projectFrames(value instanceof Error ? value.stack : source?.stack, sensitiveValues)
  const nested =
    source === undefined
      ? value instanceof Error && value.cause !== undefined
        ? [value.cause]
        : []
      : [source.reason, source.cause ?? (value instanceof Error ? value.cause : undefined)].filter(
          (item) => item !== undefined
        )
  const repeated = typeof value === "object" && value !== null && ancestors.includes(value)
  const atDepthLimit = depth >= runtimeDiagnosticCauseDepthLimit
  const children =
    repeated || atDepthLimit
      ? []
      : nested.map((item) => projectError(item, sensitiveValues, depth + 1, [...ancestors, value]))
  const projectedChildren = nonEmpty(children.map(({ value: child }) => child))
  const projectedFrames = nonEmpty(frames.value)
  return {
    omitted:
      tag.omitted ||
      (category?.omitted ?? false) ||
      (code?.omitted ?? false) ||
      (operation?.omitted ?? false) ||
      (syscall?.omitted ?? false) ||
      message.omitted ||
      frames.omitted ||
      repeated ||
      (atDepthLimit && nested.length > 0) ||
      children.some(({ omitted }) => omitted),
    value: {
      ...(category === undefined ? {} : { category: category.value }),
      ...(projectedChildren === undefined ? {} : { causes: projectedChildren }),
      ...(code === undefined ? {} : { code: code.value }),
      errorTag: tag.value,
      ...(projectedFrames === undefined ? {} : { frames: projectedFrames }),
      ...(operation === undefined ? {} : { operation: operation.value }),
      safeMessage: message.value,
      ...(syscall === undefined ? {} : { syscall: syscall.value })
    }
  }
}

/** Projects only named diagnostic fields; arbitrary messages, details, stacks and provider payloads are never copied. */
export const projectRuntimeCause = <E>(
  cause: Cause.Cause<E>,
  sensitiveValues: ReadonlyArray<string>
): DalphRuntimeDiagnostic => {
  const retained = cause.reasons
    .slice(0, runtimeDiagnosticReasonLimit)
    .map((reason): Projection<RuntimeDiagnosticReason> => {
      if (Cause.isFailReason(reason)) {
        const projected = projectError(reason.error, sensitiveValues, 0, [])
        return { omitted: projected.omitted, value: { _tag: "Failure", error: projected.value } }
      }
      if (Cause.isDieReason(reason)) {
        const projected = projectError(reason.defect, sensitiveValues, 0, [])
        return { omitted: projected.omitted, value: { _tag: "Defect", error: projected.value } }
      }
      const projected = projectError(reason, sensitiveValues, 0, [])
      return { omitted: projected.omitted, value: { _tag: "Interruption", error: projected.value } }
    })
  const first = retained[0] ?? {
    omitted: true,
    value: {
      _tag: "Defect" as const,
      error: { errorTag: "EmptyCause", safeMessage: "Unexpected runtime defect (EmptyCause)" }
    }
  }
  return {
    _tag: "DalphRuntimeDiagnostic",
    boundary: "NodeMainExit",
    omitted: cause.reasons.length > retained.length || retained.some(({ omitted }) => omitted),
    outcome: "Failed",
    reasons: [first.value, ...retained.slice(1).map(({ value }) => value)],
    version: 1
  }
}

const enforceCauseDepth = (error: RuntimeDiagnosticError, depth = 0): Projection<RuntimeDiagnosticError> => {
  const { causes: originalCauses, ...withoutCauses } = error
  const atDepthLimit = depth >= runtimeDiagnosticCauseDepthLimit
  const children = atDepthLimit ? [] : (originalCauses ?? []).map((cause) => enforceCauseDepth(cause, depth + 1))
  const causes = nonEmpty(children.map(({ value }) => value))
  return {
    omitted: (atDepthLimit && originalCauses !== undefined) || children.some(({ omitted }) => omitted),
    value: { ...withoutCauses, ...(causes === undefined ? {} : { causes }) }
  }
}

const shallowError = (error: RuntimeDiagnosticError): RuntimeDiagnosticError => ({
  ...(error.category === undefined ? {} : { category: boundUtf8(error.category, fallbackIdentityByteLimit).value }),
  ...(error.code === undefined ? {} : { code: boundUtf8(error.code, fallbackIdentityByteLimit).value }),
  errorTag: boundUtf8(error.errorTag, fallbackIdentityByteLimit).value,
  ...(error.operation === undefined ? {} : { operation: boundUtf8(error.operation, fallbackIdentityByteLimit).value }),
  safeMessage: boundUtf8(error.safeMessage, fallbackMessageByteLimit).value,
  ...(error.syscall === undefined ? {} : { syscall: boundUtf8(error.syscall, fallbackIdentityByteLimit).value })
})

const encodedLine = (diagnostic: DalphRuntimeDiagnostic) => `${JSON.stringify(diagnostic)}\n`

const fitsDiagnosticBoundary = (line: string) => new TextEncoder().encode(line).byteLength <= runtimeDiagnosticByteLimit

/** Encodes one valid UTF-8 JSON line inside the exact stderr diagnostic byte limit. */
export const encodeRuntimeDiagnostic = (diagnostic: DalphRuntimeDiagnostic): string => {
  const validated = Schema.decodeUnknownSync(DalphRuntimeDiagnostic)(diagnostic, {
    onExcessProperty: "error",
    reportInput: false
  })
  const projectReason = (reason: RuntimeDiagnosticReason) => ({ ...reason, error: enforceCauseDepth(reason.error) })
  const firstProjectedReason = projectReason(validated.reasons[0])
  const remainingProjectedReasons = validated.reasons.slice(1).map(projectReason)
  const projectedReasons = [firstProjectedReason, ...remainingProjectedReasons]
  const depthBounded: DalphRuntimeDiagnostic = {
    ...validated,
    omitted: validated.omitted || projectedReasons.some(({ error }) => error.omitted),
    reasons: [
      { ...firstProjectedReason, error: firstProjectedReason.error.value },
      ...projectedReasons.slice(1).map((reason) => ({ ...reason, error: reason.error.value }))
    ]
  }
  const ordinary = encodedLine(depthBounded)
  if (fitsDiagnosticBoundary(ordinary)) return ordinary
  const firstReason = depthBounded.reasons[0]
  const bounded: DalphRuntimeDiagnostic = {
    ...validated,
    omitted: true,
    reasons: [{ ...firstReason, error: shallowError(firstReason.error) }]
  }
  const fallback = encodedLine(bounded)
  if (fitsDiagnosticBoundary(fallback)) return fallback
  return encodedLine({
    ...validated,
    omitted: true,
    reasons: [
      {
        _tag: firstReason._tag,
        error: {
          errorTag: "RuntimeDiagnosticOverflow",
          safeMessage: "Runtime diagnostic exceeded its safe output boundary"
        }
      }
    ]
  })
}
