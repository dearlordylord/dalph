{-# OPTIONS --safe #-}

module Journal where

-- The concrete journal semantics and journal-law kernel in Agda, with no
-- standard-library dependency.
--
-- The exhaustive alphabet is the same 23-event alphabet used by the Lean,
-- Dafny, and fast-check arms. The generic Semantics record makes P3's
-- separation structural: local code receives only one Region, shared code
-- may inspect Regions and Shared Run state but can return only Shared state,
-- and only `step` combines the results. `concrete-local` and
-- `concrete-shared` port all 23 JavaScript guards and effects.
--
-- Deliberate specialization: this file names the benchmark's two tasks as
-- `a` and `b`. Lean quantifies over arbitrary task identifiers; Dafny keeps
-- the same two-task specialization. The
-- proof below is unbounded in journal length and payload values, but it does
-- not establish n > 2. That cost/strength difference is part of the result,
-- not a silent parity claim. The port is separately authored rather than a
-- machine-checked translation of the executable JavaScript; see ../LEARNING.md.

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

{-# BUILTIN NATURAL Nat #-}

data Bool : Set where false true : Bool

not : Bool -> Bool
not false = true
not true = false

_&&_ : Bool -> Bool -> Bool
false && _ = false
true && value = value

_||_ : Bool -> Bool -> Bool
false || value = value
true || _ = true

infixr 3 _&&_
infixr 2 _||_

data List (A : Set) : Set where
  []   : List A
  _::_ : A -> List A -> List A

infixr 5 _::_

data Maybe (A : Set) : Set where
  nothing : Maybe A
  just    : A -> Maybe A

data _==_ {A : Set} (x : A) : A -> Set where
  refl : x == x

infix 4 _==_

{-# BUILTIN EQUALITY _==_ #-}

data Bottom : Set where

bottom-elim : {A : Set} -> Bottom -> A
bottom-elim ()

true-not-false : true == false -> Bottom
true-not-false ()

cong : {A B : Set} {x y : A} -> (f : A -> B) -> x == y -> f x == f y
cong f refl = refl

trans : {A : Set} {x y z : A} -> x == y -> y == z -> x == z
trans refl refl = refl

sym : {A : Set} {x y : A} -> x == y -> y == x
sym refl = refl

_++_ : {A : Set} -> List A -> List A -> List A
[] ++ ys = ys
(x :: xs) ++ ys = x :: (xs ++ ys)

foldl : {A B : Set} -> (B -> A -> B) -> B -> List A -> B
foldl f z [] = z
foldl f z (x :: xs) = foldl f (f z x) xs

foldl-append : {A B : Set} (f : B -> A -> B) (z : B)
  (xs ys : List A) -> foldl f z (xs ++ ys) == foldl f (foldl f z xs) ys
foldl-append f z [] ys = refl
foldl-append f z (x :: xs) ys = foldl-append f (f z x) xs ys

_==n_ : Nat -> Nat -> Bool
zero ==n zero = true
zero ==n suc _ = false
suc _ ==n zero = false
suc x ==n suc y = x ==n y

_<n_ : Nat -> Nat -> Bool
zero <n zero = false
zero <n suc _ = true
suc _ <n zero = false
suc x <n suc y = x <n y

_<=n_ : Nat -> Nat -> Bool
x <=n y = (x <n y) || (x ==n y)

length : {A : Set} -> List A -> Nat
length [] = 0
length (_ :: xs) = suc (length xs)

data Task : Set where a b : Task

_==t_ : Task -> Task -> Bool
a ==t a = true
a ==t b = false
b ==t a = false
b ==t b = true

task-in : Task -> List Task -> Bool
task-in task [] = false
task-in task (head :: rest) = (task ==t head) || task-in task rest

remove-task : Task -> List Task -> List Task
remove-task task [] = []
remove-task task (head :: rest) with task ==t head
... | true = remove-task task rest
... | false = head :: remove-task task rest
data Direction : Set where pause unpause : Direction
data IneligibleReason : Set where
  missingFromTargetClosure notOpen prerequisitesUnsatisfied : IneligibleReason
data WorktreeOutcome : Set where created alreadyPresent absent : WorktreeOutcome
data Report : Set where
  running safelySuspended : Report
  terminal : Nat -> Report
data RetentionReason : Set where
  correctionLimitExhausted continuationLimitExhausted staleTargetHead : RetentionReason

record Fact : Set where
  constructor fact
  field subject : Task
        present isOpen : Bool

data Action : Set where
  claimIntentRecorded claimReleaseIntentRecorded : Task -> Nat -> Action
  attemptPlanned : Task -> Nat -> Nat -> Action
  workAdmitted suspensionRequested resumeRequested worktreeIntentRecorded : Task -> Nat -> Action
  integrationSessionOpened promotionIntentRecorded : Task -> Nat -> Action
  candidateConstructionNonConvergent : Task -> RetentionReason -> Action
  deliverySettled : Task -> Action
  workflowRunBegun : Nat -> Nat -> Action
  workflowRunTerminated capacityRevised : Nat -> Action
  directionApplied : Nat -> Direction -> Action

data Occurrence : Set where
  trackerFactsObserved : List Task -> List Fact -> Bool -> Nat -> Occurrence
  claimRecordRead : Task -> Nat -> Nat -> Occurrence
  claimedTaskEligibilityObserved : Task -> Nat -> Occurrence
  claimedTaskIneligible : Task -> IneligibleReason -> Occurrence
  worktreeReconciliationObserved : Task -> Nat -> WorktreeOutcome -> Occurrence
  executorReported : Task -> Nat -> Report -> Occurrence
  promotionOutcomeObserved : Task -> Nat -> Occurrence
  targetHeadObserved : Nat -> Occurrence

data Event : Set where
  act : Action -> Event
  occ : Occurrence -> Event

-- Adding an event constructor makes one of these exhaustive classifiers fail.
task-of-action : Action -> Maybe Task
task-of-action (claimIntentRecorded t _) = just t
task-of-action (claimReleaseIntentRecorded t _) = just t
task-of-action (attemptPlanned t _ _) = just t
task-of-action (workAdmitted t _) = just t
task-of-action (suspensionRequested t _) = just t
task-of-action (resumeRequested t _) = just t
task-of-action (worktreeIntentRecorded t _) = just t
task-of-action (integrationSessionOpened t _) = just t
task-of-action (promotionIntentRecorded t _) = just t
task-of-action (candidateConstructionNonConvergent t _) = just t
task-of-action (deliverySettled t) = just t
task-of-action (workflowRunBegun _ _) = nothing
task-of-action (workflowRunTerminated _) = nothing
task-of-action (capacityRevised _) = nothing
task-of-action (directionApplied _ _) = nothing

task-of-occurrence : Occurrence -> Maybe Task
task-of-occurrence (trackerFactsObserved _ _ _ _) = nothing
task-of-occurrence (claimRecordRead t _ _) = just t
task-of-occurrence (claimedTaskEligibilityObserved t _) = just t
task-of-occurrence (claimedTaskIneligible t _) = just t
task-of-occurrence (worktreeReconciliationObserved t _ _) = just t
task-of-occurrence (executorReported t _ _) = just t
task-of-occurrence (promotionOutcomeObserved t _) = just t
task-of-occurrence (targetHeadObserved _) = nothing

task-of : Event -> Maybe Task
task-of (act action) = task-of-action action
task-of (occ occurrence) = task-of-occurrence occurrence

record Region : Set where
  constructor region
  field phase attempts expectedHead : Nat
        attemptId runId claimToken : Maybe Nat
        claimPending worktreePending promotionPending failed : Bool
        retentionReason : Maybe RetentionReason

open Region

initial-region : Region
initial-region = region 0 0 0 nothing nothing nothing false false false false nothing

failed-region : Region -> Region
failed-region r =
  region (phase r) (attempts r) (expectedHead r) (attemptId r) (runId r)
    (claimToken r) (claimPending r) (worktreePending r)
    (promotionPending r) true (retentionReason r)

record Regions : Set where
  constructor regions
  field region-a region-b : Region

open Regions

get-region : Regions -> Task -> Region
get-region rs a = region-a rs
get-region rs b = region-b rs

set-region : Regions -> Task -> Region -> Regions
set-region rs a value = regions value (region-b rs)
set-region rs b value = regions (region-a rs) value

record Observation : Set where
  constructor observation
  field observedSubjects : List Task
        observedFacts : List Fact
        observationComplete : Bool

record Shared : Set where
  constructor shared
  field capacity : Nat
        positions : List Task
        paused : Bool
        targetResource : List Task
        targetHead : Nat
        runBegun : Bool
        activeRunId runTarget : Maybe Nat
        runFailed runTerminated : Bool
        presentA openA presentB openB : Bool
        seenObservation : Nat -> Maybe Observation

open Shared

maybe-nat-eq : Maybe Nat -> Maybe Nat -> Bool
maybe-nat-eq nothing nothing = true
maybe-nat-eq nothing (just _) = false
maybe-nat-eq (just _) nothing = false
maybe-nat-eq (just x) (just y) = x ==n y

bool-eq : Bool -> Bool -> Bool
bool-eq false false = true
bool-eq false true = false
bool-eq true false = false
bool-eq true true = true

tasks-eq : List Task -> List Task -> Bool
tasks-eq [] [] = true
tasks-eq [] (_ :: _) = false
tasks-eq (_ :: _) [] = false
tasks-eq (x :: xs) (y :: ys) = (x ==t y) && tasks-eq xs ys

fact-eq : Fact -> Fact -> Bool
fact-eq (fact sx px ox) (fact sy py oy) =
  (sx ==t sy) && bool-eq px py && bool-eq ox oy

facts-eq : List Fact -> List Fact -> Bool
facts-eq [] [] = true
facts-eq [] (_ :: _) = false
facts-eq (_ :: _) [] = false
facts-eq (x :: xs) (y :: ys) = fact-eq x y && facts-eq xs ys

observation-eq : Observation -> Observation -> Bool
observation-eq (observation sx fx cx) (observation sy fy cy) =
  tasks-eq sx sy && facts-eq fx fy && bool-eq cx cy

present-of : Shared -> Task -> Bool
present-of sh a = presentA sh
present-of sh b = presentB sh

open-of : Shared -> Task -> Bool
open-of sh a = openA sh
open-of sh b = openB sh

eligible : Shared -> Task -> Bool
eligible sh task = present-of sh task && open-of sh task

selected : Shared -> Task -> Bool
selected sh a = eligible sh a && (0 <n capacity sh)
selected sh b = eligible sh b &&
  (if-eligible-a <n capacity sh)
  where
    if-eligible-a : Nat
    if-eligible-a with eligible sh a
    ... | true = 1
    ... | false = 0

set-fact : Shared -> Fact -> Shared
set-fact sh (fact a p o) = record sh { presentA = p ; openA = o }
set-fact sh (fact b p o) = record sh { presentB = p ; openB = o }

apply-facts : Shared -> List Fact -> Shared
apply-facts sh [] = sh
apply-facts sh (item :: rest) = apply-facts (set-fact sh item) rest

mark-unobserved : Shared -> List Task -> Shared
mark-unobserved sh subjects =
  record sh
    { presentA = if-present a (presentA sh)
    ; openA = if-present a (openA sh)
    ; presentB = if-present b (presentB sh)
    ; openB = if-present b (openB sh)
    }
  where
    if-present : Task -> Bool -> Bool
    if-present task value with task-in task subjects
    ... | true = value
    ... | false = false

set-seen : (Nat -> Maybe Observation) -> Nat -> Observation -> Nat -> Maybe Observation
set-seen seen key value other with key ==n other
... | true = just value
... | false = seen other

record State : Set where
  constructor state
  field taskRegions : Regions
        sharedState : Shared

open State

initial-regions : Regions
initial-regions = regions initial-region initial-region

initial-state : State
initial-state = state initial-regions
  (shared 1 [] false [] 0 false nothing nothing false false
    false false false false (\ _ -> nothing))

fail-run : State -> State
fail-run s = state (taskRegions s) (record (sharedState s) { runFailed = true })

data LocalOutcome : Set where
  localContradiction : LocalOutcome
  localOk : Region -> LocalOutcome

data SharedOutcome : Set where
  sharedContradiction : SharedOutcome
  sharedOk : Shared -> SharedOutcome

record Semantics : Set where
  field localStep : Region -> Event -> LocalOutcome
        sharedStep : Regions -> Shared -> Event -> SharedOutcome

open Semantics

local-result : Bool -> Region -> LocalOutcome
local-result true next = localOk next
local-result false _ = localContradiction

correlates : Region -> Nat -> Bool
correlates r aid = maybe-nat-eq (attemptId r) (just aid)

concrete-local : Region -> Event -> LocalOutcome
concrete-local r (act (claimIntentRecorded _ token)) =
  local-result (phase r ==n 0)
    (record r { phase = 1 ; claimToken = just token ; claimPending = true })
concrete-local r (act (claimReleaseIntentRecorded _ token)) =
  local-result ((phase r ==n 1) && maybe-nat-eq (claimToken r) (just token))
    (record r { phase = 0 ; claimToken = nothing ; claimPending = false })
concrete-local r (occ (claimRecordRead _ _ token)) =
  local-result (claimPending r &&
    (maybe-nat-eq (claimToken r) (just token) || (phase r ==n 1)))
    (claim-read-next r token)
  where
    claim-read-next : Region -> Nat -> Region
    claim-read-next current value with maybe-nat-eq (claimToken current) (just value)
    ... | true = record current { claimPending = false }
    ... | false = record current { phase = 0 ; claimToken = nothing ; claimPending = false }
concrete-local r (occ (claimedTaskEligibilityObserved _ _)) =
  local-result (phase r ==n 1) r
concrete-local r (occ (claimedTaskIneligible _ _)) =
  local-result (phase r ==n 1) r
concrete-local r (act (attemptPlanned _ rid aid)) =
  local-result ((phase r ==n 1) && (attempts r ==n 0))
    (record r { phase = 2 ; attempts = suc (attempts r)
              ; attemptId = just aid ; runId = just rid })
concrete-local r (act (workAdmitted _ aid)) =
  local-result ((phase r ==n 2) && correlates r aid) (record r { phase = 3 })
concrete-local r (act (suspensionRequested _ aid)) =
  local-result ((phase r ==n 3) && correlates r aid) (record r { phase = 4 })
concrete-local r (act (resumeRequested _ aid)) =
  local-result ((phase r ==n 5) && correlates r aid) (record r { phase = 3 })
concrete-local r (act (worktreeIntentRecorded _ aid)) =
  local-result ((phase r ==n 2) && correlates r aid && not (worktreePending r))
    (record r { worktreePending = true })
concrete-local r (occ (worktreeReconciliationObserved _ aid _)) =
  local-result (worktreePending r && correlates r aid)
    (record r { worktreePending = false })
concrete-local r (occ (executorReported _ aid running)) =
  local-result (((phase r ==n 3) || (phase r ==n 4)) && correlates r aid) r
concrete-local r (occ (executorReported _ aid safelySuspended)) =
  local-result ((phase r ==n 4) && correlates r aid) (record r { phase = 5 })
concrete-local r (occ (executorReported _ aid (terminal _))) =
  local-result ((phase r ==n 3) && correlates r aid) (record r { phase = 6 })
concrete-local r (act (integrationSessionOpened _ head)) =
  local-result (phase r ==n 6) (record r { phase = 7 ; expectedHead = head })
concrete-local r (act (promotionIntentRecorded _ head)) =
  local-result ((phase r ==n 7) && (expectedHead r ==n head) && not (promotionPending r))
    (record r { promotionPending = true })
concrete-local r (occ (promotionOutcomeObserved _ head)) =
  local-result ((phase r ==n 7) && promotionPending r) (promotion-next r head)
  where
    promotion-next : Region -> Nat -> Region
    promotion-next current landed with landed ==n expectedHead current
    ... | true = record current { phase = 8 ; promotionPending = false }
    ... | false = record current { promotionPending = false }
concrete-local r (act (candidateConstructionNonConvergent _ reason)) =
  local-result (phase r ==n 7)
    (record r { phase = 9 ; retentionReason = just reason })
concrete-local r (act (deliverySettled _)) =
  local-result (phase r ==n 8) (record r { phase = 10 })
concrete-local r (act (workflowRunBegun _ _)) = localOk r
concrete-local r (act (workflowRunTerminated _)) = localOk r
concrete-local r (act (capacityRevised _)) = localOk r
concrete-local r (act (directionApplied _ _)) = localOk r
concrete-local r (occ (trackerFactsObserved _ _ _ _)) = localOk r
concrete-local r (occ (targetHeadObserved _)) = localOk r

shared-result : Bool -> Shared -> SharedOutcome
shared-result true next = sharedOk next
shared-result false _ = sharedContradiction

concrete-shared : Regions -> Shared -> Event -> SharedOutcome
concrete-shared _ sh (act (claimIntentRecorded task _)) =
  shared-result (selected sh task) sh
concrete-shared _ sh (act (attemptPlanned _ rid _)) =
  shared-result (not (runBegun sh) || maybe-nat-eq (activeRunId sh) (just rid)) sh
concrete-shared _ sh (act (workAdmitted task _)) =
  shared-result (not (paused sh) && (length (positions sh) <n capacity sh))
    (record sh { positions = positions sh ++ (task :: []) })
concrete-shared _ sh (act (resumeRequested task _)) =
  shared-result (not (paused sh) && (length (positions sh) <n capacity sh))
    (record sh { positions = positions sh ++ (task :: []) })
concrete-shared _ sh (occ (executorReported task _ safelySuspended)) =
  sharedOk (record sh { positions = remove-task task (positions sh) })
concrete-shared _ sh (occ (executorReported task _ (terminal _))) =
  sharedOk (record sh { positions = remove-task task (positions sh) })
concrete-shared _ sh (act (integrationSessionOpened task head)) =
  shared-result ((length (targetResource sh) ==n 0) && (head ==n targetHead sh))
    (record sh { targetResource = task :: [] })
concrete-shared rs sh (occ (promotionOutcomeObserved task head)) =
  promotion-shared rs sh task head
  where
    promotion-shared : Regions -> Shared -> Task -> Nat -> SharedOutcome
    promotion-shared regionsValue sharedValue owner landed with
      landed ==n expectedHead (get-region regionsValue owner)
    ... | false = sharedOk sharedValue
    ... | true = shared-result ((landed ==n targetHead sharedValue) && (targetHead sharedValue <n 4))
      (record sharedValue { targetHead = suc (targetHead sharedValue) ; targetResource = [] })
concrete-shared rs sh (act (candidateConstructionNonConvergent task staleTargetHead)) =
  shared-result (not (expectedHead (get-region rs task) ==n targetHead sh))
    (record sh { targetResource = remove-task task (targetResource sh) })
concrete-shared _ sh (act (candidateConstructionNonConvergent task _)) =
  sharedOk (record sh { targetResource = remove-task task (targetResource sh) })
concrete-shared _ sh (occ (trackerFactsObserved subjects facts complete key)) =
  observe sh subjects facts complete key
  where
    mark-if-complete : Shared -> List Task -> Bool -> Shared
    mark-if-complete current _ false = current
    mark-if-complete current subjectsValue true = mark-unobserved current subjectsValue
    finish : Shared -> List Task -> List Fact -> Bool -> Nat -> Shared
    finish current subjectsValue factsValue completeValue keyValue =
      mark-if-complete
        (record (apply-facts current factsValue)
          { seenObservation = set-seen (seenObservation current) keyValue
              (observation subjectsValue factsValue completeValue) })
        subjectsValue completeValue
    observe-seen : Shared -> List Task -> List Fact -> Bool -> Nat -> Observation -> Bool -> SharedOutcome
    observe-seen current subjectsValue factsValue completeValue keyValue _ false = sharedContradiction
    observe-seen current subjectsValue factsValue completeValue keyValue _ true =
      sharedOk (finish current subjectsValue factsValue completeValue keyValue)
    observe : Shared -> List Task -> List Fact -> Bool -> Nat -> SharedOutcome
    observe current subjectsValue factsValue completeValue keyValue with
      seenObservation current keyValue
    ... | nothing = sharedOk (finish current subjectsValue factsValue completeValue keyValue)
    ... | just old = observe-seen current subjectsValue factsValue completeValue keyValue old
      (observation-eq old (observation subjectsValue factsValue completeValue))
concrete-shared _ sh (occ (targetHeadObserved head)) =
  shared-result ((head ==n suc (targetHead sh)) && (head <=n 4))
    (record sh { targetHead = head })
concrete-shared _ sh (act (capacityRevised value)) =
  shared-result ((value <=n 2) && not (value ==n capacity sh))
    (record sh { capacity = value })
concrete-shared _ sh (act (directionApplied _ pause)) =
  shared-result (not (paused sh)) (record sh { paused = true })
concrete-shared _ sh (act (directionApplied _ unpause)) =
  shared-result (paused sh) (record sh { paused = false })
concrete-shared _ sh (act (workflowRunBegun rid target)) =
  shared-result (not (runBegun sh))
    (record sh { runBegun = true ; activeRunId = just rid ; runTarget = just target })
concrete-shared _ sh (act (workflowRunTerminated rid)) =
  shared-result (runBegun sh && not (runTerminated sh) &&
    maybe-nat-eq (activeRunId sh) (just rid))
    (record sh { runTerminated = true })
concrete-shared _ sh (act (claimReleaseIntentRecorded _ _)) = sharedOk sh
concrete-shared _ sh (act (suspensionRequested _ _)) = sharedOk sh
concrete-shared _ sh (act (worktreeIntentRecorded _ _)) = sharedOk sh
concrete-shared _ sh (act (promotionIntentRecorded _ _)) = sharedOk sh
concrete-shared _ sh (act (deliverySettled _)) = sharedOk sh
concrete-shared _ sh (occ (claimRecordRead _ _ _)) = sharedOk sh
concrete-shared _ sh (occ (claimedTaskEligibilityObserved _ _)) = sharedOk sh
concrete-shared _ sh (occ (claimedTaskIneligible _ _)) = sharedOk sh
concrete-shared _ sh (occ (worktreeReconciliationObserved _ _ _)) = sharedOk sh
concrete-shared _ sh (occ (executorReported _ _ running)) = sharedOk sh

concrete : Semantics
concrete = record { localStep = concrete-local ; sharedStep = concrete-shared }

local-only-task : Semantics -> Regions -> Event -> Task -> Regions
local-only-task m rs e owner with failed (get-region rs owner)
... | true = rs
... | false with localStep m (get-region rs owner) e
...   | localContradiction = set-region rs owner (failed-region (get-region rs owner))
...   | localOk next = set-region rs owner next

local-only-step : Semantics -> Regions -> Event -> Regions
local-only-step m rs e with task-of e
... | nothing = rs
... | just owner = local-only-task m rs e owner

apply-shared : State -> SharedOutcome -> State
apply-shared s sharedContradiction = fail-run s
apply-shared s (sharedOk next) = state (taskRegions s) next

step-task : Semantics -> State -> Event -> Task -> State
step-task m s e owner with failed (get-region (taskRegions s) owner)
... | true = s
... | false with localStep m (get-region (taskRegions s) owner) e
...   | localContradiction =
  state (set-region (taskRegions s) owner (failed-region (get-region (taskRegions s) owner)))
    (sharedState s)
...   | localOk nextRegion with sharedStep m (taskRegions s) (sharedState s) e
...     | sharedContradiction = fail-run s
...     | sharedOk nextShared =
  state (set-region (taskRegions s) owner nextRegion) nextShared

step-active : Semantics -> State -> Event -> State
step-active m s e with task-of e
... | nothing = apply-shared s (sharedStep m (taskRegions s) (sharedState s) e)
... | just owner = step-task m s e owner

step : Semantics -> State -> Event -> State
step m s e with runFailed (sharedState s)
... | true = s
... | false with runTerminated (sharedState s)
...   | true = fail-run s
...   | false = step-active m s e

fold-from : Semantics -> State -> List Event -> State
fold-from m = foldl (step m)

fold : Semantics -> List Event -> State
fold m = fold-from m initial-state

fold-regions-from : Semantics -> Regions -> List Event -> Regions
fold-regions-from m = foldl (local-only-step m)

fold-regions : Semantics -> List Event -> Regions
fold-regions m = fold-regions-from m initial-regions

-- P1: --safe checks termination and coverage. Contradiction is a value, so
-- every finite crash-truncated prefix produces a State.

-- P2: Agda charges one explicit structural induction where Lean reuses
-- List.foldl_append. No event-specific premise is needed.
homomorphism : (m : Semantics) (p q : List Event) ->
  fold m (p ++ q) == fold-from m (fold m p) q
homomorphism m p q = foldl-append (step m) initial-state p q

data LiveStep (m : Semantics) (s : State) (e : Event) : Set where
  live : runFailed (sharedState s) == false ->
    runTerminated (sharedState s) == false ->
    runFailed (sharedState (step-active m s e)) == false ->
    LiveStep m s e

shared-regions : (s : State) (outcome : SharedOutcome) ->
  runFailed (sharedState (apply-shared s outcome)) == false ->
  taskRegions (apply-shared s outcome) == taskRegions s
shared-regions s sharedContradiction h = bottom-elim (true-not-false h)
shared-regions s (sharedOk next) h = refl

task-regions : (m : Semantics) (s : State) (e : Event) (owner : Task) ->
  runFailed (sharedState (step-task m s e owner)) == false ->
  taskRegions (step-task m s e owner) == local-only-task m (taskRegions s) e owner
task-regions m s e owner h with failed (get-region (taskRegions s) owner)
...   | true = refl
...   | false with localStep m (get-region (taskRegions s) owner) e
...     | localContradiction = refl
...     | localOk next with sharedStep m (taskRegions s) (sharedState s) e
...       | sharedContradiction = bottom-elim (true-not-false h)
...       | sharedOk nextShared = refl

active-regions : (m : Semantics) (s : State) (e : Event) ->
  runFailed (sharedState (step-active m s e)) == false ->
  taskRegions (step-active m s e) == local-only-step m (taskRegions s) e
active-regions m s e h with task-of e
... | nothing = shared-regions s (sharedStep m (taskRegions s) (sharedState s) e) h
... | just owner = task-regions m s e owner h

step-regions : (m : Semantics) (s : State) (e : Event) ->
  LiveStep m s e -> taskRegions (step m s e) == local-only-step m (taskRegions s) e
step-regions m s e (live runLive runOpen nextLive) rewrite runLive | runOpen =
  active-regions m s e nextLive

data SharedValid (m : Semantics) : State -> List Event -> Set where
  validNil : {s : State} -> SharedValid m s []
  validCons : {s : State} {e : Event} {rest : List Event} ->
    LiveStep m s e -> SharedValid m (step m s e) rest -> SharedValid m s (e :: rest)

-- P3: if no shared step contradicts, both task regions in the full fold are
-- exactly the local-only fold. A local contradiction is allowed and freezes
-- only its named region; the other region continues.
regional-from : (m : Semantics) (s : State) (events : List Event) ->
  SharedValid m s events ->
  taskRegions (fold-from m s events) == fold-regions-from m (taskRegions s) events
regional-from m s [] validNil = refl
regional-from m s (e :: rest) (validCons headLive tailValid) =
  trans (regional-from m (step m s e) rest tailValid)
    (cong (\ rs -> fold-regions-from m rs rest) (step-regions m s e headLive))

regional : (m : Semantics) (events : List Event) -> SharedValid m initial-state events ->
  taskRegions (fold m events) == fold-regions m events
regional m events valid = regional-from m initial-state events valid

-- The universal kernel is instantiated by the concrete port above, so these
-- are statements about all 23 guards/effects rather than an opaque witness.
concrete-homomorphism : (p q : List Event) ->
  fold concrete (p ++ q) == fold-from concrete (fold concrete p) q
concrete-homomorphism = homomorphism concrete

concrete-regional : (events : List Event) -> SharedValid concrete initial-state events ->
  taskRegions (fold concrete events) == fold-regions concrete events
concrete-regional = regional concrete

-- P4: all definitions are total and pure, and Semantics exposes no clock,
-- entropy, heap, or iteration-order input.

-- Directed witnesses keep the universal laws non-vacuous.
witness-local : Region -> Event -> LocalOutcome
witness-local r (act (workAdmitted _ _)) with attemptId r
... | nothing = localContradiction
... | just _ = localOk (region 3 (attempts r) (expectedHead r) (attemptId r)
    (runId r) (claimToken r) (claimPending r) (worktreePending r)
    (promotionPending r) (failed r) (retentionReason r))
witness-local r (act (claimIntentRecorded _ token)) =
  localOk (region 1 (attempts r) (expectedHead r) (attemptId r) (runId r)
    (just token) true (worktreePending r) (promotionPending r) (failed r)
    (retentionReason r))
witness-local r (act (attemptPlanned _ rid aid)) =
  localOk (region 2 (attempts r) (expectedHead r) (just aid) (just rid)
    (claimToken r) (claimPending r) (worktreePending r) (promotionPending r)
    (failed r) (retentionReason r))
witness-local r _ = localOk r

witness-shared : Regions -> Shared -> Event -> SharedOutcome
witness-shared _ sh (act (workflowRunTerminated _)) =
  sharedOk (record sh { runTerminated = true })
witness-shared _ sh _ = sharedOk sh

witness : Semantics
witness = record { localStep = witness-local ; sharedStep = witness-shared }

intent-prefix : List Event
intent-prefix = act (claimIntentRecorded a 7) :: []

intent-outcome : List Event
intent-outcome = occ (claimRecordRead a 0 7) :: []

intent-is-pending : claimPending (get-region (taskRegions (fold witness intent-prefix)) a) == true
intent-is-pending = refl

intent-replay : fold witness (intent-prefix ++ intent-outcome) ==
  fold-from witness (fold witness intent-prefix) intent-outcome
intent-replay = homomorphism witness intent-prefix intent-outcome

local-trace : List Event
local-trace = act (workAdmitted a 3) ::
  act (claimIntentRecorded b 9) ::
  act (attemptPlanned b 0 3) ::
  act (workAdmitted b 3) :: []

task-a-failed : failed (get-region (taskRegions (fold witness local-trace)) a) == true
task-a-failed = refl

task-b-progressed : phase (get-region (taskRegions (fold witness local-trace)) b) == 3
task-b-progressed = refl

local-trace-valid : SharedValid witness initial-state local-trace
local-trace-valid = validCons (live refl refl refl)
  (validCons (live refl refl refl)
    (validCons (live refl refl refl) (validCons (live refl refl refl) validNil)))

both-regions-project : taskRegions (fold witness local-trace) == fold-regions witness local-trace
both-regions-project = regional witness local-trace local-trace-valid

-- Directed witnesses through the concrete 23-event instance.
concrete-intent-prefix : List Event
concrete-intent-prefix =
  occ (trackerFactsObserved (a :: []) (fact a true true :: []) true 0) ::
  act (claimIntentRecorded a 7) :: []

concrete-intent-pending :
  claimPending (get-region (taskRegions (fold concrete concrete-intent-prefix)) a) == true
concrete-intent-pending = refl

concrete-local-trace : List Event
concrete-local-trace =
  act (capacityRevised 2) ::
  occ (trackerFactsObserved (a :: b :: [])
    (fact a true true :: fact b true true :: []) true 0) ::
  act (workAdmitted a 3) ::
  act (claimIntentRecorded b 9) ::
  act (attemptPlanned b 0 3) ::
  act (workAdmitted b 3) :: []

concrete-task-a-failed :
  failed (get-region (taskRegions (fold concrete concrete-local-trace)) a) == true
concrete-task-a-failed = refl

concrete-task-b-progressed :
  phase (get-region (taskRegions (fold concrete concrete-local-trace)) b) == 3
concrete-task-b-progressed = refl

concrete-local-trace-valid : SharedValid concrete initial-state concrete-local-trace
concrete-local-trace-valid =
  validCons (live refl refl refl)
    (validCons (live refl refl refl)
      (validCons (live refl refl refl)
        (validCons (live refl refl refl)
          (validCons (live refl refl refl)
            (validCons (live refl refl refl) validNil)))))

concrete-both-regions-project :
  taskRegions (fold concrete concrete-local-trace) ==
    fold-regions concrete concrete-local-trace
concrete-both-regions-project =
  concrete-regional concrete-local-trace concrete-local-trace-valid
