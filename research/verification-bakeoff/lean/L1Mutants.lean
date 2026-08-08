/-
  The seeded defects of ../MUTANTS.md, each stated with the theorem the
  faithful version proves. Every one MUST fail. A clean run of this file means
  the theorems in L1.lean are too weak to catch anything.

  `sorry` is deliberately absent: a mutant that needed it would be reporting a
  gap in the proof rather than a defect in the definition.
-/

namespace DeliveryMutants

/-- M1: the off-by-one bound. -/
def selectM1 : Nat → List Nat → List Nat
  | _, [] => []
  | 0, t :: _ => [t]
  | n + 1, t :: ts => t :: selectM1 n ts

theorem selectM1_bounded (n : Nat) (ts : List Nat) : (selectM1 n ts).length ≤ n := by
  induction n generalizing ts with
  | zero => simp [selectM1]
  | succ n ih =>
    cases ts with
    | nil => simp [selectM1]
    | cons t ts => simpa [selectM1] using ih ts

/-- M2: deliveries keep only the current positive selection. -/
def deliveriesM2 (selected _retained : List Nat) : List Nat := selected

theorem retentionM2 (selected retained : List Nat) (t : Nat) (h : t ∈ retained) :
    t ∈ deliveriesM2 selected retained := by
  simp [deliveriesM2, h]

/-- M-order: selection reversed, still claiming it preserves the prefix. -/
def selectReversed (n : Nat) (ts : List Nat) : List Nat :=
  (List.take n ts).reverse

theorem selectReversed_prefix (n : Nat) (ts : List Nat) :
    selectReversed n ts = List.take n ts := by
  simp [selectReversed]

end DeliveryMutants
