# Reading guide

The bake-off encodes one specification seven times. This guide puts the *same*
proposition next to itself across tools, so the differences you read are the
tools' and not the modelling's.

Read this with the files open. Every snippet below is real code from this
directory, not a paraphrase.

## Coverage

| Tool | L1 (pure projection) | L2 (protocol) | L3 (liveness) |
|---|---|---|---|
| fast-check | `fastcheck/run.mjs` | `fastcheck/run.mjs`, random sequences | `fastcheck/liveness.mjs`, bounded surrogate |
| Quint + Apalache | `quint/deliveryCore.qnt` | same file | same file; needs `--backend tlc` |
| TLA+ / TLC | `tlaplus/Delivery.tla` | same file | `tlaplus/DeliveryLiveness.tla` |
| Alloy 6 | `alloy/Delivery.als` | `alloy/DeliveryL2.als`, temporal | `alloy/DeliveryLiveness.als` |
| Dafny | `dafny/Delivery.dfy` | `dafny/DeliveryL2.dfy`, class invariant | **not expressible** |
| Lean 4 | `lean/L1.lean` | `lean/L2.lean` | statable, not attempted |
| Agda | `agda/L1.agda` | `agda/L2.agda` | statable, not attempted |

The recovery fold is a fourth comparison axis rather than another protocol
level. Read `JOURNAL-EVENTS.md` and `LEARNING.md`, then compare
`lean/Journal.lean`, `agda/Journal.agda`, `dafny/Journal.dfy`, and
`fastcheck/journal-run.mjs`. Those files separate two claims that are easy to
blur: the provers establish universal fold algebra for a typed local/shared
kernel, while fast-check exercises the concrete event guards. Lean's
`JournalRefinement.lean` additionally proves the accepted L2 claim/crash and
regional-failure projections through the concrete Lean fold. No artifact
proves that the separately authored JavaScript and prover interpreters are
identical for all inputs.

## Proposition 1 — the bound (I1)

*Selection never exceeds the configured ceiling.*

The cheapest invariant in the catalog, and the one that shows the four
fundamentally different things a "check" can mean.

**fast-check** — sampled falsification. Fails by exhibiting an input.
```js
const selected = selectedOf(tickets, capacity, mutant)
return selected.length <= capacity
```

**Quint** — a state predicate the engine evaluates at every visited state.
```quint
val boundRespected: bool = selected.size() <= capacity
```

**TLA+** — the same, in a different surface syntax.
```tla
BoundRespected == Cardinality(Selected) <= capacity
```

**Alloy** — a constraint whose *negation* is searched for.
```alloy
pred boundRespected { #Selected =< Runtime.capacity }
```

**Dafny** — a postcondition. The function is rejected if it cannot be proved.
```dafny
function Select(capacity: nat, eligible: seq<nat>): seq<nat>
  ensures |Select(capacity, eligible)| <= capacity
```

**Lean** — a theorem, proved by induction, for all inputs.
```lean
theorem select_bounded (n : Nat) (ts : List Nat) : (select n ts).length ≤ n := by
  induction n generalizing ts with
  | zero => simp [select]
  | succ n ih => cases ts with
    | nil => simp [select]
    | cons t ts => simpa [select] using ih ts
```

**Agda** — the same theorem, no tactics, three clauses.
```agda
select-bounded : forall (n : Nat) (ts : List Task) -> length (select n ts) <= n
select-bounded zero    _         = z<=n
select-bounded (suc _) []        = z<=n
select-bounded (suc n) (_ :: ts) = s<=s (select-bounded n ts)
```

What to notice: the first four *check* a claim, the last three *establish* it.
Only Alloy reports a counterexample as a structure; Dafny and the proof
assistants report an unproved goal instead, which tells you less about the
input and more about the specification.

## Proposition 2 — one attempt per task (I10)

*At most one planned attempt per task is unsettled, including across recovery.*

**This is the important one.** It is where the model checkers and the proof
assistants stop being two dialects of the same thing.

**TLA+** — you state the property and TLC finds the reachable states itself.
```tla
OneAttemptPerTask == \A t \in Tasks : tickets[t].attempts <= 1
```
That is the whole obligation. TLC enumerates 96 000 states and reports clean in
two seconds. You never learn *why* it holds.

**Lean and Agda** — the same predicate is **not provable**.
```lean
def attemptsBounded (s : St) : Prop := ∀ t, (s.ticket t).attempts ≤ 1
```
In the `planAttempt` case the hypothesis `attempts ≤ 1` permits `attempts = 1`,
and the action produces `2`. The induction is stuck. It only goes through once
the invariant is strengthened with a fact about *phases*:
```lean
def phaseBoundsAttempts (s : St) : Prop :=
  ∀ t, ((s.ticket t).phase = noObligation ∨ (s.ticket t).phase = claimed)
        → (s.ticket t).attempts = 0
```

And here is that strengthening being consumed, in both languages:

```lean
-- lean/L2.lean, planAttempt case
(by simp [h.phaseAttempts t (Or.inr h2)])
```
```agda
-- agda/L2.agda, planAttempt case
attA s t _ (subst (\ n -> suc n <= 1) (sym (phaseAttempts i t (inr e))) (s<=s z<=n))
     (attemptsOk i)
```

The tactic is shorter. It is not doing anything the `subst` is not.

**Alloy** can be asked the induction question directly:
```alloy
check attemptsAloneIsInductive {
  (attemptsBounded and step) => after attemptsBounded
} for 2 Task, 5 Int, 2 steps          -- SAT: a counterexample to induction
check invIsInductive { (Inv and step) => after Inv } for 2 Task, 5 Int, 2 steps
                                       -- UNSAT: the strengthening works
```
The SAT result hands back the missing case in 49 ms: `phase = Claimed`,
`attempts = 1`, one `planAttempt`, `attempts = 2`. Unreachable from `init`, and
that is the point — a strengthening excludes states the transition relation
permits but the reachable set never contains.

**Quint** asks it of the same file the model checker reads, one flag apart:
```sh
quint verify deliveryCore.qnt --inductive-invariant inductiveCandidate
#   -> CTI: tickets[0] = { phase: Claimed, attempts: 1 } then attempts: 2
quint verify deliveryCore.qnt --inductive-invariant inductiveInvariant \
                             --invariant allInvariants        # -> [ok]
```
Same counterexample as Alloy, 15 seconds instead of 49 ms, and one extra
obligation: Apalache starts the check *from* the invariant, so
`inductiveInvariant` must bound every variable and prove `step` respects the
bounds. Alloy's `for 2 Task, 5 Int` states that bound outside the formula and
never asks.

**Dafny** puts the same inductive invariant in a class invariant, and each
method's `ensures Valid()` is one case of the induction:
```dafny
ghost predicate Valid() reads this {
  && (forall t :: t in Tasks ==> tickets[t].attempts <= 1)
  && (forall t :: t in Tasks && (tickets[t].phase == NoObligation || tickets[t].phase == Claimed)
        ==> tickets[t].attempts == 0)          // the same strengthening
}
```
Drop the second clause and `PlanAttempt` stops verifying. Same obstruction,
reported as a method failing to re-establish its own invariant.

**The lesson to take from reading these six side by side:** a model checker
*discovers* the reachable set; a proof assistant makes you *characterize* it;
Alloy and Apalache will tell you mechanically which characterization you are
missing.
The 500-line proofs and the tactic fluency are mechanical next to that one
requirement. This is what the literature means by the human residue that
automation has not removed.

The compensation is real, though: TLC needs `MaxAttempts`,
`MaxExternalAdvance`, and a `StateConstraint` or it never terminates. Those are
concessions to enumeration, not domain facts. The Lean and Agda proofs have no
such bounds — `head`, `attempts`, and `capacity` are unbounded. Neither
generalizes over the *task set*, though: `TaskId := Bool` everywhere, still two
tasks.

## Proposition 3 — the vacuity check

*Is the thing we just proved about anything at all?*

Every tool can report success over an empty or uninteresting state space, and
none of them warns you. So each encoding carries an explicit reachability
witness, and they look completely different.

**Quint** — witness counts, as percentages of sampled traces.
```
settledReached was witnessed in 6 trace(s) out of 50000 explored (0.01%)
```
A pass with a number like that has not checked anything interesting. Run
`quint/run.sh --witnesses` to reproduce.

**TLC** — refute the negation. A reported violation means the state *is*
reachable.
```tla
NoStaleHeadReached == \A t \in Tasks : tickets[t].phase # "Integrating"
                                       \/ tickets[t].expectedHead = targetHead
```

**Alloy** — `run` instead of `check`. SAT means reachable.
```alloy
run staleHeadIsPossible {
  wellFormed and some t : Ticket |
    t.phase = Integrating and t.expectedHead != Runtime.targetHead
}
```

**Lean / Agda** — write the trace by hand, state by state.
```lean
theorem s4_reachable : Reachable s4 :=
  Reachable.step (Reachable.step (Reachable.step
    (Reachable.step Reachable.init (Step.observeGraph init false true true))
    (Step.acquireClaim s1 false rfl rfl))
    (Step.planAttempt s2 false rfl rfl))
    (Step.beginWork s3 false rfl rfl rfl (by decide))
```

This is work the model checkers do for free, and it is the single most
skippable part of a proof development — which is exactly why it is the part
worth being disciplined about. `stale_head_is_reachable` exists because mutant
M6 was undetectable until the model could advance the integration target from
outside; without that action the compare-and-set guard is unreachable and I13
holds vacuously in *every* tool.

## Proposition 4 — no silent drop (I18)

*Every begun responsibility eventually settles or is retained together with an
exact stated reason.*

The first temporal proposition, and the one that shows what safety cannot see.

**TLA+** — leads-to, and an environment hypothesis that safety never needed.
```tla
EveryBegunSettles ==
  (EventuallyStable /\ EventuallyRunning /\ EventuallyRoomy) =>
    \A t \in Tasks : (tickets[t].phase = "Executing") ~> Terminal(t)
```

**Alloy** — the same shape, since `always`/`eventually` are first-class.
```alloy
all t : Task |
  always (t.phase = Executing implies eventually t.phase in Settled + Abandoned)
```

**Quint** — states it best of the three, and cannot check it.
```quint
temporal everyBegunSettles =
  (fairness and eventuallyStable and eventuallyRunning and eventuallyRoomy)
    implies TASKS.forall(id => always(...))
```

**Dafny** — no encoding exists. There are no temporal operators.

**fast-check** — not the proposition at all, but a bounded surrogate: random
prefix, stop the environment, run a fair scheduler, assert it drains.

What to notice: the properties are nearly identical everywhere they can be
written, and *all* the difficulty is in the spec around them. Compare the
fairness blocks instead — `tlaplus/DeliveryLiveness.tla` has 21 `SF_vars`
conjuncts, `alloy/DeliveryLiveness.als` writes the same schema out by hand ten
times plus ten `enabled` predicates Alloy cannot derive, and Quint says it in
one `strongFair` per action and then has no engine.

Then compare the *hypotheses*, which is where the real content is:

```tla
EventuallyStable  == <>[](~crashed)
EventuallyRunning == <>[](~paused)
EventuallyRoomy   == <>[](capacity > 0)
```

Three, and each names something the environment may do forever. Now read the
one that is deliberately **absent**. Under weaker fairness, I18 fails with a
lasso cycling `Executing → SuspensionRequested → Suspended`, and an
`EventuallyUninterrupted` hypothesis would make it pass. So would per-action
strong fairness. Both fixes work; they are not equivalent, and no tool in this
directory can tell you which is right.

`docs/CONTEXT.md` can: safe suspension is defined as preserving what is needed
to resume, so progress survives the cycle and the lasso is an artifact of work
being atomic in the model. Per-action SF abstracts the real guarantee; the extra
hypothesis assumes the operator away and weakens the claim.

`tlaplus/run-liveness.sh --lasso` runs all three,
`interruptionForeverBreaksI18` in the Alloy file hands the cycle back as a
steppable structure, and **the resolution is in neither place.**

## Where to start reading

1. `agda/L1.agda` — shortest complete artifact, 145 lines, shows the
   invariant-as-type move.
2. `tlaplus/Delivery.tla` — the most readable full protocol, and the engine
   that performed best.
3. `alloy/DeliveryL2.als` — read `attemptsAloneIsInductive` before opening
   either L2 proof; it explains what the proofs are up against.
4. `lean/L2.lean` then `agda/L2.agda` — the same proof twice; read the
   `planAttempt` case in both.
5. `tlaplus/DeliveryTranspiled.tla` — what `quint compile` emits. Read against
   the hand-written module to see what Quint's surface syntax is buying.
6. `tlaplus/DeliveryLiveness.tla` and `alloy/DeliveryLiveness.als` — the same
   three temporal properties, and the two opposite ways a tool can fail you:
   TLC gives no verdict at two tasks, Alloy answers a weaker question in ~131s.
7. `SCOREBOARD.md` for the measurements, `GATED-SPECS-MUTATION.md` for the same
   protocol turned back on this repository's own gated models.
