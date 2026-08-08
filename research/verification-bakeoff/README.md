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
7. `JOURNAL-EVENTS.md` — the event alphabet I15 folds over, and the four
   reconstruction propositions.
8. `LEARNING.md` — the completed Lean/Agda/Dafny journal-law comparison,
   including proof strength, specializations, mutations, and reproduction.
9. `PROVER-SOURCES.md` — primary-source support for what each checker supplies.

## Run

```sh
node fastcheck/run.mjs                # property-based testing, seconds
quint/run.sh                          # random simulation, seconds
quint/run.sh --verify                 # Apalache symbolic checking, minutes
quint/run.sh --witnesses              # sampling coverage: the vacuity check
quint/run.sh --m8                     # the seeded specification error
quint/run.sh --inductive              # is the invariant inductive? ~151s
tlaplus/run.sh                        # TLC exhaustive checking, seconds
tlaplus/run.sh --witness              # the vacuity check
tlaplus/run.sh --m8                   # the seeded specification error
tlaplus/run-liveness.sh --small       # I17-I19, one task
tlaplus/run-liveness.sh               # I17-I19, two tasks; I18 does not finish
tlaplus/run-liveness.sh --lasso       # is the suspend/resume lasso a bug or a missing hypothesis?
tlaplus/run-liveness.sh --arrival     # I19 when new work keeps arriving; neither verdict is usable
node fastcheck/liveness.mjs           # bounded liveness surrogate, and its witnesses
node fastcheck/liveness.mjs --no-abandon   # the negative control that fails to fire
node fastcheck/journal-run.mjs        # the I15 fold: four propositions + negative controls
alloy/run.sh                          # relational structure search, seconds
alloy/run.sh DeliveryL2.als           # the protocol, temporal + inductiveness
alloy/run.sh DeliveryLiveness.als     # I17-I19, all three, ~131s
dafny/run.sh                          # verified code, seconds
lean/run.sh                           # proofs, seconds
agda/run.sh                           # --safe proofs + journal mutants, seconds
node prover-mutants.mjs               # P1/P2/P3 negative controls for all three provers
~/.elan/bin/lean L2.lean               # from lean/, the protocol proof
```

Quint and Agda come from Homebrew, Lean from elan. TLC, Alloy, and Dafny are
single downloads that each `run.sh` fetches into `~/.cache/dalph-bakeoff`.
Nothing here is wired into the quality gate; `specs/*.qnt` remains the gated
model suite.

### Linux aarch64 environment notes

The study also runs on Debian 12 aarch64 (see the SCOREBOARD addendum for the
re-run results), with four caveats a fresh session should know:

- **`quint verify --backend tlc` does not use `tla2tools.jar`.** Quint runs the
  TLC bundled inside the Apalache jar (`~/.quint/apalache-dist-*/.../apalache.jar`).
  On a fresh machine or CI runner the dist is absent and the backend fails with
  `Apalache JAR not found ... Run 'quint verify' with Apalache backend first to
  download it`. Warm-up is one `quint verify` of any spec on the default
  backend; only then does `--backend tlc` work. This is the one network step a
  TLC-backend gate job needs beyond `pnpm install`.
- **Agda depends on host-level qemu-user binfmt.** The prebuilt binary is
  static x86-64; it survives fresh shells here because the binfmt registration
  lives in the container's host runtime. Recreate the container on a host
  without qemu binfmt and Agda fails with `Exec format error` — there is
  nothing to export or reinstall inside the container.
- **Dafny's arm64 recipe lives in `~/.cache/dalph-bakeoff`.** The wrapper at
  `~/.cache/dalph-bakeoff/dafny-arm64/dafny` is self-contained, but if the
  cache is wiped the .NET/PE-patch/arm64-z3 recipe in `dafny/NOTES.md`
  ("Linux aarch64 workaround") must be re-run.
- **Alloy is SAT4J-only here** (no linux-aarch64 native solvers in 6.2.0).
  A performance note, not a blocker: SAT4J ran the L2 file faster than the
  recorded macOS figures (239s vs ~324s).

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

## The lessons the layout is built around

**Level determines fit.** L1 is a total function; L2 is a transition system.
Proof assistants are strong on the first and expensive on the second; model
checkers are the reverse. A comparison that runs only one level will rank the
tools by which level it picked.

**A pass is not evidence.** Random engines report clean on states they never
reached. Every clean result here is paired with a witness that the interesting
state is reachable at all.

**A liveness counterexample is a question for the domain.** I17-I19 each need
hypotheses about what the environment may do forever, where no safety invariant
needed any. And when the check fails, several fixes will make the
counterexample disappear while meaning different things: the suspend/resume
lasso here is removed either by strengthening fairness or by assuming the
operator away, and only `docs/CONTEXT.md` says which is faithful. No tool in
this directory can tell you.

**A run stuck forever violates no safety property.** Nine safety invariants,
three engines and 96 000 states had nothing to say about a ticket parked in
`Integrating` behind a stale head. One liveness property found it immediately —
and also found that the property itself had dropped half of I18. Safety and
liveness fail differently and are not substitutes.

**The specification is the part that stays yours.** M8 seeds no defect, only a
plausible-looking wrong invariant, and every tool faithfully reports a correct
model as broken. Nothing in the tooling distinguishes that from a real finding.
