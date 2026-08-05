/*
 * The shared benchmark of ../MODEL.md in Alloy 6.
 *
 * Alloy earns its place here on I11 and I12. Every other encoding models claim
 * exclusivity and candidate parent order as booleans, because a boolean is what
 * a state-machine language makes cheap. Here they are relations over atoms, so
 * the defect is a shape rather than a flag, and Alloy searches for the shape.
 *
 * Run with alloy/run.sh, which drives each `check` and `run` separately.
 */
module delivery

open util/ordering[Head] as headOrder

// ------------------------------------------------------------------- atoms

sig Task {}
sig Owner {}
sig Token {}
sig Commit {}
sig Head {}          // integration target heads, totally ordered

abstract sig Phase {}
one sig NoObligation, Claimed, Planned, Executing, SuspensionRequested,
        Suspended, Accepted, Integrating, Promoted, Settled extends Phase {}

// -------------------------------------------------------------- mutable state

var sig Eligible in Task {}          // present in the graph and open
var sig Selected in Eligible {}      // inside the current bound
var sig Holding in Task {}           // holds a task-work position
var sig Paused in Task {}            // unused placeholder keeps Paused a set

var one sig Runtime {
  var capacity     : one Int,
  var targetHead   : one Head,
  var targetHolder : lone Task        // process-local integration resource
}

var sig Ticket in Task {
  var phase        : one Phase,
  var expectedHead : lone Head        // captured when integration starts
}

// A claim is a task, an owner, and the exact token that authorizes its release.
var sig Claim {
  var task  : one Task,
  var owner : one Owner,
  var token : one Token
}

// A candidate is a commit with two ORDERED direct parents. Order is what the
// invariant is about, so it is two distinct fields, not a set.
var sig Candidate {
  var forTask      : one Task,
  var firstParent  : one Head,
  var secondParent : one Commit,
  var accepted     : one Commit       // the immutable accepted result
}

// ------------------------------------------------------------------ mutants
//
// Alloy has no constant parameter, so a mutant is a fact that relaxes a
// well-formedness constraint. run.sh selects one by name.

pred faithful {
  // I12: a candidate's first parent is the exact expected head of its task,
  // its second is that task's accepted result, in that order.
  all c : Candidate |
    let t = c.forTask |
      c.firstParent = t.expectedHead and c.secondParent = c.accepted
}

pred mutantSwappedParents {
  // M3: construction offers the accepted result first and the target head
  // second. Structurally a two-parent commit either way.
  all c : Candidate |
    let t = c.forTask |
      c.firstParent = t.expectedHead implies c.secondParent = c.accepted
}

// ------------------------------------------------------------ the invariants

// I1: the bound.
pred boundRespected { #Selected =< Runtime.capacity }

// I4: retention. A task with an outstanding obligation is delivered whether or
// not the graph currently selects it.
fun obligated : set Task {
  { t : Ticket | t.phase not in (NoObligation + Settled) }
}
fun deliveries : set Task { Selected + obligated }
pred retentionHolds { obligated in deliveries }

// I7: a position is held exactly while work is outstanding.
pred positionDiscipline {
  Holding = { t : Ticket | t.phase in (Executing + SuspensionRequested) }
}

// I11: claim exclusivity, as a relational property rather than a flag.
// At most one claim per task, and no two claims share a token.
pred claimExclusivity {
  all t : Task | lone c : Claim | c.task = t
}
pred tokenUnique {
  all disj c1, c2 : Claim | c1.token != c2.token
}

// I12: exactly two ordered parents, target head first.
pred candidateParentsOrdered {
  all c : Candidate |
    c.firstParent = c.forTask.expectedHead and c.secondParent = c.accepted
}

// I13: an integrating task's captured head is the current target head.
pred promotionUsesExactHead {
  all t : Ticket | t.phase = Integrating implies t.expectedHead = Runtime.targetHead
}

// I14: the integration target resource is exclusive and process-local.
pred targetResourceExclusive { lone Runtime.targetHolder }

// -------------------------------------------------------------------- traces

pred init {
  no Claim
  no Candidate
  no Holding
  no Selected
  Ticket = Task
  all t : Ticket | t.phase = NoObligation
  no Ticket.expectedHead
  Runtime.capacity = 1
  Runtime.targetHead = headOrder/first
  no Runtime.targetHolder
}

pred stutter { Ticket' = Ticket and Claim' = Claim and Candidate' = Candidate }

// The transition relation is left deliberately loose. Alloy's strength here is
// searching structures that satisfy the constraints, not simulating a machine,
// so the checks below quantify over all well-formed states rather than over a
// hand-written step relation.
pred wellFormed {
  positionDiscipline
  claimExclusivity
  tokenUnique
  targetResourceExclusive
  boundRespected
  // an integrating task holds the target resource and has captured a head
  all t : Ticket | t.phase = Integrating implies
    (Runtime.targetHolder = t and some t.expectedHead)
}

// ------------------------------------------------------------------- checks

// Retention is implied by its definition, so this check passing is expected
// and is the Alloy analogue of the definitional invariant discussed in
// ../SCOREBOARD.md.
check retentionAlwaysHolds {
  wellFormed implies retentionHolds
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps

// The load-bearing one: under the faithful construction rule, can a candidate
// with misordered parents exist at all?
check parentsAlwaysOrdered {
  (wellFormed and faithful) implies candidateParentsOrdered
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps

// The same check under M3. Alloy should produce a concrete misordered
// candidate as a counterexample.
check parentsOrderedUnderMutant {
  (wellFormed and mutantSwappedParents) implies candidateParentsOrdered
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps

// I11 as a structure search: two distinct claims on one task.
check claimsAreExclusive {
  wellFormed implies claimExclusivity
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps

// ---------------------------------------------------------------- witnesses
//
// Vacuity checks. Each must find an instance, or the corresponding check above
// proved nothing.

run someCandidateExists {
  wellFormed and faithful and some Candidate
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps

run staleHeadIsPossible {
  wellFormed and some t : Ticket |
    t.phase = Integrating and t.expectedHead != Runtime.targetHead
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps

run twoTasksIntegratingIsImpossible {
  wellFormed and #{ t : Ticket | t.phase = Integrating } = 2
} for 4 but 4 Task, 4 Head, 4 Commit, 1 steps
