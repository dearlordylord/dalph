import Journal
import L2

/-
  Ticket #200's refinement layer relates actual L2 emissions to the L1 journal
  state reconstructed by folding them. `StateRefines` is the explicit
  projection relation: it compares every L2 field represented by the journal
  model and deliberately omits journal-only pending/failure evidence and L2's
  process-crash marker.

  `EmissionProgress` makes the accepted crash chronology realizable. The claim
  intent is a prefix of one actual acquire-claim emission; the L2 transition is
  still in flight at that prefix, and reaches its successor only after the
  tracker-read/outcome suffix is appended.
-/

namespace JournalRefinement

open Journal

def journalPhase : L2.Phase → Journal.Phase
  | .noObligation => .noObligation
  | .claimed => .claimed
  | .planned => .planned
  | .executing => .executing
  | .suspensionRequested => .suspensionRequested
  | .suspended => .suspended
  | .accepted => .accepted
  | .integrating => .integrating
  | .promoted => .promoted
  | .settled => .settled

/-- The shared fields for one task. Journal-only correlation, pending-intent,
    retention, and contradiction evidence are additional reconstruction data,
    not fields the historical L2 state can claim to equal. -/
def TaskRefines (l2 : L2.St) (journal : Journal.State) (task : L2.TaskId) : Bool :=
  let source := l2.ticket task
  let reconstructed := journal.tickets (L2.taskNat task)
  reconstructed.phase == journalPhase source.phase &&
    reconstructed.attempts == source.attempts &&
    reconstructed.present == source.present &&
    reconstructed.isOpen == source.isOpen &&
    reconstructed.expectedHead == source.expectedHead &&
    decide (L2.taskNat task ∈ journal.positions) == l2.holds task

/-- The explicit L2→L1 projection used by the refinement theorems. Bool is the
    complete historical L2 task universe, so both conjuncts cover every task. -/
def StateRefines (l2 : L2.St) (journal : Journal.State) : Bool :=
  TaskRefines l2 journal false &&
    TaskRefines l2 journal true &&
    journal.capacity == l2.capacity &&
    journal.paused == l2.paused &&
    journal.targetResource == (match l2.target with
      | none => []
      | some task => [L2.taskNat task]) &&
    journal.targetHead == l2.head

def observationEvents : List Event :=
  [.trackerFactsObserved [0]
    [{ subject := 0, present := true, isOpen := true }] false 0]

def claimEvents : List Event :=
  [.claimIntentRecorded 0 0,
   .claimRecordRead 0 0 0,
   .claimedTaskEligibilityObserved 0 0]

def claimIntentEvent : List Event := [.claimIntentRecorded 0 0]
def claimOutcomeSuffix : List Event :=
  [.claimRecordRead 0 0 0, .claimedTaskEligibilityObserved 0 0]

def claimSource : Journal.State := fold [0, 1] observationEvents
def claimAfterIntent : Journal.State := foldFrom claimSource claimIntentEvent
def claimAfterOutcome : Journal.State := foldFrom claimAfterIntent claimOutcomeSuffix

theorem observation_is_existing_l2_emission :
    L2.Emission (L2.Step.observeGraph L2.init false true true) observationEvents :=
  by simpa [observationEvents, L2.taskNat] using
    (L2.Emission.observeGraph L2.init false true true)

theorem claim_is_existing_l2_emission :
    L2.Emission (L2.Step.acquireClaim L2.s1 false rfl rfl) claimEvents :=
  by simpa [claimEvents, L2.taskNat] using
    (L2.Emission.acquireClaim L2.s1 false rfl rfl)

/-- The retained intent is not an invented trace: it is exactly the first
    output of the existing acquire-claim transition, whose remaining outputs
    are the tracker reread and eligibility observation. -/
theorem claim_intent_is_realizable_emission_prefix :
    L2.EmissionProgress L2.s1 L2.s2 claimIntentEvent claimOutcomeSuffix := by
  refine ⟨L2.Step.acquireClaim L2.s1 false rfl rfl, ?_⟩
  simpa [claimIntentEvent, claimOutcomeSuffix, claimEvents] using claim_is_existing_l2_emission

theorem claim_source_refines_l2_source : StateRefines L2.s1 claimSource = true := by
  decide

theorem crash_prefix_retains_claim_intent :
    (claimAfterIntent.tickets 0).claimPending = true := by
  decide

/-- Folding the complete output of the actual emitted transition reconstructs
    the L2 successor under the explicit projection relation. -/
theorem claim_emission_fold_refines_l2_successor :
    L2.EmittedStep L2.s1 L2.s2 claimEvents ∧
      StateRefines L2.s2 (foldFrom claimSource claimEvents) = true := by
  constructor
  · exact ⟨L2.Step.acquireClaim L2.s1 false rfl rfl, claim_is_existing_l2_emission⟩
  · decide

/-- Scenario 1: after a crash at the realizable intent prefix, folding the
    retained prefix and then the observed outcome is exactly uninterrupted
    replay and reconstructs the actual L2 successor. -/
theorem intent_crash_outcome_refinement :
    L2.EmissionProgress L2.s1 L2.s2 claimIntentEvent claimOutcomeSuffix ∧
      StateRefines L2.s1 claimSource = true ∧
      (claimAfterIntent.tickets 0).claimPending = true ∧
      foldFrom claimSource claimEvents = claimAfterOutcome ∧
      StateRefines L2.s2 claimAfterOutcome = true := by
  refine ⟨claim_intent_is_realizable_emission_prefix,
    claim_source_refines_l2_source, crash_prefix_retains_claim_intent, ?_, ?_⟩
  · change List.foldl (step true) claimSource claimEvents =
      List.foldl (step true) (List.foldl (step true) claimSource claimIntentEvent)
        claimOutcomeSuffix
    rw [show claimEvents = claimIntentEvent ++ claimOutcomeSuffix by rfl]
    exact List.foldl_append
  · decide

def taskBObservation : List Event :=
  observationEvents ++
  [.trackerFactsObserved [1]
    [{ subject := 1, present := true, isOpen := true }] false 1,
   .capacityRevised 2]

abbrev bothOpen : L2.St :=
  { L2.s1 with
    ticket := L2.upd L2.s1.ticket true
      ({ L2.s1.ticket true with present := true, isOpen := true }) }

abbrev bothOpenCapacityTwo : L2.St := { bothOpen with capacity := 2 }

def taskBClaimEmission : List Event :=
  [.claimIntentRecorded 1 0,
   .claimRecordRead 1 0 0,
   .claimedTaskEligibilityObserved 1 0]

abbrev taskBClaimed : L2.St :=
  { bothOpenCapacityTwo with
    ticket := L2.upd bothOpenCapacityTwo.ticket true
      ({ bothOpenCapacityTwo.ticket true with phase := .claimed }) }

def regionalTrace : List Event :=
  taskBObservation ++ [.deliverySettled 0] ++ taskBClaimEmission

theorem regional_source_refines_one_l2_state :
    StateRefines bothOpenCapacityTwo (fold [0, 1] taskBObservation) = true := by
  decide

theorem task_a_contradiction_is_l2_history_emitted :
    L2.ContradictionEmission bothOpenCapacityTwo [.deliverySettled 0] := by
  exact .local _ false rfl

theorem task_b_claim_is_l2_emitted :
    L2.EmittedStep bothOpenCapacityTwo taskBClaimed taskBClaimEmission := by
  exact ⟨L2.Step.acquireClaim bothOpenCapacityTwo true rfl rfl,
    L2.Emission.acquireClaim bothOpenCapacityTwo true rfl rfl⟩

/-- Scenario 2: the contradictory A occurrence and B's successful lifecycle
    output start from one related L2/journal state. Folding them retains the
    same modeled successor, adds failure only to A, and leaves the Run live. -/
theorem regional_failure_refines_emitted_b_successor :
    L2.ContradictionEmission bothOpenCapacityTwo [.deliverySettled 0] ∧
      L2.EmittedStep bothOpenCapacityTwo taskBClaimed taskBClaimEmission ∧
      StateRefines taskBClaimed (fold [0, 1] regionalTrace) = true ∧
      ((fold [0, 1] regionalTrace).tickets 0).failed ≠ none ∧
      ((fold [0, 1] regionalTrace).tickets 1).failed = none ∧
      (fold [0, 1] regionalTrace).runFailed = none := by
  exact ⟨task_a_contradiction_is_l2_history_emitted,
    task_b_claim_is_l2_emitted, by decide, by decide, by decide, by decide⟩

def sharedContradiction : List Event := [.claimIntentRecorded 99 0]

/-- A shared contradiction is likewise tied to its explicit L2 history-input
    relation; unlike the local case, folding it fails the Run. -/
theorem shared_failure_refinement :
    StateRefines L2.init (initialState [0, 1]) = true ∧
      L2.ContradictionEmission L2.init sharedContradiction ∧
      (fold [0, 1] sharedContradiction).runFailed ≠ none := by
  exact ⟨by decide,
    L2.ContradictionEmission.sharedUnknownTask L2.init 99 (by decide), by decide⟩

end JournalRefinement
