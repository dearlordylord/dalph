# Dafny

## Setup

A 100 MB zip from the GitHub releases page, self-contained, no .NET install
needed. Homebrew was the obvious route and failed for an unrelated reason (an
untrusted third-party tap blocks every `brew install`), so `run.sh` fetches the
release binary directly.

## Character

Dafny is the only tool in the lineup that verifies *code* rather than a model.
`Select`, `Deliveries`, and `AdmitAll` are ordinary definitions with the same
shape as `ticket-delivery-projection.ts`, and the invariants are `ensures`
clauses on them. There is no separate artifact to keep in sync with the
implementation, which is the whole pitch.

The consequence is that a violated invariant is not a counterexample trace. It
is a refusal to compile:

```
Error: a postcondition could not be proved on this return path
Related location: this is the postcondition that could not be proved
```

That is less informative than TLC's full behaviour — Dafny names the clause and
the return path, not the input that breaks it. For M1 the offending sequence is
obvious; for a subtler defect it would not be, and this is the known cost of
auto-active verification.

## Where it landed the I8 lesson best

`AdmitAll` proves `|positions| <= capacity` with a loop invariant, and it is
*true* there, because `capacity` does not change inside the loop. That is
precisely why the M8 specification error is convincing: within one admission
pass the state predicate really does hold.

`AdmitThenContractM8` extends the same method with the capacity revision that
production allows, keeps the same postcondition, and Dafny rejects it. The
error appears on the *postcondition*, so the tool points at the specification
rather than at the code — a better surfacing than TLC's "faithful model
violated", which points at the model.

## Friction

Almost none, and that is itself a finding. Eleven obligations verified in 1.3
seconds on the first attempt, with no triggers, no `assume`, and no manual
lemma invocation beyond one `RetentionHolds` call. The SMT solver handled
sequences and lengths without help.

This is the honeymoon case: L1 is a total function over lists with linear
arithmetic, which is exactly where Z3 is strongest. The brittleness Dafny is
known for — proofs breaking on a solver update or on a logically equivalent
rewrite of a spec — does not show up at this size and should not be assumed
absent at a larger one.

## L2: the class invariant is the induction

`DeliveryL2.dfy` is the protocol as a class whose mutable state is constrained
by `Valid()`, with each action a method that must re-establish it. 40
obligations, 3 seconds.

This is a different shape from every other L2 encoding, and it lands at a
distinct point on the axis they span:

| Tool | What you supply | What it does |
|---|---|---|
| TLC | an invariant | discovers the reachable set |
| Alloy | an invariant | tells you whether it is inductive |
| Lean / Agda | an **inductive** invariant | you prove every case by hand |
| **Dafny** | an **inductive** invariant | SMT proves every case |

`requires Valid() ... ensures Valid()` on every method *is* the induction, one
method at a time. So Dafny asks exactly what a proof assistant asks — the
invariant must already be inductive — while discharging the cases the way a
checker does.

`DeliveryL2Mutants.dfy` makes that concrete. `ValidWeak()` keeps `attempts <= 1`
and drops the phase/attempts clause, and `PlanAttemptM` fails to verify. Same
obstruction as Lean's stuck goal and Alloy's counterexample to induction, in a
third presentation: **a method that cannot re-establish its own class
invariant.**

### The friction that matters, and it is not the solver

`ensures Valid()` alone makes a method useless to its caller.

The first version of this file verified all seventeen methods and then failed
fifteen times inside the reachability witnesses, because nothing said what
`AcquireClaim` had actually *done*. The class invariant preserves safety and
says nothing about progress, so the caller cannot establish the next method's
precondition.

The fix is a frame condition per method:

```dafny
ensures tickets[t].phase == Planned
ensures tickets[t].attempts == old(tickets[t].attempts) + 1
ensures holds == old(holds) && capacity == old(capacity)
ensures crashed == old(crashed) && paused == old(paused)
```

That is the same tax Alloy pays for having no `UNCHANGED`, arriving by a
completely different route — Alloy needs it to define the transition, Dafny
needs it to let callers reason across one. TLA+ avoids both with
`UNCHANGED << ... >>`.

The SMT solver, meanwhile, needed no help at all: no lemmas, no `assert`
hints, no triggers beyond removing one map comprehension the solver warned was
brittle. At this size Z3 simply does the work.

### Witnesses, as executable traces

The vacuity check is nicer here than anywhere else in the bake-off, because a
Dafny witness is just a program:

```dafny
method StaleHeadIsReachable() {
  var d := new Delivery();
  d.ObserveGraph(0, true, true);
  d.AcquireClaim(0); d.PlanAttempt(0); d.BeginWork(0);
  d.ReportAccepted(0); d.StartIntegration(0);
  assert d.tickets[0].expectedHead == d.head;
  d.ExternalTargetAdvance();
  assert d.tickets[0].phase == Integrating;
  assert d.tickets[0].expectedHead != d.head;
}
```

It reads as the scenario it is, and it is statically checked rather than run.
Lean and Agda need the same trace built as a chain of `Step` constructors;
Alloy gets it from a `run`; TLC gets it by refuting a negation. This is the
most readable of the four.

`RecoveryPlansNoSecondAttempt` is the one worth reading next to
`docs/OPERATIONAL-SCENARIOS.md`: crash, recover, and assert the attempt count
is still 1.

### Liveness: the one hard "cannot"

I17–I19 are not expressible in Dafny. There are no temporal operators, so
there is no way to write `eventually`, no `~>`, and no fairness vocabulary.
Every other tool in the bake-off states all three properties; this is the only
place where the answer is a capability gap rather than a cost.

The nearest available thing is a termination measure — `decreases` on a loop or
a recursive method — which proves that *one call* finishes. It says nothing
about a reactive system that never terminates by design, which is what I17–I19
are about. A ticket parked in `Integrating` forever is a perfectly well-typed,
fully verified `Delivery` object.

That is not a defect in Dafny so much as its scope: it verifies code against
pre/postconditions, and "this run eventually settles or is retained with a
stated reason" is not a postcondition of anything. The gap is worth naming
precisely because the L2 encoding is otherwise the most complete one here.
