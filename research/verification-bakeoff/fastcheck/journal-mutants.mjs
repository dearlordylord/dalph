/**
 * The nondeterminism negative control for the journal fold (Proposition 4).
 *
 * Kept out of ./journal.mjs deliberately: the determinism property includes
 * a static guard that greps journal.mjs for wall-clock and entropy reads, so
 * a fold variant that commits the defect has to live in its own file. The
 * guard is then run against THIS file as the control that proves it fires.
 *
 * `foldStamped` is the realistic maintenance defect of
 * ../JOURNAL-EVENTS.md: a reconstruction that stamps its result with when
 * the reconstruction happened. Replaying the same journal twice no longer
 * yields the same state, and "idempotent under replay" is gone.
 */
import { fold } from "./journal.mjs"

export const foldStamped = (events) => ({
  ...fold(events),
  reconstructedAt: Date.now() + Math.random()
})
