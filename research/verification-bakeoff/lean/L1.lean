/-
  L1 of ../INVARIANTS.md in Lean 4, self-contained: no Mathlib, so `lean L1.lean`
  is the whole build and the only setup cost is elan.

  This is the same specification as ../agda/L1.agda, deliberately. The pair is
  the experiment: two dependently typed languages, one development, and the
  difference that shows up is automation. Where Agda needed a hand-written
  congruence lemma, Lean closes the same goal with `simp` plus a library lemma.
-/

namespace Delivery

/-- Reasons a task is kept out of the delivery frontier. -/
inductive Reason where
  | successfulCompletion
  | terminalWithoutSuccess
  | prerequisitesIncomplete (prerequisiteIds : List Nat)
  deriving Repr

/--
  I3 is discharged by this type, not by a theorem: `excluded` takes a head
  reason and a tail, so an exclusion carrying no reason cannot be written.
  Same move as the Agda encoding, and the same move the production code makes
  with its nonempty standings tuple.
-/
inductive Standing where
  | eligible (taskId : Nat)
  | excluded (taskId : Nat) (first : Reason) (rest : List Reason)

def Standing.taskId : Standing → Nat
  | .eligible t => t
  | .excluded t _ _ => t

def eligibleTasks : List Standing → List Nat
  | [] => []
  | .eligible t :: rest => t :: eligibleTasks rest
  | .excluded _ _ _ :: rest => eligibleTasks rest

/-- The bounded selection: the first `capacity` tasks in graph order. -/
def select : Nat → List Nat → List Nat
  | 0, _ => []
  | _, [] => []
  | n + 1, t :: ts => t :: select n ts

/- ----------------------------------------------------------- I1: the bound -/

theorem select_bounded (n : Nat) (ts : List Nat) : (select n ts).length ≤ n := by
  induction n generalizing ts with
  | zero => simp [select]
  | succ n ih =>
    cases ts with
    | nil => simp [select]
    | cons t ts => simpa [select] using ih ts

/-- The sharper statement: `|Selected| = min(capacity, |Eligible|)`. -/
theorem select_exact (n : Nat) (ts : List Nat) :
    (select n ts).length = min n ts.length := by
  induction n generalizing ts with
  | zero => simp [select]
  | succ n ih =>
    cases ts with
    | nil => simp [select]
    | cons t ts => simp [select, ih ts, Nat.succ_min_succ]

/-- Selection never invents a task. -/
theorem select_sublist (n : Nat) (ts : List Nat) : ∀ t ∈ select n ts, t ∈ ts := by
  induction n generalizing ts with
  | zero => simp [select]
  | succ n ih =>
    cases ts with
    | nil => simp [select]
    | cons t ts =>
      intro x hx
      simp [select] at hx
      rcases hx with rfl | hx
      · exact List.mem_cons_self
      · exact List.mem_cons_of_mem _ (ih ts x hx)

/- ------------------------------------------------------- I4: the retention -/

/-- The ticket-delivery relation: selected now, or retained by exact evidence. -/
def deliveries (selected retained : List Nat) : List Nat := selected ++ retained

theorem retention (selected retained : List Nat) (t : Nat) (h : t ∈ retained) :
    t ∈ deliveries selected retained := by
  simp [deliveries, h]

/--
  The case that matters: the graph no longer places the task at all, which is
  `AbsentFromCurrentGraph` and therefore an empty selection. The delivery
  survives regardless.
-/
theorem retention_when_absent (retained : List Nat) (t : Nat) (h : t ∈ retained) :
    t ∈ deliveries [] retained :=
  retention [] retained t h

/- --------------------------------------------------- I2: order independence -/

/--
  The property Agda could not afford. In Lean it is still real work, but the
  statement is at least short: selecting from a permuted eligible list of the
  same length yields a selection of the same length.

  The full property -- that the *contents* agree once graph order is applied --
  needs a normalization function and is left out for the same reason as in the
  Agda encoding. What is proved here is the length half.
-/
theorem select_length_perm_invariant (n : Nat) (xs ys : List Nat)
    (h : xs.length = ys.length) :
    (select n xs).length = (select n ys).length := by
  rw [select_exact, select_exact, h]

/- ------------------------------------------------------------- the witness -/

/--
  Vacuity check. Every theorem above is universally quantified and would hold
  over empty inputs alone, so a concrete run through the pipeline is part of
  the evidence, not decoration.
-/
example : select 1 (eligibleTasks
    [.eligible 1, .eligible 2, .excluded 3 .successfulCompletion []]) = [1] := by decide

example : 2 ∈ deliveries (select 1 [1, 2]) [2] := by decide

end Delivery
