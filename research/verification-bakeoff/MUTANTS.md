# Seeded defects

The bake-off measures detection, not opinion. Each mutant is a single defect
seeded into the shared model of `MODEL.md`. A tool's score is which mutants it
catches, how long it takes, and how legible its counterexample is.

`M0` is the faithful model: every tool must report it clean. A tool that
reports `M0` violated has an encoding error, not a finding.

| Id | Defect | Breaks | Level |
|---|---|---|---|
| M0 | none | — | — |
| M1 | selection bound uses `rank <= capacity` | I1 | L1 |
| M2 | ticket deliveries contain only the current positive selection | I4 | L1 |
| M4 | the task-work position is released when suspension is requested, not when the executor proves safe suspension | I7 | L2 |
| M5 | recovery treats process loss as a reason to plan a second attempt | I10, I16 | L2 |
| M6 | promotion drops the compare-and-set guard against the exact expected head | I13 | L2 |

## M8 — the vacuity mutant

M8 seeds no code defect. It replaces invariant I8 with the state predicate
`|positions| <= capacity`, which reads correct and is not.

Under M8 every tool reports a violation of a *faithful* model, because a
capacity contraction legitimately leaves more holders than the new ceiling.
The tool is right and the specification is wrong. Nothing in any tool
distinguishes this from a real defect — that judgment is yours, and it is the
part the tooling does not automate.

The mirror case is worth running too: weaken I13 to `true`. Every tool proves
it instantly and teaches nothing.

## Vacuity check

`M6` exposes a second trap. Without `externalTargetAdvance` in the model, the
integration target resource is exclusive, so a captured expected head can never
go stale and the compare-and-set guard is unreachable. I13 then holds
*vacuously*, and M6 is undetectable — not because the tool is weak, but because
the model omits the phenomenon the guard defends against.

Any tool reporting I13 proved must therefore also witness that a stale head is
reachable. Witnesses are not optional decoration; they are the vacuity check.

## Detection protocol

For each tool and each mutant, record in `SCOREBOARD.md`:

1. caught / missed / not expressible
2. wall-clock to first answer
3. counterexample legibility: does the output name the offending action and
   task, or only a state vector
4. what the encoding cost was, in lines and in setup
