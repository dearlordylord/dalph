-- L1 of ../INVARIANTS.md in Agda, self-contained: no standard library, so the
-- only setup cost is `agda`.
--
-- The point of this encoding is the contrast between two ways to hold an
-- invariant. I3 is discharged by the *type* of Standing and costs no proof.
-- I1 and I4 are discharged by *theorems* and cost real proof work.
{-# OPTIONS --safe #-}
module L1 where

-- ---------------------------------------------------------------- prelude

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat
{-# BUILTIN NATURAL Nat #-}

data Bool : Set where
  true false : Bool

data _==_ {A : Set} (x : A) : A -> Set where
  refl : x == x
infix 4 _==_

cong : forall {A B : Set} (f : A -> B) {x y : A} -> x == y -> f x == f y
cong _ refl = refl

data _<=_ : Nat -> Nat -> Set where
  z<=n : forall {n} -> zero <= n
  s<=s : forall {m n} -> m <= n -> suc m <= suc n
infix 4 _<=_

data List (A : Set) : Set where
  []  : List A
  _::_ : A -> List A -> List A
infixr 5 _::_

length : forall {A} -> List A -> Nat
length []        = 0
length (_ :: xs) = suc (length xs)

_++_ : forall {A} -> List A -> List A -> List A
[]        ++ ys = ys
(x :: xs) ++ ys = x :: (xs ++ ys)
infixr 5 _++_

min : Nat -> Nat -> Nat
min zero    _       = zero
min _       zero    = zero
min (suc m) (suc n) = suc (min m n)

data _∈_ {A : Set} (x : A) : List A -> Set where
  here  : forall {xs}   -> x ∈ (x :: xs)
  there : forall {y xs} -> x ∈ xs -> x ∈ (y :: xs)
infix 4 _∈_

-- ------------------------------------------------------------------ domain

Task : Set
Task = Nat

data Reason : Set where
  successfulCompletion   : Reason
  terminalWithoutSuccess : Reason
  prerequisitesIncomplete : List Task -> Reason

-- A nonempty list of reasons. I3 says an excluded task always carries at least
-- one graph-owned reason; here that is a constructor argument, so an Excluded
-- standing with zero reasons cannot be written down at all.
record Reasons : Set where
  constructor _:|_
  field
    first : Reason
    rest  : List Reason

data Standing : Set where
  Eligible : Task -> Standing
  Excluded : Task -> Reasons -> Standing

-- I3 is not proved below. It is the totality of this function together with
-- the shape of Standing: every task lands in exactly one constructor, and the
-- Excluded one cannot exist without a reason.
taskOf : Standing -> Task
taskOf (Eligible t)   = t
taskOf (Excluded t _) = t

eligibleTasks : List Standing -> List Task
eligibleTasks []                  = []
eligibleTasks (Eligible t :: ss)  = t :: eligibleTasks ss
eligibleTasks (Excluded _ _ :: ss) = eligibleTasks ss

-- The bounded selection: the first `capacity` tasks in graph order.
select : Nat -> List Task -> List Task
select zero    _         = []
select _       []        = []
select (suc n) (t :: ts) = t :: select n ts

-- ----------------------------------------------------------- I1: the bound

-- |Selected| <= capacity.
select-bounded : forall (n : Nat) (ts : List Task) -> length (select n ts) <= n
select-bounded zero    _         = z<=n
select-bounded (suc _) []        = z<=n
select-bounded (suc n) (_ :: ts) = s<=s (select-bounded n ts)

-- The sharper statement: |Selected| = min(|Eligible|, capacity).
select-exact : forall (n : Nat) (ts : List Task)
             -> length (select n ts) == min n (length ts)
select-exact zero    []        = refl
select-exact zero    (_ :: _)  = refl
select-exact (suc _) []        = refl
select-exact (suc n) (t :: ts) = cong suc (select-exact n ts)

-- ------------------------------------------------------- I4: the retention

-- The ticket-delivery relation: selected now, or retained by exact evidence.
deliveries : List Task -> List Task -> List Task
deliveries selected retained = selected ++ retained

in-++-right : forall {A : Set} {x : A} (xs ys : List A) -> x ∈ ys -> x ∈ (xs ++ ys)
in-++-right []        _  p = p
in-++-right (_ :: xs) ys p = there (in-++-right xs ys p)

-- A task with an exact outstanding obligation appears in the relation for
-- every selection whatsoever -- including the empty one, which is what
-- AbsentFromCurrentGraph produces.
retention : forall (selected retained : List Task) (t : Task)
          -> t ∈ retained
          -> t ∈ deliveries selected retained
retention selected retained _ p = in-++-right selected retained p

-- The corollary that names the interesting case: the graph no longer places
-- the task at all, and the delivery survives regardless.
retention-when-absent : forall (retained : List Task) (t : Task)
                      -> t ∈ retained
                      -> t ∈ deliveries [] retained
retention-when-absent retained t p = retention [] retained t p

-- --------------------------------------------------------------- I2 sketch
--
-- Order independence is deliberately absent. Stating it needs a permutation
-- relation and a proof that `select` commutes with graph-order normalization,
-- which is a substantially larger development than everything above. That
-- cost is the finding, and it is recorded in ../SCOREBOARD.md rather than
-- hidden by a weaker theorem.
