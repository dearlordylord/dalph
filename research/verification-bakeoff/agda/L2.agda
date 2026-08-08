-- L2 of ../INVARIANTS.md in Agda: the delivery protocol as an indexed
-- inductive relation, with Inv proved of every reachable state.
--
-- Deliberately the same development as ../lean/L2.lean, down to the names, so
-- that reading them side by side isolates the language difference. Lean has
-- tactics; Agda does not, and the proofs here are explicit pattern matches.
--
-- Self-contained: no standard library.
{-# OPTIONS --safe #-}
module L2 where

-- ---------------------------------------------------------------- prelude

data Bool : Set where
  true false : Bool

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat
{-# BUILTIN NATURAL Nat #-}

data _==_ {A : Set} (x : A) : A -> Set where
  refl : x == x
infix 4 _==_

data _<=_ : Nat -> Nat -> Set where
  z<=n : forall {n} -> zero <= n
  s<=s : forall {m n} -> m <= n -> suc m <= suc n
infix 4 _<=_

data Maybe (A : Set) : Set where
  nothing : Maybe A
  just    : A -> Maybe A

data _or_ (A B : Set) : Set where
  inl : A -> A or B
  inr : B -> A or B
infixr 1 _or_

record _and_ (A B : Set) : Set where
  constructor _,_
  field
    fst : A
    snd : B
open _and_ public
infixr 2 _and_

data Bot : Set where

Not : Set -> Set
Not A = A -> Bot

record Sigma (A : Set) (B : A -> Set) : Set where
  constructor _,,_
  field
    wit : A
    prf : B wit
open Sigma public

-- ------------------------------------------------------------------ model

-- Two tasks. Bool rather than Fin 2, matching the Lean encoding.
TaskId : Set
TaskId = Bool

data Phase : Set where
  noObligation        : Phase
  claimed             : Phase
  planned             : Phase
  executing           : Phase
  suspensionRequested : Phase
  suspended           : Phase
  accepted            : Phase
  integrating         : Phase
  promoted            : Phase
  settled             : Phase

holdsPosition : Phase -> Bool
holdsPosition executing           = true
holdsPosition suspensionRequested = true
holdsPosition _                   = false

record Ticket : Set where
  constructor mkTicket
  field
    phase        : Phase
    attempts     : Nat
    present      : Bool
    isOpen       : Bool
    expectedHead : Nat
open Ticket public

record St : Set where
  constructor mkSt
  field
    ticket   : TaskId -> Ticket
    capacity : Nat
    holds    : TaskId -> Bool
    paused   : Bool
    target   : Maybe TaskId
    head     : Nat
    crashed  : Bool
open St public

-- Defined by pattern matching rather than with an if-then-else. Both tasks are
-- concrete, so every application reduces definitionally and the proofs never
-- have to reason about a decidable-equality test. This is the single largest
-- ergonomic difference from the Lean encoding.
upd : (TaskId -> Ticket) -> TaskId -> Ticket -> TaskId -> Ticket
upd f false v false = v
upd f false v true  = f true
upd f true  v false = f false
upd f true  v true  = v

updB : (TaskId -> Bool) -> TaskId -> Bool -> TaskId -> Bool
updB f false v false = v
updB f false v true  = f true
updB f true  v false = f false
updB f true  v true  = v

heldCount : St -> Nat
heldCount s = count (holds s false) + count (holds s true)
  where
    count : Bool -> Nat
    count true  = 1
    count false = 0
    _+_ : Nat -> Nat -> Nat
    zero  + n = n
    suc m + n = suc (m + n)

data _<_ : Nat -> Nat -> Set where
  z<s : forall {n} -> zero < suc n
  s<s : forall {m n} -> m < n -> suc m < suc n
infix 4 _<_

freshTicket : Ticket
freshTicket = mkTicket noObligation 0 false false 0

init : St
init = mkSt (\ _ -> freshTicket) 1 (\ _ -> false) false nothing 0 false

-- Integrating falls back to accepted; the isolated Git work survives.
crashTicket : Ticket -> Ticket
crashTicket t with phase t
... | integrating = record t { phase = accepted }
... | _           = t

crashTickets : (TaskId -> Ticket) -> TaskId -> Ticket
crashTickets f u = crashTicket (f u)

-- The transition relation of ../MODEL.md.
data Step : St -> St -> Set where
  observeGraph : (s : St) (t : TaskId) (p o : Bool)
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { present = p ; isOpen = o }) })
  acquireClaim : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == noObligation
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = claimed }) })
  planAttempt : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == claimed
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = planned ; attempts = suc (attempts (ticket s t)) }) })
  beginWork : (s : St) (t : TaskId)
    -> crashed s == false
    -> paused s == false
    -> phase (ticket s t) == planned
    -> heldCount s < capacity s
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = executing }) ; holds = updB (holds s) t true })
  requestSuspension : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == executing
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = suspensionRequested }) })
  safelySuspend : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == suspensionRequested
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = suspended }) ; holds = updB (holds s) t false })
  resumeWork : (s : St) (t : TaskId)
    -> crashed s == false
    -> paused s == false
    -> phase (ticket s t) == suspended
    -> heldCount s < capacity s
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = executing }) ; holds = updB (holds s) t true })
  reportAccepted : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == executing
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = accepted }) ; holds = updB (holds s) t false })
  startIntegration : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == accepted
    -> target s == nothing
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = integrating ; expectedHead = head s })
         ; target = just t })
  promote : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == integrating
    -> expectedHead (ticket s t) == head s
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = promoted })
         ; target = nothing ; head = suc (head s) })
  settle : (s : St) (t : TaskId)
    -> crashed s == false
    -> phase (ticket s t) == promoted
    -> Step s (record s { ticket = upd (ticket s) t
         (record (ticket s t) { phase = settled }) })
  applyPause : (s : St) -> crashed s == false -> Step s (record s { paused = true })
  applyUnpause : (s : St) -> crashed s == false -> Step s (record s { paused = false })
  changeCapacity : (s : St) (c : Nat) -> crashed s == false
    -> Step s (record s { capacity = c })
  externalTargetAdvance : (s : St) -> Step s (record s { head = suc (head s) })
  crash : (s : St) -> crashed s == false
    -> Step s (record s { crashed = true ; holds = \ _ -> false ; target = nothing
                        ; ticket = crashTickets (ticket s) })
  recover : (s : St) -> crashed s == true
    -> Step s (record s { crashed = false
                        ; holds = \ u -> holdsPosition (phase (ticket s u)) })

data Reachable : St -> Set where
  reachInit : Reachable init
  reachStep : forall {s s'} -> Reachable s -> Step s s' -> Reachable s'

-- ------------------------------------------------------------- invariants

-- I7.
positionDiscipline : St -> Set
positionDiscipline s =
  (crashed s == true) or (forall t -> holds s t == holdsPosition (phase (ticket s t)))

-- I14.
processLocalLostOnCrash : St -> Set
processLocalLostOnCrash s =
  (crashed s == false) or ((forall t -> holds s t == false) and (target s == nothing))

-- I10.
attemptsBounded : St -> Set
attemptsBounded s = forall t -> attempts (ticket s t) <= 1

-- The strengthening attemptsBounded needs and that no model checker asked for.
phaseBoundsAttempts : St -> Set
phaseBoundsAttempts s =
  forall t -> (phase (ticket s t) == noObligation) or (phase (ticket s t) == claimed)
            -> attempts (ticket s t) == 0

-- I12/I14.
targetMatchesPhase : St -> Set
targetMatchesPhase s =
  forall t -> target s == just t -> phase (ticket s t) == integrating

record Inv (s : St) : Set where
  constructor mkInv
  field
    position      : positionDiscipline s
    crashClears   : processLocalLostOnCrash s
    attemptsOk    : attemptsBounded s
    phaseAttempts : phaseBoundsAttempts s
    targetPhase   : targetMatchesPhase s
open Inv public

-- ----------------------------------------------------------------- proofs

-- Equality plumbing.

sym : forall {A : Set} {x y : A} -> x == y -> y == x
sym refl = refl

trans : forall {A : Set} {x y z : A} -> x == y -> y == z -> x == z
trans refl q = q

cong : forall {A B : Set} (f : A -> B) {x y : A} -> x == y -> f x == f y
cong f refl = refl

subst : forall {A : Set} (P : A -> Set) {x y : A} -> x == y -> P x -> P y
subst P refl p = p

absurd : forall {A : Set} -> Bot -> A
absurd ()

record Top : Set where
  constructor tt

-- A phase discriminator: only `integrating` is empty, so any equation between
-- `integrating` and a different constructor is refutable through it.
IntOnly : Phase -> Set
IntOnly integrating = Bot
IntOnly _           = Top

clash : forall {A : Set} {p : Phase} -> p == integrating -> IntOnly p -> A
clash e x = absurd (subst IntOnly e x)

-- Pointwise reasoning about a single-task ticket update. Both task ids are
-- concrete after the split, so `upd` reduces definitionally.

posA-aux : (s : St) (t : TaskId) (v : Ticket)
  -> holdsPosition (phase v) == holdsPosition (phase (ticket s t))
  -> (forall u -> holds s u == holdsPosition (phase (ticket s u)))
  -> (u : TaskId) -> holds s u == holdsPosition (phase (upd (ticket s) t v u))
posA-aux s false v hp f false = trans (f false) (sym hp)
posA-aux s false v hp f true  = f true
posA-aux s true  v hp f false = f false
posA-aux s true  v hp f true  = trans (f true) (sym hp)

posA : (s : St) (t : TaskId) (v : Ticket)
  -> holdsPosition (phase v) == holdsPosition (phase (ticket s t))
  -> positionDiscipline s
  -> (crashed s == true)
     or (forall u -> holds s u == holdsPosition (phase (upd (ticket s) t v u)))
posA s t v hp (inl x) = inl x
posA s t v hp (inr f) = inr (posA-aux s t v hp f)

posB-aux : (s : St) (t : TaskId) (v : Ticket) (b : Bool)
  -> b == holdsPosition (phase v)
  -> (forall u -> holds s u == holdsPosition (phase (ticket s u)))
  -> (u : TaskId) -> updB (holds s) t b u == holdsPosition (phase (upd (ticket s) t v u))
posB-aux s false v b hb f false = hb
posB-aux s false v b hb f true  = f true
posB-aux s true  v b hb f false = f false
posB-aux s true  v b hb f true  = hb

posB : (s : St) (t : TaskId) (v : Ticket) (b : Bool)
  -> b == holdsPosition (phase v)
  -> positionDiscipline s
  -> (crashed s == true)
     or (forall u -> updB (holds s) t b u == holdsPosition (phase (upd (ticket s) t v u)))
posB s t v b hb (inl x) = inl x
posB s t v b hb (inr f) = inr (posB-aux s t v b hb f)

attA : (s : St) (t : TaskId) (v : Ticket)
  -> attempts v <= 1
  -> (forall u -> attempts (ticket s u) <= 1)
  -> (u : TaskId) -> attempts (upd (ticket s) t v u) <= 1
attA s false v av f false = av
attA s false v av f true  = f true
attA s true  v av f false = f false
attA s true  v av f true  = av

phA : (s : St) (t : TaskId) (v : Ticket)
  -> ((phase v == noObligation) or (phase v == claimed) -> attempts v == 0)
  -> phaseBoundsAttempts s
  -> (u : TaskId)
  -> (phase (upd (ticket s) t v u) == noObligation)
     or (phase (upd (ticket s) t v u) == claimed)
  -> attempts (upd (ticket s) t v u) == 0
phA s false v hv g false = hv
phA s false v hv g true  = g true
phA s true  v hv g false = g false
phA s true  v hv g true  = hv

tgtA : (s : St) (t : TaskId) (v : Ticket)
  -> (target s == just t -> phase v == integrating)
  -> targetMatchesPhase s
  -> (u : TaskId) -> target s == just u -> phase (upd (ticket s) t v u) == integrating
tgtA s false v hv g false = hv
tgtA s false v hv g true  = g true
tgtA s true  v hv g false = g false
tgtA s true  v hv g true  = hv

tgtNew : (s : St) (t : TaskId) (v : Ticket)
  -> phase v == integrating
  -> (u : TaskId) -> just t == just u -> phase (upd (ticket s) t v u) == integrating
tgtNew s false v p false _ = p
tgtNew s false v p true  ()
tgtNew s true  v p false ()
tgtNew s true  v p true  _ = p

-- `crashTicket` is defined by a `with` on the phase, so it only reduces once
-- the phase is a constructor: split the ticket open.

crash-att : (t : Ticket) -> attempts (crashTicket t) == attempts t
crash-att (mkTicket noObligation a p o e)        = refl
crash-att (mkTicket claimed a p o e)             = refl
crash-att (mkTicket planned a p o e)             = refl
crash-att (mkTicket executing a p o e)           = refl
crash-att (mkTicket suspensionRequested a p o e) = refl
crash-att (mkTicket suspended a p o e)           = refl
crash-att (mkTicket accepted a p o e)            = refl
crash-att (mkTicket integrating a p o e)         = refl
crash-att (mkTicket promoted a p o e)            = refl
crash-att (mkTicket settled a p o e)             = refl

crash-phA : (t : Ticket)
  -> ((phase t == noObligation) or (phase t == claimed) -> attempts t == 0)
  -> (phase (crashTicket t) == noObligation) or (phase (crashTicket t) == claimed)
  -> attempts (crashTicket t) == 0
crash-phA (mkTicket noObligation a p o e)        g h = g h
crash-phA (mkTicket claimed a p o e)             g h = g h
crash-phA (mkTicket planned a p o e)             g h = g h
crash-phA (mkTicket executing a p o e)           g h = g h
crash-phA (mkTicket suspensionRequested a p o e) g h = g h
crash-phA (mkTicket suspended a p o e)           g h = g h
crash-phA (mkTicket accepted a p o e)            g h = g h
crash-phA (mkTicket integrating a p o e)         g (inl ())
crash-phA (mkTicket integrating a p o e)         g (inr ())
crash-phA (mkTicket promoted a p o e)            g h = g h
crash-phA (mkTicket settled a p o e)             g h = g h

inv-init : Inv init
inv-init = mkInv
  (inr (\ _ -> refl))
  (inl refl)
  (\ _ -> z<=n)
  (\ _ _ -> refl)
  (\ _ ())

inv-step : forall {s s'} -> Inv s -> Step s s' -> Inv s'
inv-step i (observeGraph s t p o) = mkInv
  (posA s t _ refl (position i))
  (crashClears i)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (phaseAttempts i t) (phaseAttempts i))
  (tgtA s t _ (targetPhase i t) (targetPhase i))
inv-step i (acquireClaim s t c e) = mkInv
  (posA s t _ (sym (cong holdsPosition e)) (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ _ -> phaseAttempts i t (inl e)) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (planAttempt s t c e) = mkInv
  (posA s t _ (sym (cong holdsPosition e)) (position i))
  (inl c)
  (attA s t _ (subst (\ n -> suc n <= 1) (sym (phaseAttempts i t (inr e))) (s<=s z<=n))
       (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (beginWork s t c pz e hc) = mkInv
  (posB s t _ true refl (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (requestSuspension s t c e) = mkInv
  (posA s t _ (sym (cong holdsPosition e)) (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (safelySuspend s t c e) = mkInv
  (posB s t _ false refl (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (resumeWork s t c pz e hc) = mkInv
  (posB s t _ true refl (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (reportAccepted s t c e) = mkInv
  (posB s t _ false refl (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (startIntegration s t c e tg0) = mkInv
  (posA s t _ (sym (cong holdsPosition e)) (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtNew s t _ refl)
inv-step i (promote s t c e eh) = mkInv
  (posA s t _ (sym (cong holdsPosition e)) (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (\ _ ())
inv-step i (settle s t c e) = mkInv
  (posA s t _ (sym (cong holdsPosition e)) (position i))
  (inl c)
  (attA s t _ (attemptsOk i t) (attemptsOk i))
  (phA s t _ (\ { (inl ()) ; (inr ()) }) (phaseAttempts i))
  (tgtA s t _ (\ tg -> clash (trans (sym e) (targetPhase i t tg)) tt) (targetPhase i))
inv-step i (applyPause s c) = mkInv
  (position i) (crashClears i) (attemptsOk i) (phaseAttempts i) (targetPhase i)
inv-step i (applyUnpause s c) = mkInv
  (position i) (crashClears i) (attemptsOk i) (phaseAttempts i) (targetPhase i)
inv-step i (changeCapacity s cp c) = mkInv
  (position i) (crashClears i) (attemptsOk i) (phaseAttempts i) (targetPhase i)
inv-step i (externalTargetAdvance s) = mkInv
  (position i) (crashClears i) (attemptsOk i) (phaseAttempts i) (targetPhase i)
inv-step i (crash s c) = mkInv
  (inl refl)
  (inr ((\ _ -> refl) , refl))
  (\ u -> subst (\ n -> n <= 1) (sym (crash-att (ticket s u))) (attemptsOk i u))
  (\ u -> crash-phA (ticket s u) (phaseAttempts i u))
  (\ _ ())
inv-step i (recover s c) = mkInv
  (inr (\ _ -> refl))
  (inl refl)
  (attemptsOk i) (phaseAttempts i) (targetPhase i)

inv-reachable : forall {s} -> Reachable s -> Inv s
inv-reachable reachInit        = inv-init
inv-reachable (reachStep r st) = inv-step (inv-reachable r) st

-- I10 as the consumer sees it, discharged through the strengthening.
reachable-attempts-le-one : forall {s} -> Reachable s -> (t : TaskId)
  -> attempts (ticket s t) <= 1
reachable-attempts-le-one r t = attemptsOk (inv-reachable r) t

-- --------------------------------------------------------- vacuity checks

-- Every theorem above quantifies over reachable states, so all of them hold
-- vacuously if nothing interesting is reachable, and Inv could in principle
-- hold of everything. These are the same checks ../lean/L2.lean carries, and
-- the same ones `tlaplus/run.sh --witness` performs by refutation.
--
-- The trace is spelled out one state at a time. A model checker finds it; here
-- it is written by hand, which is part of the cost being measured.

t1 : St
t1 = record init { ticket = upd (ticket init) false
       (record (ticket init false) { present = true ; isOpen = true }) }

t2 : St
t2 = record t1 { ticket = upd (ticket t1) false
       (record (ticket t1 false) { phase = claimed }) }

t3 : St
t3 = record t2 { ticket = upd (ticket t2) false
       (record (ticket t2 false) { phase = planned ; attempts = suc (attempts (ticket t2 false)) }) }

t4 : St
t4 = record t3 { ticket = upd (ticket t3) false
       (record (ticket t3 false) { phase = executing }) ; holds = updB (holds t3) false true }

t5 : St
t5 = record t4 { ticket = upd (ticket t4) false
       (record (ticket t4 false) { phase = accepted }) ; holds = updB (holds t4) false false }

t6 : St
t6 = record t5 { ticket = upd (ticket t5) false
       (record (ticket t5 false) { phase = integrating ; expectedHead = head t5 })
       ; target = just false }

t7 : St
t7 = record t6 { head = suc (head t6) }

t4-reachable : Reachable t4
t4-reachable =
  reachStep (reachStep (reachStep (reachStep reachInit (observeGraph init false true true))
    (acquireClaim t1 false refl refl))
    (planAttempt t2 false refl refl))
    (beginWork t3 false refl refl refl z<s)

-- A task really does reach executing while holding a position.
executing-is-reachable :
  Reachable t4 and ((phase (ticket t4 false) == executing) and (holds t4 false == true))
executing-is-reachable = t4-reachable , (refl , refl)

t7-reachable : Reachable t7
t7-reachable =
  reachStep (reachStep (reachStep t4-reachable (reportAccepted t4 false refl refl))
    (startIntegration t5 false refl refl refl))
    (externalTargetAdvance t6)

-- A stale expected head is reachable, so promote's compare-and-set guard is
-- defending against something. This is the vacuity that made mutant M6
-- undetectable until externalTargetAdvance was added to the model.
stale-head-is-reachable :
  Reachable t7 and ((phase (ticket t7 false) == integrating)
    and Not (expectedHead (ticket t7 false) == head t7))
stale-head-is-reachable = t7-reachable , (refl , \ ())

-- Inv is not trivially true.
badState : St
badState = record init { holds = \ _ -> true }

inv-is-refutable : Not (Inv badState)
inv-is-refutable i with position i
... | inl ()
... | inr p with p false
...   | ()
