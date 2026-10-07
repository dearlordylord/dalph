import type { Cause, Effect } from "effect"
import type {
  ActionMap,
  ItfTrace,
  NoTracesError,
  QuintError,
  QuintGenerationOptions,
  QuintNotFoundError,
  StateMismatchError,
  TraceGenerationOptions,
  TraceReplayError
} from "@firfi/quint-connect/effect"
import type { quintIt } from "@firfi/quint-connect/vitest"

/** Corpus validation adds UnknownException; driver and state-check requirements stay generic. */
export declare const corpusReplayFor: (source: string) => {
  readonly quintRun: <S, E, R, Actions extends ActionMap<E, R> = ActionMap<E, R>, StateE = never, StateR = never>(
    options: QuintGenerationOptions<S, E, R, Actions, StateE, StateR>
  ) => Effect.Effect<
    { readonly tracesReplayed: number; readonly seed: string },
    E | Cause.UnknownException | QuintError | QuintNotFoundError | StateMismatchError | TraceReplayError | NoTracesError,
    R | StateR
  >
  readonly quintIt: typeof quintIt
  readonly generateTraces: (options: TraceGenerationOptions) => Effect.Effect<
    ReadonlyArray<ItfTrace>,
    Cause.UnknownException | QuintError | QuintNotFoundError
  >
}
