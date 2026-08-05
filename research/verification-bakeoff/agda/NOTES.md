# Agda

## Setup

`brew install agda`, then `agda L1.agda`. The file defines its own `Nat`,
`List`, `_==_`, `_<=_`, and `_∈_`, so no standard library and no `.agda-lib`
are needed. Checked under `--safe`.

## Friction met while encoding

`in` is a keyword, so the membership relation cannot be named `_in_`. Unicode
`_∈_` is not decoration here, it is the workaround.

`with select-exact n ts` then matching `refl` fails with `SplitError.Unification
Stuck`: Agda cannot unify `length (select n ts)` with `min n (length ts)`
because neither side reduces. The fix is a congruence lemma —
`cong suc (select-exact n ts)` — which is the standard move and the standard
first stumble.

Everything else typechecks in well under a second.

## Character

The reason Agda is in the lineup is that it holds one invariant a different way
than every other tool.

I3 says an excluded task always carries at least one graph-owned reason. There
is no theorem for it in `L1.agda`. `Excluded` takes a `Reasons` record whose
`first` field is a `Reason`, so an exclusion without a reason is not a false
proposition — it is a term that cannot be written. The invariant costs zero
proof and zero runtime check, and no mutant can express the defect.

That is the same move the production code already makes: `TicketDelivery`
carries `readonly [TicketDeliveryStanding, ...ReadonlyArray<...>]`, a nonempty
tuple. TypeScript is doing dependent-types-lite in exactly this spot.

I1 and I4 cost real proofs, and they are short: three cases each, structural
recursion, no automation. Once written they hold for all inputs, not for 50 000
samples.

## The honest gap

I2, order independence, is absent. Stating it needs a permutation relation and
a proof that selection commutes with graph-order normalization — larger than
the whole rest of the file. The same property is one `fc.property` line with a
shuffle, and it already exists in
`packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.property.test.ts`.

Structural invariants are free in the type system. Quantitative and
permutation-shaped ones are disproportionately expensive. That trade, not the
proof/test dichotomy, is what decides where this tool pays.

L2 is not attempted. Encoding a transition system with crash and recovery in
Agda is possible and is a different order of work.
