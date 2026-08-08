/*
 * The concrete journal semantics and journal-law kernel in Dafny.
 *
 * The executable 23-event delivery model remains ../fastcheck/journal.mjs.
 * This file proves the fold algebra for every pair of total local/shared
 * functions carried by Semantics, then instantiates it with all 23 concrete
 * guards and effects in ConcreteLocal/ConcreteShared. Their arrow types are
 * the proof boundary: local code receives one Region; shared code may inspect
 * Regions but can return only Shared Run state.
 *
 * Deliberate specialization: as in the current bounded benchmark and the Agda
 * arm, Task has two inhabitants. Lean quantifies over arbitrary natural task
 * identifiers. Journal length and payloads remain unbounded here. This file
 * is a separately authored port rather than a machine-checked translation of
 * the JavaScript oracle; ../LEARNING.md records that boundary explicitly.
 */

datatype Task = A | B
datatype Option<T> = None | Some(value: T)
datatype Direction = Pause | Unpause
datatype IneligibleReason = MissingFromTargetClosure | NotOpen | PrerequisitesUnsatisfied
datatype WorktreeOutcome = Created | AlreadyPresent | Absent
datatype Report = Running | SafelySuspended | Terminal(result: nat)
datatype RetentionReason = CorrectionLimitExhausted | ContinuationLimitExhausted | StaleTargetHead

datatype Fact = Fact(subject: Task, present: bool, isOpen: bool)

// Adding an action must make TaskOfAction incomplete until it is classified.
datatype Action =
  ClaimIntentRecorded(task: Task, token: nat)
| ClaimReleaseIntentRecorded(task: Task, token: nat)
| AttemptPlanned(task: Task, runId: nat, attemptId: nat)
| WorkAdmitted(task: Task, attemptId: nat)
| SuspensionRequested(task: Task, attemptId: nat)
| ResumeRequested(task: Task, attemptId: nat)
| WorktreeIntentRecorded(task: Task, attemptId: nat)
| IntegrationSessionOpened(task: Task, expectedHead: nat)
| PromotionIntentRecorded(task: Task, expectedHead: nat)
| CandidateConstructionNonConvergent(task: Task, reason: RetentionReason)
| DeliverySettled(task: Task)
| WorkflowRunBegun(runId: nat, target: nat)
| WorkflowRunTerminated(runId: nat)
| CapacityRevised(capacity: nat)
| DirectionApplied(subject: nat, direction: Direction)

datatype Occurrence =
  TrackerFactsObserved(subjects: seq<Task>, facts: seq<Fact>, complete: bool, contentIdentity: nat)
| ClaimRecordRead(task: Task, owner: nat, token: nat)
| ClaimedTaskEligibilityObserved(task: Task, revision: nat)
| ClaimedTaskIneligible(task: Task, reason: IneligibleReason)
| WorktreeReconciliationObserved(task: Task, attemptId: nat, outcome: WorktreeOutcome)
| ExecutorReported(task: Task, attemptId: nat, report: Report)
| PromotionOutcomeObserved(task: Task, head: nat)
| TargetHeadObserved(head: nat)

datatype Event = Act(action: Action) | Occ(occurrence: Occurrence)

function TaskOfAction(action: Action): Option<Task>
{
  match action
  case ClaimIntentRecorded(task, _) => Some(task)
  case ClaimReleaseIntentRecorded(task, _) => Some(task)
  case AttemptPlanned(task, _, _) => Some(task)
  case WorkAdmitted(task, _) => Some(task)
  case SuspensionRequested(task, _) => Some(task)
  case ResumeRequested(task, _) => Some(task)
  case WorktreeIntentRecorded(task, _) => Some(task)
  case IntegrationSessionOpened(task, _) => Some(task)
  case PromotionIntentRecorded(task, _) => Some(task)
  case CandidateConstructionNonConvergent(task, _) => Some(task)
  case DeliverySettled(task) => Some(task)
  case WorkflowRunBegun(_, _) => None
  case WorkflowRunTerminated(_) => None
  case CapacityRevised(_) => None
  case DirectionApplied(_, _) => None
}

function TaskOfOccurrence(occurrence: Occurrence): Option<Task>
{
  match occurrence
  case TrackerFactsObserved(_, _, _, _) => None
  case ClaimRecordRead(task, _, _) => Some(task)
  case ClaimedTaskEligibilityObserved(task, _) => Some(task)
  case ClaimedTaskIneligible(task, _) => Some(task)
  case WorktreeReconciliationObserved(task, _, _) => Some(task)
  case ExecutorReported(task, _, _) => Some(task)
  case PromotionOutcomeObserved(task, _) => Some(task)
  case TargetHeadObserved(_) => None
}

function TaskOf(event: Event): Option<Task>
{
  match event
  case Act(action) => TaskOfAction(action)
  case Occ(occurrence) => TaskOfOccurrence(occurrence)
}

datatype Region = Region(
  phase: nat,
  attempts: nat,
  expectedHead: nat,
  attemptId: Option<nat>,
  runId: Option<nat>,
  claimToken: Option<nat>,
  claimPending: bool,
  worktreePending: bool,
  promotionPending: bool,
  failed: bool,
  retentionReason: Option<RetentionReason>)

function InitialRegion(): Region
{
  Region(0, 0, 0, None, None, None, false, false, false, false, None)
}

function FailedRegion(region: Region): Region
{
  Region(region.phase, region.attempts, region.expectedHead, region.attemptId,
    region.runId, region.claimToken, region.claimPending,
    region.worktreePending, region.promotionPending, true,
    region.retentionReason)
}

datatype Regions = Regions(a: Region, b: Region)

function GetRegion(regions: Regions, task: Task): Region
{
  match task case A => regions.a case B => regions.b
}

function SetRegion(regions: Regions, task: Task, value: Region): Regions
{
  match task
  case A => Regions(value, regions.b)
  case B => Regions(regions.a, value)
}

datatype Observation = Observation(subjects: seq<Task>, facts: seq<Fact>, complete: bool)

datatype Shared = Shared(
  capacity: nat,
  positions: seq<Task>,
  paused: bool,
  targetResource: seq<Task>,
  targetHead: nat,
  runBegun: bool,
  runId: Option<nat>,
  runTarget: Option<nat>,
  runFailed: bool,
  runTerminated: bool,
  presentA: bool,
  openA: bool,
  presentB: bool,
  openB: bool,
  seen: map<nat, Observation>)
datatype State = State(regions: Regions, shared: Shared)

function InitialRegions(): Regions
{
  Regions(InitialRegion(), InitialRegion())
}

function InitialState(): State
{
  State(InitialRegions(), Shared(1, [], false, [], 0, false, None, None,
    false, false, false, false, false, false, map[]))
}

function FailRun(state: State): State
{
  State(state.regions, state.shared.(runFailed := true))
}

datatype LocalOutcome = LocalContradiction | LocalOk(next: Region)
datatype SharedOutcome = SharedContradiction | SharedOk(next: Shared)

datatype Semantics = Semantics(
  localStep: (Region, Event) -> LocalOutcome,
  sharedStep: (Regions, Shared, Event) -> SharedOutcome)

function LocalOnlyStep(model: Semantics, regions: Regions, event: Event): Regions
{
  match TaskOf(event)
  case None => regions
  case Some(owner) =>
    var current := GetRegion(regions, owner);
    if current.failed then regions
    else match model.localStep(current, event)
      case LocalContradiction => SetRegion(regions, owner, FailedRegion(current))
      case LocalOk(next) => SetRegion(regions, owner, next)
}

function ApplyShared(state: State, outcome: SharedOutcome): State
{
  match outcome
  case SharedContradiction => FailRun(state)
  case SharedOk(next) => State(state.regions, next)
}

function StepTask(model: Semantics, state: State, event: Event, owner: Task): State
{
  var current := GetRegion(state.regions, owner);
  if current.failed then state
  else match model.localStep(current, event)
    case LocalContradiction =>
      State(SetRegion(state.regions, owner, FailedRegion(current)), state.shared)
    case LocalOk(nextRegion) =>
      match model.sharedStep(state.regions, state.shared, event)
      case SharedContradiction => FailRun(state)
      case SharedOk(nextShared) =>
        State(SetRegion(state.regions, owner, nextRegion), nextShared)
}

function StepActive(model: Semantics, state: State, event: Event): State
{
  match TaskOf(event)
  case None => ApplyShared(state, model.sharedStep(state.regions, state.shared, event))
  case Some(owner) => StepTask(model, state, event, owner)
}

function Step(model: Semantics, state: State, event: Event): State
{
  if state.shared.runFailed then state
  else if state.shared.runTerminated then FailRun(state)
  else StepActive(model, state, event)
}

function FoldFrom(model: Semantics, state: State, events: seq<Event>): State
  decreases |events|
{
  if |events| == 0 then state
  else FoldFrom(model, Step(model, state, events[0]), events[1..])
}

function Fold(model: Semantics, events: seq<Event>): State
{
  FoldFrom(model, InitialState(), events)
}

function FoldRegionsFrom(model: Semantics, regions: Regions, events: seq<Event>): Regions
  decreases |events|
{
  if |events| == 0 then regions
  else FoldRegionsFrom(model, LocalOnlyStep(model, regions, events[0]), events[1..])
}

function FoldRegions(model: Semantics, events: seq<Event>): Regions
{
  FoldRegionsFrom(model, InitialRegions(), events)
}

/*
 * P1, prefix-totality. FoldFrom has no precondition, its match expressions are
 * exhaustive, and its explicit decreases measure proves termination. A
 * contradiction returns a sticky value rather than throwing. Dafny's total
 * arrow fields prevent a Semantics value from supplying partial functions.
 */
lemma PrefixTotality(model: Semantics, events: seq<Event>)
  ensures Fold(model, events) == Fold(model, events)
{
  // The useful obligation is that this declaration verifies without a
  // requires clause; the reflexive postcondition only gives the checker a
  // concrete call site for every sequence.
}

/* P2: an explicit induction and slice identity, rather than Lean's library
 * theorem. Reconstructing a prefix and replaying the suffix equals folding
 * the concatenation. */
lemma FoldFromAppend(model: Semantics, state: State, p: seq<Event>, q: seq<Event>)
  ensures FoldFrom(model, state, p + q) ==
    FoldFrom(model, FoldFrom(model, state, p), q)
  decreases |p|
{
  if |p| > 0 {
    assert |p + q| > 0;
    assert (p + q)[0] == p[0];
    assert (p + q)[1..] == p[1..] + q;
    FoldFromAppend(model, Step(model, state, p[0]), p[1..], q);
  } else {
    assert p == [];
    assert p + q == q;
    assert FoldFrom(model, state, p) == state;
  }
}

lemma Homomorphism(model: Semantics, p: seq<Event>, q: seq<Event>)
  ensures Fold(model, p + q) == FoldFrom(model, Fold(model, p), q)
{
  FoldFromAppend(model, InitialState(), p, q);
}

predicate LiveStep(model: Semantics, state: State, event: Event)
{
  !state.shared.runFailed && !state.shared.runTerminated &&
  !StepActive(model, state, event).shared.runFailed
}

lemma StepRegions(model: Semantics, state: State, event: Event)
  requires LiveStep(model, state, event)
  ensures Step(model, state, event).regions ==
    LocalOnlyStep(model, state.regions, event)
{
  var ownerOption := TaskOf(event);
  if ownerOption.None? {
    var sharedOutcome := model.sharedStep(state.regions, state.shared, event);
    if sharedOutcome.SharedContradiction? {
      assert false;
    }
  } else {
    var owner := ownerOption.value;
    var current := GetRegion(state.regions, owner);
    if !current.failed {
      var localOutcome := model.localStep(current, event);
      if localOutcome.LocalOk? {
        var sharedOutcome := model.sharedStep(state.regions, state.shared, event);
        if sharedOutcome.SharedContradiction? {
          assert false;
        }
      }
    }
  }
}

predicate SharedValid(model: Semantics, state: State, events: seq<Event>)
  decreases |events|
{
  |events| == 0 ||
  (LiveStep(model, state, events[0]) &&
   SharedValid(model, Step(model, state, events[0]), events[1..]))
}

/* P3: task-local contradiction is permitted inside SharedValid. It freezes
 * only its named Region. Both regions in the full fold equal the local-only
 * fold; a shared contradiction has no SharedValid continuation and the full
 * step records Run failure. */
lemma RegionalFrom(model: Semantics, state: State, events: seq<Event>)
  requires SharedValid(model, state, events)
  ensures FoldFrom(model, state, events).regions ==
    FoldRegionsFrom(model, state.regions, events)
  decreases |events|
{
  if |events| > 0 {
    var event := events[0];
    var next := Step(model, state, event);
    StepRegions(model, state, event);
    RegionalFrom(model, next, events[1..]);
  }
}

lemma Regional(model: Semantics, events: seq<Event>)
  requires SharedValid(model, InitialState(), events)
  ensures Fold(model, events).regions == FoldRegions(model, events)
{
  RegionalFrom(model, InitialState(), events);
}

/* P4 is by construction: all folds are pure functions and Semantics supplies
 * only total function values. No heap, clock, entropy, or iteration order is
 * available through this proof boundary. */

predicate Correlates(region: Region, attemptId: nat)
{
  region.attemptId == Some(attemptId)
}

function LocalResult(guard: bool, next: Region): LocalOutcome
{
  if guard then LocalOk(next) else LocalContradiction
}

function ClaimReadNext(region: Region, token: nat): Region
{
  if region.claimToken == Some(token)
  then region.(claimPending := false)
  else region.(phase := 0, claimToken := None, claimPending := false)
}

function PromotionNext(region: Region, head: nat): Region
{
  if head == region.expectedHead
  then region.(phase := 8, promotionPending := false)
  else region.(promotionPending := false)
}

/* The task-local half of journal.mjs, guard for guard and update for update.
 * Phase numerals are the PHASES array indices: NoObligation=0 through
 * Settled=10. Alphabet-only checks disappear into datatypes. */
function ConcreteLocal(region: Region, event: Event): LocalOutcome
{
  match event
  case Act(ClaimIntentRecorded(_, token)) =>
    LocalResult(region.phase == 0,
      region.(phase := 1, claimToken := Some(token), claimPending := true))
  case Act(ClaimReleaseIntentRecorded(_, token)) =>
    LocalResult(region.phase == 1 && region.claimToken == Some(token),
      region.(phase := 0, claimToken := None, claimPending := false))
  case Occ(ClaimRecordRead(_, _, token)) =>
    LocalResult(region.claimPending &&
      (region.claimToken == Some(token) || region.phase == 1), ClaimReadNext(region, token))
  case Occ(ClaimedTaskEligibilityObserved(_, _)) => LocalResult(region.phase == 1, region)
  case Occ(ClaimedTaskIneligible(_, _)) => LocalResult(region.phase == 1, region)
  case Act(AttemptPlanned(_, runId, attemptId)) =>
    LocalResult(region.phase == 1 && region.attempts == 0,
      region.(phase := 2, attempts := region.attempts + 1,
        attemptId := Some(attemptId), runId := Some(runId)))
  case Act(WorkAdmitted(_, attemptId)) =>
    LocalResult(region.phase == 2 && Correlates(region, attemptId), region.(phase := 3))
  case Act(SuspensionRequested(_, attemptId)) =>
    LocalResult(region.phase == 3 && Correlates(region, attemptId), region.(phase := 4))
  case Act(ResumeRequested(_, attemptId)) =>
    LocalResult(region.phase == 5 && Correlates(region, attemptId), region.(phase := 3))
  case Act(WorktreeIntentRecorded(_, attemptId)) =>
    LocalResult(region.phase == 2 && Correlates(region, attemptId) && !region.worktreePending,
      region.(worktreePending := true))
  case Occ(WorktreeReconciliationObserved(_, attemptId, _)) =>
    LocalResult(region.worktreePending && Correlates(region, attemptId),
      region.(worktreePending := false))
  case Occ(ExecutorReported(_, attemptId, Running)) =>
    LocalResult((region.phase == 3 || region.phase == 4) && Correlates(region, attemptId), region)
  case Occ(ExecutorReported(_, attemptId, SafelySuspended)) =>
    LocalResult(region.phase == 4 && Correlates(region, attemptId), region.(phase := 5))
  case Occ(ExecutorReported(_, attemptId, Terminal(_))) =>
    LocalResult(region.phase == 3 && Correlates(region, attemptId), region.(phase := 6))
  case Act(IntegrationSessionOpened(_, expectedHead)) =>
    LocalResult(region.phase == 6, region.(phase := 7, expectedHead := expectedHead))
  case Act(PromotionIntentRecorded(_, expectedHead)) =>
    LocalResult(region.phase == 7 && region.expectedHead == expectedHead && !region.promotionPending,
      region.(promotionPending := true))
  case Occ(PromotionOutcomeObserved(_, head)) =>
    LocalResult(region.phase == 7 && region.promotionPending, PromotionNext(region, head))
  case Act(CandidateConstructionNonConvergent(_, reason)) =>
    LocalResult(region.phase == 7, region.(phase := 9, retentionReason := Some(reason)))
  case Act(DeliverySettled(_)) => LocalResult(region.phase == 8, region.(phase := 10))
  case Act(WorkflowRunBegun(_, _)) => LocalOk(region)
  case Act(WorkflowRunTerminated(_)) => LocalOk(region)
  case Act(CapacityRevised(_)) => LocalOk(region)
  case Act(DirectionApplied(_, _)) => LocalOk(region)
  case Occ(TrackerFactsObserved(_, _, _, _)) => LocalOk(region)
  case Occ(TargetHeadObserved(_)) => LocalOk(region)
}

function RemoveTask(tasks: seq<Task>, task: Task): seq<Task>
  decreases |tasks|
{
  if |tasks| == 0 then []
  else (if tasks[0] == task then [] else [tasks[0]]) + RemoveTask(tasks[1..], task)
}

predicate Eligible(shared: Shared, task: Task)
{
  match task
  case A => shared.presentA && shared.openA
  case B => shared.presentB && shared.openB
}

function EligibleBelow(shared: Shared, task: Task): nat
{
  match task
  case A => 0
  case B => if Eligible(shared, A) then 1 else 0
}

predicate Selected(shared: Shared, task: Task)
{
  Eligible(shared, task) && EligibleBelow(shared, task) < shared.capacity
}

function ApplyFact(shared: Shared, fact: Fact): Shared
{
  match fact.subject
  case A => shared.(presentA := fact.present, openA := fact.isOpen)
  case B => shared.(presentB := fact.present, openB := fact.isOpen)
}

function ApplyFacts(shared: Shared, facts: seq<Fact>): Shared
  decreases |facts|
{
  if |facts| == 0 then shared
  else ApplyFacts(ApplyFact(shared, facts[0]), facts[1..])
}

function MarkUnobserved(shared: Shared, subjects: seq<Task>): Shared
{
  shared.(
    presentA := if A in subjects then shared.presentA else false,
    openA := if A in subjects then shared.openA else false,
    presentB := if B in subjects then shared.presentB else false,
    openB := if B in subjects then shared.openB else false)
}

function Observe(shared: Shared, subjects: seq<Task>, facts: seq<Fact>,
    complete: bool, key: nat): SharedOutcome
{
  var value := Observation(subjects, facts, complete);
  if key in shared.seen && shared.seen[key] != value then SharedContradiction
  else
    var next := ApplyFacts(shared, facts).(seen := shared.seen[key := value]);
    SharedOk(if complete then MarkUnobserved(next, subjects) else next)
}

function SharedResult(guard: bool, next: Shared): SharedOutcome
{
  if guard then SharedOk(next) else SharedContradiction
}

/* The shared half of journal.mjs. It may read regions for the captured-head
 * checks, but its result type cannot rewrite them; that is exactly the seam
 * used by Regional. */
function ConcreteShared(regions: Regions, shared: Shared, event: Event): SharedOutcome
{
  match event
  case Act(ClaimIntentRecorded(task, _)) => SharedResult(Selected(shared, task), shared)
  case Act(AttemptPlanned(_, runId, _)) =>
    SharedResult(!shared.runBegun || shared.runId == Some(runId), shared)
  case Act(WorkAdmitted(task, _)) =>
    SharedResult(!shared.paused && |shared.positions| < shared.capacity,
      shared.(positions := shared.positions + [task]))
  case Act(ResumeRequested(task, _)) =>
    SharedResult(!shared.paused && |shared.positions| < shared.capacity,
      shared.(positions := shared.positions + [task]))
  case Occ(ExecutorReported(task, _, SafelySuspended)) =>
    SharedOk(shared.(positions := RemoveTask(shared.positions, task)))
  case Occ(ExecutorReported(task, _, Terminal(_))) =>
    SharedOk(shared.(positions := RemoveTask(shared.positions, task)))
  case Act(IntegrationSessionOpened(task, expectedHead)) =>
    SharedResult(|shared.targetResource| == 0 && expectedHead == shared.targetHead,
      shared.(targetResource := [task]))
  case Occ(PromotionOutcomeObserved(task, head)) =>
    var expected := GetRegion(regions, task).expectedHead;
    if head != expected then SharedOk(shared)
    else SharedResult(head == shared.targetHead && shared.targetHead < 4,
      shared.(targetHead := shared.targetHead + 1, targetResource := []))
  case Act(CandidateConstructionNonConvergent(task, StaleTargetHead)) =>
    SharedResult(GetRegion(regions, task).expectedHead != shared.targetHead,
      shared.(targetResource := RemoveTask(shared.targetResource, task)))
  case Act(CandidateConstructionNonConvergent(task, _)) =>
    SharedOk(shared.(targetResource := RemoveTask(shared.targetResource, task)))
  case Occ(TrackerFactsObserved(subjects, facts, complete, key)) =>
    Observe(shared, subjects, facts, complete, key)
  case Occ(TargetHeadObserved(head)) =>
    SharedResult(head == shared.targetHead + 1 && head <= 4, shared.(targetHead := head))
  case Act(CapacityRevised(capacity)) =>
    SharedResult(capacity <= 2 && capacity != shared.capacity, shared.(capacity := capacity))
  case Act(DirectionApplied(_, Pause)) => SharedResult(!shared.paused, shared.(paused := true))
  case Act(DirectionApplied(_, Unpause)) => SharedResult(shared.paused, shared.(paused := false))
  case Act(WorkflowRunBegun(runId, target)) =>
    SharedResult(!shared.runBegun,
      shared.(runBegun := true, runId := Some(runId), runTarget := Some(target)))
  case Act(WorkflowRunTerminated(runId)) =>
    SharedResult(shared.runBegun && !shared.runTerminated && shared.runId == Some(runId),
      shared.(runTerminated := true))
  case Act(ClaimReleaseIntentRecorded(_, _)) => SharedOk(shared)
  case Act(SuspensionRequested(_, _)) => SharedOk(shared)
  case Act(WorktreeIntentRecorded(_, _)) => SharedOk(shared)
  case Act(PromotionIntentRecorded(_, _)) => SharedOk(shared)
  case Act(DeliverySettled(_)) => SharedOk(shared)
  case Occ(ClaimRecordRead(_, _, _)) => SharedOk(shared)
  case Occ(ClaimedTaskEligibilityObserved(_, _)) => SharedOk(shared)
  case Occ(ClaimedTaskIneligible(_, _)) => SharedOk(shared)
  case Occ(WorktreeReconciliationObserved(_, _, _)) => SharedOk(shared)
  case Occ(ExecutorReported(_, _, Running)) => SharedOk(shared)
}

function Concrete(): Semantics
{
  Semantics(ConcreteLocal, ConcreteShared)
}

lemma ConcreteHomomorphism(p: seq<Event>, q: seq<Event>)
  ensures Fold(Concrete(), p + q) == FoldFrom(Concrete(), Fold(Concrete(), p), q)
{
  Homomorphism(Concrete(), p, q);
}

lemma ConcreteRegional(events: seq<Event>)
  requires SharedValid(Concrete(), InitialState(), events)
  ensures Fold(Concrete(), events).regions == FoldRegions(Concrete(), events)
{
  Regional(Concrete(), events);
}

function WitnessLocal(region: Region, event: Event): LocalOutcome
{
  match event
  case Act(WorkAdmitted(_, _)) =>
    if region.attemptId.None? then LocalContradiction
    else LocalOk(Region(3, region.attempts, region.expectedHead,
      region.attemptId, region.runId, region.claimToken, region.claimPending,
      region.worktreePending, region.promotionPending, region.failed,
      region.retentionReason))
  case Act(ClaimIntentRecorded(_, token)) =>
    LocalOk(Region(1, region.attempts, region.expectedHead,
      region.attemptId, region.runId, Some(token), true,
      region.worktreePending, region.promotionPending, region.failed,
      region.retentionReason))
  case Act(AttemptPlanned(_, runId, attemptId)) =>
    LocalOk(Region(2, region.attempts, region.expectedHead,
      Some(attemptId), Some(runId), region.claimToken, region.claimPending,
      region.worktreePending, region.promotionPending, region.failed,
      region.retentionReason))
  case _ => LocalOk(region)
}

function WitnessShared(regions: Regions, shared: Shared, event: Event): SharedOutcome
{
  match event
  case Act(WorkflowRunTerminated(_)) => SharedOk(shared.(runTerminated := true))
  case _ => SharedOk(shared)
}

function WitnessSemantics(): Semantics
{
  Semantics(WitnessLocal, WitnessShared)
}

lemma Witnesses()
{
  var model := WitnessSemantics();
  var prefix := [Act(ClaimIntentRecorded(A, 7))];
  var outcome := [Occ(ClaimRecordRead(A, 0, 7))];
  assert GetRegion(Fold(model, prefix).regions, A).claimPending;
  Homomorphism(model, prefix, outcome);
  assert Fold(model, prefix + outcome) == FoldFrom(model, Fold(model, prefix), outcome);

  var localTrace := [
    Act(WorkAdmitted(A, 3)),
    Act(ClaimIntentRecorded(B, 9)),
    Act(AttemptPlanned(B, 0, 3)),
    Act(WorkAdmitted(B, 3))
  ];
  assert SharedValid(model, InitialState(), localTrace);
  assert GetRegion(Fold(model, localTrace).regions, A).failed;
  assert GetRegion(Fold(model, localTrace).regions, B).phase == 3;
  Regional(model, localTrace);
  assert Fold(model, localTrace).regions == FoldRegions(model, localTrace);
}

lemma ConcreteWitnesses()
{
  var model := Concrete();
  var intentPrefix := [
    Occ(TrackerFactsObserved([A], [Fact(A, true, true)], true, 0)),
    Act(ClaimIntentRecorded(A, 7))
  ];
  assert GetRegion(Fold(model, intentPrefix).regions, A).claimPending;

  var localTrace := [
    Act(CapacityRevised(2)),
    Occ(TrackerFactsObserved([A, B],
      [Fact(A, true, true), Fact(B, true, true)], true, 0)),
    Act(WorkAdmitted(A, 3)),
    Act(ClaimIntentRecorded(B, 9)),
    Act(AttemptPlanned(B, 0, 3)),
    Act(WorkAdmitted(B, 3))
  ];
  assert SharedValid(model, InitialState(), localTrace);
  assert GetRegion(Fold(model, localTrace).regions, A).failed;
  assert GetRegion(Fold(model, localTrace).regions, B).phase == 3;
  ConcreteRegional(localTrace);
  assert Fold(model, localTrace).regions == FoldRegions(model, localTrace);
}
