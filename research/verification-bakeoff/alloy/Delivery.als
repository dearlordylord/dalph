/*
 * The shared benchmark of ../MODEL.md in Alloy 6.
 *
 * Alloy earns its place here on I11 and I12, which appear in NO other encoding
 * in the bake-off. A claim carrying an exact token and a candidate with two
 * ordered parents are expensive enough in a state-machine language that the
 * shared model leaves them out entirely. Here they are relations over atoms, so
 * a defect is a shape and Alloy searches for the shape.
 *
 * I1, I7 and I14 also appear below, but as constraints inside `wellFormed`
 * rather than as claims about the model. They are assumptions here; TLC, Quint
 * and fast-check are what check them.
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
//
// The fields have to be `var` even though a claim's task, owner and token never
// change: a static field of a variable signature forces the signature itself to
// be constant, so `no Claim and some Claim'` becomes UNSAT and no claim can
// ever be acquired. Alloy reports that only as a warning.
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

/* --------------------------------------------------- claims, as a machine
 *
 * I11 is the one invariant in this file that must NOT be an assumption.
 * `claimExclusivity` cannot appear in `wellFormed` and then be checked against
 * it: that is `P implies P`, UNSAT for a reason with nothing to do with claims.
 *
 * So exclusivity and token uniqueness are DERIVED, from the guard on
 * acquisition, over a transition relation of their own. This is the only
 * place in `Delivery.als` with a step relation, and it is here because the
 * alternative is a tautology.
 */

pred acquireClaim[t : Task] {
  no c : Claim | c.task = t                     // the guard I11 rests on
  some c : Claim' - Claim, o : Owner, k : Token - Claim.token {
    Claim' = Claim + c                          // one new claim, for t,
    task'  = task  + (c -> t)                   // with a freshly minted token
    owner' = owner + (c -> o)
    token' = token + (c -> k)
  }
}

// A release names the EXACT current owner and token. A token from an earlier
// claim authorizes nothing, which is why `o` and `k` are matched against the
// claim rather than merely quantified.
pred releaseClaim[c : Claim, o : Owner, k : Token] {
  c.owner = o and c.token = k
  Claim' = Claim - c
  task'  = task  - (c -> Task)
  owner' = owner - (c -> Owner)
  token' = token - (c -> Token)
}

pred claimsFrozen { Claim' = Claim and task' = task and owner' = owner and token' = token }

pred claimStep {
  (some t : Task | acquireClaim[t])
  or (some c : Claim | releaseClaim[c, c.owner, c.token])
  or claimsFrozen
}

// The mutant: acquisition without the exclusivity guard and without the
// freshness requirement on the token. Everything else is identical.
pred mutantAcquire[t : Task] {
  some c : Claim' - Claim, o : Owner, k : Token {
    Claim' = Claim + c
    task'  = task  + (c -> t)
    owner' = owner + (c -> o)
    token' = token + (c -> k)
  }
}

pred mutantClaimStep {
  (some t : Task | mutantAcquire[t])
  or (some c : Claim | releaseClaim[c, c.owner, c.token])
  or claimsFrozen
}

// I12: exactly two ordered parents, target head first.
pred candidateParentsOrdered {
  all c : Candidate |
    c.firstParent = c.forTask.expectedHead and c.secondParent = c.accepted
}

// I13 has no home in this file. It is a property of the promotion TRANSITION
// -- an offer is made only by compare-and-set against the exact expected head
// -- and there is no transition relation here. Stated as the state predicate
// "an integrating task's captured head is the current target head" it is
// simply FALSE of well-formed states, which `run staleHeadIsPossible` below
// demonstrates: a captured head going stale is the phenomenon the guard
// defends against, not a violation. I13 lives in the TLC, Quint and
// fast-check history flags.

// I14: the integration target resource is exclusive and process-local.
pred targetResourceExclusive { lone Runtime.targetHolder }

// -------------------------------------------------------------------- traces

// Apart from `claimStep` above, the transition relation is left deliberately
// loose. Alloy's strength here is
// searching structures that satisfy the constraints, not simulating a machine,
// so the checks below quantify over all well-formed states rather than over a
// hand-written step relation.
//
// Everything named here is an ASSUMPTION, not a result. `positionDiscipline`
// (I7), `targetResourceExclusive` (I14) and `boundRespected` (I1) are
// constrained rather than checked in this file; TLC and Quint are what
// actually check them. Only a predicate OUTSIDE this one is a claim about the
// model, which is why `claimExclusivity` and `tokenUnique` are not here.
pred wellFormed {
  positionDiscipline
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

// I11 as a structure search: is a second claim on one task REACHABLE from the
// acquisition guard? Expected UNSAT, and unlike the state-only form this one
// can fail.
check claimsAreExclusive {
  (no Claim and always claimStep) implies always claimExclusivity
} for 4 but 4 Task, 4 Head, 4 Commit, 1..6 steps

// Fresh tokens are the other half of I11: a token from an earlier claim
// authorizes nothing, so no two claims may ever share one.
check tokensAreUnique {
  (no Claim and always claimStep) implies always tokenUnique
} for 4 but 4 Task, 4 Head, 4 Commit, 1..6 steps

// The negative control for both. Drop the guard and the fresh-token
// requirement and Alloy must construct the double claim. Expected SAT.
check claimsExclusiveUnderMutant {
  (no Claim and always mutantClaimStep) implies always (claimExclusivity and tokenUnique)
} for 4 but 4 Task, 4 Head, 4 Commit, 1..6 steps

// ---------------------------------------------------------------- witnesses
//
// Vacuity checks. Each must find an instance, or the corresponding check above
// proved nothing.

// Without this the two claim checks above hold over traces that never acquire
// anything, which is the `always claimStep` version of a vacuous pass.
run claimsAreAcquired {
  no Claim and always claimStep
  eventually (some disj c1, c2 : Claim | c1.task != c2.task)
} for 4 but 4 Task, 4 Head, 4 Commit, 1..6 steps

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
