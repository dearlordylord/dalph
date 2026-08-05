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

## Not attempted

L2. Dafny can express a state machine, but the natural encoding is a class with
a mutable heap and history invariants, which is a different and much larger
development than the model checkers needed. That trade is the point: Dafny is
cheap where the property is a function's contract and expensive where it is a
protocol's temporal shape.
