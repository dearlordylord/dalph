# Verification bake-off

One fixed set of delivery invariants, encoded in several verification tools,
measured against the same seeded defects. The goal is to learn each tool's
character by running it on work this repository actually cares about, rather
than on a dining-philosophers example.

## Read in this order

1. `INVARIANTS.md` — the fixed specification. Tool-agnostic, numbered I1–I19.
2. `MODEL.md` — the pinned abstraction every encoding shares.
3. `MUTANTS.md` — the seeded defects and the detection protocol.
4. `SCOREBOARD.md` — measurements and findings.
5. `READING-GUIDE.md` — the same proposition side by side across all seven
   tools. Start here if the goal is to learn the differences rather than the
   measurements.
6. `GATED-SPECS-MUTATION.md` — the same protocol applied back to this
   repository's own gated models under `specs/`.

## Run

```sh
node fastcheck/run.mjs                # property-based testing, seconds
quint/run.sh                          # random simulation, seconds
quint/run.sh --verify                 # Apalache symbolic checking, minutes
tlaplus/run.sh                        # TLC exhaustive checking, seconds
tlaplus/run.sh --witness              # the vacuity check
tlaplus/run.sh --m8                   # the seeded specification error
alloy/run.sh                          # relational structure search, seconds
alloy/run.sh DeliveryL2.als           # the protocol, temporal + inductiveness
dafny/run.sh                          # verified code, seconds
lean/run.sh                           # proofs, seconds
agda L1.agda && agda L2.agda          # from agda/, proofs check or they do not
~/.elan/bin/lean L2.lean               # from lean/, the protocol proof
```

Quint and Agda come from Homebrew, Lean from elan. TLC, Alloy, and Dafny are
single downloads that each `run.sh` fetches into `~/.cache/dalph-bakeoff`.
Nothing here is wired into the quality gate; `specs/*.qnt` remains the gated
model suite.

Each `run.sh` checks the faithful encoding *and* confirms the seeded defects are
rejected. The second half is not optional: a tool that accepts the mutants has
proved nothing about the faithful one.

## Relationship to the production models

`specs/*.qnt` are production models under `pnpm check:quint`, and they stay
that way. This directory is a study, not a second gate. Two things flow back:

- L1 here mirrors `packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts`,
  whose fast-check properties already cover I1, I2, and I4.
- L2 here is a coarser sibling of `specs/plannedAttemptExecutor.qnt`, extended
  with integration, promotion, and process loss.

## The three lessons the layout is built around

**Level determines fit.** L1 is a total function; L2 is a transition system.
Proof assistants are strong on the first and expensive on the second; model
checkers are the reverse. A comparison that runs only one level will rank the
tools by which level it picked.

**A pass is not evidence.** Random engines report clean on states they never
reached. Every clean result here is paired with a witness that the interesting
state is reachable at all.

**The specification is the part that stays yours.** M8 seeds no defect, only a
plausible-looking wrong invariant, and every tool faithfully reports a correct
model as broken. Nothing in the tooling distinguishes that from a real finding.
