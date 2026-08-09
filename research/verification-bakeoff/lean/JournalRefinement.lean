import Journal
import L2

/-
  Ticket #200's refinement layer relates the existing L2 transition relation
  to the L1 journal fold. Event output is attached in L2.lean by `Emission`, a
  relation indexed by an existing `L2.Step` proof. `Step.hasEmission` and
  `EmittedStep.erases` prove both directions of conservative extension: adding
  output neither removes nor invents an L2 transition.

  The full historical L2 abstraction intentionally has fewer fields than the
  concrete journal state (no claim token/pending flag or failure attribution),
  so refinement is stated on the fields each accepted scenario observes. The
  claim scenario below uses emissions of the actual `observeGraph` and
  `acquireClaim` L2 transitions; its crash is a prefix inside the latter's
  intent/outcome batch. The contradiction scenario interleaves a structurally
  invalid journal occurrence with task B's actual L2 claim emission, because a
  valid L2 transition cannot itself manufacture contradictory history.
-/

namespace JournalRefinement

open Journal

def observationEvents : List Event :=
  [.trackerFactsObserved [0]
    [{ subject := 0, present := true, isOpen := true }] false 0]

def claimEvents : List Event :=
  [.claimIntentRecorded 0 0,
   .claimRecordRead 0 0 0,
   .claimedTaskEligibilityObserved 0 0]

theorem observation_is_existing_l2_emission :
    L2.Emission (L2.Step.observeGraph L2.init false true true) observationEvents :=
  by simpa [observationEvents, L2.taskNat] using
    (L2.Emission.observeGraph L2.init false true true)

theorem claim_is_existing_l2_emission :
    L2.Emission (L2.Step.acquireClaim L2.s1 false rfl rfl) claimEvents :=
  by simpa [claimEvents, L2.taskNat] using
    (L2.Emission.acquireClaim L2.s1 false rfl rfl)

/-- Erasing these outputs yields exactly the old L2 transitions and states. -/
theorem emission_does_not_change_l2_behavior :
    L2.Step L2.init L2.s1 ∧ L2.Step L2.s1 L2.s2 :=
  ⟨L2.Step.observeGraph L2.init false true true,
   L2.Step.acquireClaim L2.s1 false rfl rfl⟩

def claimIntentPrefix : List Event := observationEvents ++ [.claimIntentRecorded 0 0]
def claimOutcomeSuffix : List Event :=
  [.claimRecordRead 0 0 0, .claimedTaskEligibilityObserved 0 0]

/- Scenario 1: a crash is truncation after the first event of the existing L2
   acquisition emission. The pending obligation survives, and resuming with
   the remaining emitted outcomes equals uninterrupted replay. -/
theorem crash_prefix_retains_claim_intent :
    ((fold [0, 1] claimIntentPrefix).tickets 0).claimPending = true := by
  decide

theorem intent_outcome_resume_refinement :
    fold [0, 1] (claimIntentPrefix ++ claimOutcomeSuffix) =
      foldFrom (fold [0, 1] claimIntentPrefix) claimOutcomeSuffix :=
  fold_homomorphism [0, 1] claimIntentPrefix claimOutcomeSuffix

/-- After the outcome suffix, the fold and the existing L2 successor expose
    the same claimed phase; the fold additionally retains its reconciliation
    fields, which historical L2 does not model. -/
theorem claim_fold_reconstructs_l2_successor :
    ((fold [0, 1] (claimIntentPrefix ++ claimOutcomeSuffix)).tickets 0).phase = .claimed ∧
      (L2.s2.ticket false).phase = L2.Phase.claimed := by
  decide

def taskBObservation : List Event :=
  observationEvents ++
  [.trackerFactsObserved [1]
    [{ subject := 1, present := true, isOpen := true }] false 1,
   .capacityRevised 2]

abbrev bothOpen : L2.St :=
  { L2.s1 with
    ticket := L2.upd L2.s1.ticket true ({ L2.s1.ticket true with present := true, isOpen := true }) }

abbrev bothOpenCapacityTwo : L2.St := { bothOpen with capacity := 2 }

theorem task_b_observation_is_l2_emitted :
    L2.Emission (L2.Step.observeGraph L2.s1 true true true)
        [.trackerFactsObserved [1]
          [{ subject := 1, present := true, isOpen := true }] false 1] ∧
      L2.Emission (L2.Step.changeCapacity bothOpen 2 rfl) [.capacityRevised 2] := by
  constructor
  · simpa [L2.taskNat] using (L2.Emission.observeGraph L2.s1 true true true)
  · exact .changeCapacity bothOpen 2 rfl

def taskBClaimEmission : List Event :=
  [.claimIntentRecorded 1 0,
   .claimRecordRead 1 0 0,
   .claimedTaskEligibilityObserved 1 0]

/-- Task B's progress events have the same constructor batch as the existing
    L2 acquireClaim emission, under the Bool→Nat task mapping in L2.lean. -/
theorem task_b_claim_is_l2_emission (state : L2.St)
    (live : state.crashed = false) (empty : (state.ticket true).phase = .noObligation) :
    L2.Emission (L2.Step.acquireClaim state true live empty) taskBClaimEmission :=
  by simpa [taskBClaimEmission, L2.taskNat] using
    (L2.Emission.acquireClaim state true live empty)

theorem task_a_contradiction_is_l2_history_emitted :
    L2.ContradictionEmission bothOpenCapacityTwo [.deliverySettled 0] := by
  exact .local _ false rfl

def regionalTrace : List Event :=
  taskBObservation ++ [.deliverySettled 0] ++ taskBClaimEmission

theorem regional_trace_uses_one_l2_state :
    L2.ContradictionEmission bothOpenCapacityTwo [.deliverySettled 0] ∧
      L2.Emission
        (L2.Step.acquireClaim bothOpenCapacityTwo true rfl rfl)
        taskBClaimEmission :=
  ⟨task_a_contradiction_is_l2_history_emitted,
   task_b_claim_is_l2_emission bothOpenCapacityTwo rfl rfl⟩

/- Scenario 2: corrupt A history is contained; actual L2-emitted B progress is
   reconstructed; a shared contradiction instead fails the Run. -/
theorem regional_failure_is_contained :
    ((fold [0, 1] regionalTrace).tickets 0).failed ≠ none ∧
    ((fold [0, 1] regionalTrace).tickets 1).phase = .claimed ∧
    (fold [0, 1] regionalTrace).runFailed = none := by
  decide

def sharedContradiction : List Event := [.claimIntentRecorded 99 0]

theorem shared_contradiction_is_l2_history_emitted :
    L2.ContradictionEmission L2.init sharedContradiction := by
  simpa [sharedContradiction] using
    (L2.ContradictionEmission.sharedUnknownTask L2.init 99 (by decide))

theorem shared_failure_fails_run :
    L2.ContradictionEmission L2.init sharedContradiction ∧
      (fold [0, 1] sharedContradiction).runFailed ≠ none := by
  exact ⟨shared_contradiction_is_l2_history_emitted, by decide⟩

end JournalRefinement
