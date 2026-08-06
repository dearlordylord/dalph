/*
 * L2 of ../INVARIANTS.md in Dafny: the delivery protocol as a class whose
 * mutable state is constrained by a class invariant, with each action a method
 * that must re-establish it.
 *
 * This is a genuinely different shape from the other L2 encodings, and it sits
 * at an interesting point on the axis they span:
 *
 *   TLC        you supply the invariant, it discovers the reachable set
 *   Alloy      you supply the invariant, it tells you whether it is inductive
 *   Lean/Agda  you supply an *inductive* invariant and prove every case by hand
 *   Dafny      you supply an *inductive* invariant and SMT proves every case
 *
 * So Dafny asks the same thing of you as a proof assistant -- `Valid()` must
 * already be inductive -- while discharging the cases automatically like a
 * checker. `requires Valid() ... ensures Valid()` on every method *is* the
 * induction, one method at a time.
 *
 * See ./DeliveryL2Mutants.dfy for what happens when the invariant is not
 * inductive.
 */

datatype Phase =
  | NoObligation
  | Claimed
  | Planned
  | Executing
  | SuspensionRequested
  | Suspended
  | Accepted
  | Integrating
  | Promoted
  | Settled

datatype Option<T> = None | Some(value: T)

datatype Ticket = Ticket(phase: Phase, attempts: nat, present: bool, isOpen: bool, expectedHead: nat)

predicate HoldsPosition(p: Phase)
{
  p == Executing || p == SuspensionRequested
}

class Delivery {
  var tickets: map<nat, Ticket>
  var capacity: nat
  var holds: set<nat>
  var paused: bool
  var target: Option<nat>
  var head: nat
  var crashed: bool

  const Tasks: set<nat> := {0, 1}

  /* The class invariant. Every method requires and ensures it, so this is the
   * inductive invariant of ../MODEL.md, and Dafny checks preservation for each
   * action separately rather than over a reachable set. */
  ghost predicate Valid()
    reads this
  {
    // well-formedness
    && (forall t :: t in Tasks ==> t in tickets)
    && holds <= Tasks
    && (target.Some? ==> target.value in Tasks)

    // I7
    && (crashed || holds == set t | t in Tasks && HoldsPosition(tickets[t].phase))

    // I14
    && (!crashed || (holds == {} && target.None?))

    // I10
    && (forall t :: t in Tasks ==> tickets[t].attempts <= 1)

    // The strengthening. Without this clause PlanAttempt below does not
    // verify, for exactly the reason the Lean and Agda proofs get stuck and
    // the Alloy inductiveness check returns SAT.
    && (forall t :: t in Tasks && (tickets[t].phase == NoObligation || tickets[t].phase == Claimed)
          ==> tickets[t].attempts == 0)

    // I12/I14
    && (target.Some? ==> tickets[target.value].phase == Integrating)
  }

  constructor()
    ensures Valid()
    ensures forall t :: t in Tasks ==> tickets[t].phase == NoObligation
    ensures capacity == 1 && head == 0 && !crashed && !paused
  {
    // A literal rather than a comprehension: `map t | t in {0,1} :: ...`
    // gives Dafny no trigger and it warns about brittle verification.
    tickets := map[0 := Ticket(NoObligation, 0, false, false, 0),
                   1 := Ticket(NoObligation, 0, false, false, 0)];
    capacity := 1;
    holds := {};
    paused := false;
    target := None;
    head := 0;
    crashed := false;
  }

  method ObserveGraph(t: nat, p: bool, o: bool)
    requires Valid() && t in Tasks
    modifies this
    ensures Valid()
    ensures tickets[t].phase == old(tickets[t].phase)
    ensures tickets[t].attempts == old(tickets[t].attempts)
    ensures holds == old(holds) && capacity == old(capacity)
    ensures crashed == old(crashed) && paused == old(paused)
    ensures head == old(head) && target == old(target)
  {
    tickets := tickets[t := tickets[t].(present := p, isOpen := o)];
  }

  method AcquireClaim(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == NoObligation
    modifies this
    ensures Valid()
    ensures tickets[t].phase == Claimed
    ensures tickets[t].attempts == old(tickets[t].attempts)
    ensures holds == old(holds) && capacity == old(capacity)
    ensures crashed == old(crashed) && paused == old(paused)
    ensures head == old(head) && target == old(target)
  {
    tickets := tickets[t := tickets[t].(phase := Claimed)];
  }

  method PlanAttempt(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Claimed
    modifies this
    ensures Valid()
    ensures tickets[t].phase == Planned
    ensures tickets[t].attempts == old(tickets[t].attempts) + 1
    ensures holds == old(holds) && capacity == old(capacity)
    ensures crashed == old(crashed) && paused == old(paused)
    ensures head == old(head) && target == old(target)
  {
    // Here is where the strengthening is consumed: Valid() gives
    // attempts == 0 from phase == Claimed, so the increment lands on 1.
    tickets := tickets[t := tickets[t].(phase := Planned, attempts := tickets[t].attempts + 1)];
  }

  method BeginWork(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && !paused && tickets[t].phase == Planned
    requires |holds| < capacity
    modifies this
    ensures Valid()
    ensures tickets[t].phase == Executing && t in holds
    ensures tickets[t].attempts == old(tickets[t].attempts)
    ensures crashed == old(crashed) && paused == old(paused)
    ensures head == old(head) && target == old(target)
  {
    tickets := tickets[t := tickets[t].(phase := Executing)];
    holds := holds + {t};
  }

  method RequestSuspension(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Executing
    modifies this
    ensures Valid()
  {
    tickets := tickets[t := tickets[t].(phase := SuspensionRequested)];
  }

  method SafelySuspend(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == SuspensionRequested
    modifies this
    ensures Valid()
  {
    tickets := tickets[t := tickets[t].(phase := Suspended)];
    holds := holds - {t};
  }

  method ResumeWork(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && !paused && tickets[t].phase == Suspended
    requires |holds| < capacity
    modifies this
    ensures Valid()
  {
    tickets := tickets[t := tickets[t].(phase := Executing)];
    holds := holds + {t};
  }

  method ReportAccepted(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Executing
    modifies this
    ensures Valid()
    ensures tickets[t].phase == Accepted && holds == old(holds) - {t}
    ensures tickets[t].attempts == old(tickets[t].attempts)
    ensures crashed == old(crashed) && paused == old(paused)
    ensures head == old(head) && target == old(target)
  {
    tickets := tickets[t := tickets[t].(phase := Accepted)];
    holds := holds - {t};
  }

  method StartIntegration(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Accepted && target.None?
    modifies this
    ensures Valid()
    ensures tickets[t].phase == Integrating && tickets[t].expectedHead == head
    ensures tickets[t].attempts == old(tickets[t].attempts)
    ensures head == old(head) && holds == old(holds)
    ensures crashed == old(crashed) && paused == old(paused)
  {
    tickets := tickets[t := tickets[t].(phase := Integrating, expectedHead := head)];
    target := Some(t);
  }

  method Promote(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Integrating
    requires tickets[t].expectedHead == head   // I13, compare-and-set
    modifies this
    ensures Valid()
  {
    tickets := tickets[t := tickets[t].(phase := Promoted)];
    target := None;
    head := head + 1;
  }

  method Settle(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Promoted
    modifies this
    ensures Valid()
  {
    tickets := tickets[t := tickets[t].(phase := Settled)];
  }

  method ApplyPause()
    requires Valid() && !crashed
    modifies this
    ensures Valid()
  { paused := true; }

  method ApplyUnpause()
    requires Valid() && !crashed
    modifies this
    ensures Valid()
  { paused := false; }

  /* I8, the capacity trap, in its Dafny form. The method does NOT promise
   * |holds| <= capacity afterwards: a contraction legitimately leaves existing
   * holders above the new ceiling. Adding that postcondition is the M8
   * specification error, and ./DeliveryL2Mutants.dfy shows it being rejected. */
  method ChangeCapacity(c: nat)
    requires Valid() && !crashed
    modifies this
    ensures Valid()
  { capacity := c; }

  method ExternalTargetAdvance()
    requires Valid()
    modifies this
    ensures Valid()
    ensures head == old(head) + 1 && tickets == old(tickets)
    ensures holds == old(holds) && crashed == old(crashed)
  { head := head + 1; }

  method Crash()
    requires Valid() && !crashed
    modifies this
    ensures Valid()
    ensures crashed && holds == {} && target.None?
    ensures forall u :: u in Tasks && old(tickets[u].phase) != Integrating
              ==> tickets[u] == old(tickets[u])
  {
    tickets := map t | t in tickets.Keys ::
      (if tickets[t].phase == Integrating then tickets[t].(phase := Accepted) else tickets[t]);
    holds := {};
    target := None;
    crashed := true;
  }

  method Recover()
    requires Valid() && crashed
    modifies this
    ensures Valid()
    ensures !crashed
    ensures tickets == old(tickets)
    ensures holds == set t | t in Tasks && HoldsPosition(tickets[t].phase)
  {
    holds := set t | t in Tasks && HoldsPosition(tickets[t].phase);
    crashed := false;
  }
}

/* --------------------------------------------------------------- witnesses
 *
 * Every method above is conditioned on Valid(), so all of them hold vacuously
 * if Valid() is unsatisfiable or the interesting states are unreachable. This
 * method is the Dafny form of the reachability trace that lean/L2.lean and
 * agda/L2.agda spell out, and of Alloy's `run`.
 */
method ExecutingIsReachable()
{
  var d := new Delivery();
  d.ObserveGraph(0, true, true);
  d.AcquireClaim(0);
  d.PlanAttempt(0);
  d.BeginWork(0);
  assert d.tickets[0].phase == Executing;
  assert 0 in d.holds;
  assert d.tickets[0].attempts == 1;
}

/* A stale expected head is reachable, so Promote's compare-and-set
 * precondition is defending against something rather than holding vacuously. */
method StaleHeadIsReachable()
{
  var d := new Delivery();
  d.ObserveGraph(0, true, true);
  d.AcquireClaim(0);
  d.PlanAttempt(0);
  d.BeginWork(0);
  d.ReportAccepted(0);
  d.StartIntegration(0);
  assert d.tickets[0].expectedHead == d.head;
  d.ExternalTargetAdvance();
  assert d.tickets[0].phase == Integrating;
  assert d.tickets[0].expectedHead != d.head;
}

/* Crash clears process-local resources; recovery restores exactly the
 * positions the durable phases imply, and plans no replacement attempt. */
method RecoveryPlansNoSecondAttempt()
{
  var d := new Delivery();
  d.ObserveGraph(0, true, true);
  d.AcquireClaim(0);
  d.PlanAttempt(0);
  d.BeginWork(0);
  d.Crash();
  assert d.holds == {};
  d.Recover();
  assert d.tickets[0].phase == Executing;
  assert d.tickets[0].attempts == 1;
}
