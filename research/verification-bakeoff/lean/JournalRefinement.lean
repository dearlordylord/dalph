import Journal

/-
  Ticket #200's refinement layer. This makes event emission part of the L2
  transition rather than comparing two separately authored final states.

  `EmittingState.modeled` is the state the L2 transition exposes immediately;
  `journal` is the durable output it emits. `Refines` says that replaying that
  output through the concrete L1 fold reconstructs the exposed state. An L2
  step is permitted only through `emit`, which appends exactly one canonical
  Event and applies the same concrete transition once. Thus adding emission
  cannot silently change L2 behavior, and the induction below covers every
  one of the 23 Event constructors without a second event mapping.
-/

namespace JournalRefinement

open Journal

structure EmittingState where
  tasks : List Nat
  modeled : State
  journal : List Event

def initial (tasks : List Nat) : EmittingState :=
  { tasks, modeled := initialState tasks, journal := [] }

/-- One L2 action/occurrence emits the exact L1 event it applies. -/
def emit (state : EmittingState) (event : Event) : EmittingState :=
  { state with
    modeled := step true state.modeled event
    journal := state.journal ++ [event] }

def Refines (state : EmittingState) : Prop :=
  state.modeled = fold state.tasks state.journal

theorem initial_refines (tasks : List Nat) : Refines (initial tasks) := rfl

/-- The one-step refinement obligation. This theorem quantifies over Event,
    so Lean's exhaustiveness check on Journal.step is the 23-case coverage. -/
theorem emit_preserves_refinement (state : EmittingState) (event : Event)
    (refines : Refines state) : Refines (emit state event) := by
  change step true state.modeled event = fold state.tasks (state.journal ++ [event])
  rw [fold_homomorphism]
  simp only [foldFrom, List.foldl_cons, List.foldl_nil]
  rw [refines]

def emitAll : EmittingState → List Event → EmittingState
  | state, [] => state
  | state, event :: rest => emitAll (emit state event) rest

theorem emitAll_refines (state : EmittingState) (events : List Event)
    (refines : Refines state) : Refines (emitAll state events) := by
  induction events generalizing state with
  | nil => exact refines
  | cons event rest ih => exact ih (emit state event) (emit_preserves_refinement state event refines)

/- Scenario 1: the crash is the end of `claimPrefix`; no crash event is
   fabricated. The pending intent survives that prefix, and appending the
   tracker reread has exactly the same result as resuming its fold. -/
def observedOpen : Event :=
  .trackerFactsObserved [0, 1]
    [{ subject := 0, present := true, isOpen := true },
     { subject := 1, present := true, isOpen := true }]
    true 1

def claimPrefix : List Event :=
  [observedOpen, .claimIntentRecorded 0 11]

def claimOutcome : List Event :=
  [.claimRecordRead 0 7 11]

theorem crash_prefix_retains_claim_intent :
    ((fold [0, 1] claimPrefix).tickets 0).claimPending = true := by
  decide

theorem intent_outcome_resume_refinement :
    fold [0, 1] (claimPrefix ++ claimOutcome) =
      foldFrom (fold [0, 1] claimPrefix) claimOutcome :=
  fold_homomorphism [0, 1] claimPrefix claimOutcome

/- Scenario 2: A's invalid settle is a task-local contradiction. B's later
   claim still progresses and the Run stays live. Naming an unknown task is a
   shared contradiction and fails the Run instead. -/
def regionalTrace : List Event :=
  [observedOpen,
   .capacityRevised 2,
   .deliverySettled 0,
   .claimIntentRecorded 1 12]

theorem regional_failure_is_contained :
    ((fold [0, 1] regionalTrace).tickets 0).failed ≠ none ∧
    ((fold [0, 1] regionalTrace).tickets 1).phase = .claimed ∧
    (fold [0, 1] regionalTrace).runFailed = none := by
  decide

def sharedContradiction : List Event :=
  [.claimIntentRecorded 99 1]

theorem shared_failure_fails_run :
    (fold [0, 1] sharedContradiction).runFailed ≠ none := by
  decide

end JournalRefinement
