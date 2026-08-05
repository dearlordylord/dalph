/*
 * L1 of ../INVARIANTS.md in Dafny.
 *
 * Dafny is the only tool here that verifies *code* rather than a model. These
 * are ordinary imperative and functional definitions, shaped like
 * packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts,
 * and the invariants are pre/post conditions on them. Nothing is sampled and
 * nothing is enumerated: the SMT solver discharges the obligations, or it does
 * not and you get a specific unproved assertion.
 *
 * MUTANT is a module-level constant. ../run.sh rewrites it per mutant, because
 * Dafny has no way to parameterize a constant from the command line.
 */

const MUTANT: nat := 0

datatype Reason =
  | SuccessfulCompletion
  | TerminalWithoutSuccess
  | PrerequisitesIncomplete(prerequisiteIds: seq<nat>)

datatype Standing =
  | Eligible(taskId: nat)
  | Excluded(taskId: nat, reasons: seq<Reason>)

datatype Placement =
  | Selected(rank: nat)
  | EligibleOutsideBound(rank: nat)
  | GraphExcluded(reasons: seq<Reason>)
  | AbsentFromCurrentGraph

datatype TicketDelivery = TicketDelivery(taskId: nat, placement: Placement, obligated: bool)

function TaskOf(s: Standing): nat
{
  match s
  case Eligible(t) => t
  case Excluded(t, _) => t
}

predicate IsEligible(s: Standing)
{
  s.Eligible?
}

/* I3: every standing carries a task, and an exclusion carries at least one
 * reason. Unlike the Agda encoding this is a predicate rather than a type, so
 * it has to be assumed and re-established rather than being free. */
predicate WellFormedStandings(standings: seq<Standing>)
{
  forall i :: 0 <= i < |standings| ==> (standings[i].Excluded? ==> |standings[i].reasons| > 0)
}

function EligibleTasks(standings: seq<Standing>): seq<nat>
  ensures |EligibleTasks(standings)| <= |standings|
{
  if |standings| == 0 then []
  else if IsEligible(standings[0]) then [TaskOf(standings[0])] + EligibleTasks(standings[1..])
  else EligibleTasks(standings[1..])
}

/* I1: the bounded selection. The postcondition is the invariant, and Dafny
 * proves it as part of accepting the definition. */
function Select(capacity: nat, eligible: seq<nat>): seq<nat>
  ensures |Select(capacity, eligible)| <= capacity
  ensures |Select(capacity, eligible)| <= |eligible|
  ensures |Select(capacity, eligible)| == if capacity < |eligible| then capacity else |eligible|
{
  if capacity == 0 || |eligible| == 0 then []
  else [eligible[0]] + Select(capacity - 1, eligible[1..])
}

/* The M1 mutant: `rank <= capacity`, expressed as taking one element too many.
 * Its `ensures` clause is the same as above, so Dafny rejects the function
 * itself rather than reporting a counterexample. */
function SelectMutant(capacity: nat, eligible: seq<nat>): seq<nat>
  ensures |SelectMutant(capacity, eligible)| <= capacity + 1
{
  if |eligible| == 0 then []
  else if capacity == 0 then [eligible[0]]
  else [eligible[0]] + SelectMutant(capacity - 1, eligible[1..])
}

/* I4: retention. A task with an outstanding obligation appears in the ticket
 * deliveries under every placement, including AbsentFromCurrentGraph. */
function Deliveries(selected: seq<nat>, obligated: seq<nat>): seq<nat>
  ensures forall t :: t in obligated ==> t in Deliveries(selected, obligated)
  ensures forall t :: t in selected ==> t in Deliveries(selected, obligated)
{
  selected + obligated
}

/* The retention property stated separately, as the theorem a reviewer reads. */
lemma RetentionHolds(selected: seq<nat>, obligated: seq<nat>, t: nat)
  requires t in obligated
  ensures t in Deliveries(selected, obligated)
{
  // Discharged by the postcondition of Deliveries.
}

/* The interesting corollary: the graph no longer places the task at all. */
lemma RetentionWhenAbsent(obligated: seq<nat>, t: nat)
  requires t in obligated
  ensures t in Deliveries([], obligated)
{
  RetentionHolds([], obligated, t);
}

/* I5: settlement drops the obligation. */
predicate StillDelivers(d: TicketDelivery)
{
  d.obligated
}

lemma SettlementDropped(d: TicketDelivery)
  requires !d.obligated
  ensures !StillDelivers(d)
{
}

/* I8, the capacity trap, as an imperative method with a loop invariant.
 *
 * Admission respects the ceiling at the moment of admission. The method does
 * NOT promise |positions| <= capacity afterwards, because a later contraction
 * of `capacity` may leave existing holders above it. Trying to strengthen the
 * postcondition to that is the M8 specification error, and Dafny will accept
 * it here only because `capacity` does not change inside the loop -- which is
 * exactly why a state predicate looks convincing and is still wrong. */
method AdmitAll(candidates: seq<nat>, capacity: nat) returns (positions: seq<nat>)
  ensures |positions| <= capacity
{
  positions := [];
  var i := 0;
  while i < |candidates|
    invariant 0 <= i <= |candidates|
    invariant |positions| <= capacity
  {
    if |positions| < capacity {
      positions := positions + [candidates[i]];
    }
    i := i + 1;
  }
}

/* A witness that the projection is not vacuous: a concrete run through the
 * pipeline. Without this, every lemma above could hold over empty inputs. */
lemma Witness()
{
  var standings := [Eligible(1), Eligible(2), Excluded(3, [SuccessfulCompletion])];
  assert WellFormedStandings(standings);
  var eligible := EligibleTasks(standings);
  assert eligible == [1, 2];
  var selected := Select(1, eligible);
  assert selected == [1];
  assert 2 !in selected;
  // Task 2 is outside the bound, yet an obligation on it still delivers.
  assert 2 in Deliveries(selected, [2]);
}
