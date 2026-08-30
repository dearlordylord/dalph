# Verification teaching session

This is a learning checklist for the completed Dalph verification bake-off. It
changes no Dalph runtime behavior and is not another specification or proof
artifact. A box is checked only after the learner explains the idea back in
their own words and handles the listed edge case.

## Learning path

- [x] **1. What a proof claim means.** Separate the Dalph behavior, its model,
  the proposition, and the evidence produced by a checker. Explain why a green
  command alone is not proof evidence.
- [ ] **2. A bounded pure function (I1).** Explain why selection cannot return
  more tasks than the configured capacity; distinguish sampled testing,
  exhaustive bounded checking, and a theorem for all inputs.
- [ ] **3. Negative controls and vacuity.** Explain why we seed a defect and
  require the tool to reject it, and why we separately prove that interesting
  states can actually be reached.
- [ ] **4. State machines and reachable safety.** Read an initial state, an
  action guard, an update, and an invariant; explain what a bounded model
  checker does at each reachable state.
- [ ] **5. Inductive invariants (I10).** Explain base and preservation cases,
  why `attempts <= 1` is true but not inductive by itself, and why the phase
  strengthening closes the proof.
- [ ] **6. Journal folds (I15).** Explain total fail-closed reduction, replay,
  concatenation, local failure isolation, and the difference between an
  algebraic fold theorem and correspondence with the production interpreter.
- [ ] **7. Refinement (#200).** Explain how an emitted intent, a crash prefix,
  resumed folding, and the abstract L2 successor are related; identify what a
  mere event-list existence theorem would fail to establish.
- [ ] **8. Safety versus liveness (I17-I19).** Explain why “nothing bad ever
  happens” cannot establish “something good eventually happens,” and how
  fairness and environmental hypotheses change the meaning of a result.
- [ ] **9. Tool choice and proof boundaries.** Choose among fast-check, Quint,
  TLC, Alloy, Dafny, Lean, and Agda for a concrete claim; state data/time bounds,
  authored assumptions, and what remains outside the evidence.

## Stage 1 mastery check

The learner can identify these four layers in one concrete example:

1. runtime behavior;
2. simplified model;
3. proposition about the model;
4. checker evidence.

Edge case: a command can be green because the relevant action or state was
never exercised. The learner must explain why a witness or negative control is
needed before treating that result as meaningful.

## Session notes

- Baseline: “a statement from specs is proven; unsaid statements are not.”
  Correctly identifies that proof is proposition-scoped. Stage 1 still needs
  the distinction between production behavior, model, proposition, and checker
  evidence, including assumptions/bounds and correspondence.
- Stage 1 response identified two real limits of I10: it does not establish
  that any attempt is reachable, and it does not establish that an existing
  attempt belongs to the graph-valid task. Follow-up requested on how witnesses
  and negative controls address the first limitation but not the second.
- Clarification requested: whether M5 is “just more specs.” Distinction to
  master: I10 remains the unchanged oracle; M5 selects an intentionally broken
  implementation of the model's recovery transition. The research runner
  classifies a counterexample as `caught` and a clean mutant as `missed`.
- Learning preference: ground explanations in the checked-in implementation
  and provide IDE-clickable links whenever code materially clarifies the idea;
  do not force code into explanations where it would add noise.
- Stage 1 mastered: the learner distinguished proposition scope from omitted
  validity rules, recognized vacuity when no attempt is reachable, and
  correctly interpreted zero sampled witnesses as inconclusive and one as
  constructive reachability evidence.
- Stage 2 baseline: correctly classified I1 as non-liveness safety and
  `fast-check`/`quint run` success as sampled “no bad case found” evidence.
  Next mastery point: an upper bound is easy to enforce but permits the useless
  implementation that always selects nothing; compare it with exactness and
  no-invention.
