# Formal-model portfolio handoff

The checked frontier prototype is evidence for later specification work. It is
not a decision that Dalph should have one monolithic formal model, nor a reason
to defer executable model connections until implementation.

## Required early-stage decision

Before canonical specification synthesis closes, the coverage investigation
must publish a model portfolio. The portfolio determines the smallest set of
models that gives each important use case an executable specification and a
practical checking strategy.

For every proposed model, record:

- the concrete question and authority boundaries it owns;
- the canonical specification sections and domain types it interprets;
- the state and behavior deliberately abstracted away;
- its finite bounds, safety properties, progress witnesses, and expected
  counterexamples;
- whether it is sampled, exhaustively checked, or both, with named profiles;
- the Quint-connect adapter or other MBT seam that executes its traces against
  the shared workflow algebra and interpreters;
- the production-reopening and durable-prefix scenarios derived from it;
- its maintainer and the implementation tickets blocked by its properties; and
- whether an existing prototype is promoted, split, replaced, or retired.

The portfolio must also provide a coverage matrix from accepted use cases and
invariants to models. A use case with no model is an explicit gap. Two models
covering the same behavior must either share a named abstraction contract or
explain why the overlap is intentional and how divergence is detected.

## How to choose the number of models

Do not choose a model count in advance. Add a model when at least one of these
is true:

1. it owns a materially different authority or ambiguity boundary;
2. its state abstraction cannot be composed with another model without hiding
   the property being checked;
3. exhaustive checking of the combined state space is no longer repeatable;
4. it needs a different MBT adapter or production-reopening seam; or
5. it has a different lifecycle, maintainer, or implementation consumer.

Combine models when they have the same state authority, transition grain, MBT
seam, and checking strategy and the combined state space remains useful.
Neither a single universal model nor one model per scenario is an acceptable
default.

## Current evidence, not the final portfolio

Two useful grains already exist:

- `specs/taskWorkSessionRecovery.qnt` deeply models one task-work session
  ambiguity and recovery boundary and already participates in Quint-connect
  model-based testing.
- `prototypes/frontier-recovery/frontierRecovery.qnt` checks broader
  graph-frontier composition, pause/resume, capacity, all-boundary crash,
  reconciliation, and branch-local progress with focused exhaustive profiles.

The coverage investigation must decide whether the broader prototype becomes
one canonical composition model or is split into smaller frontier,
pause/control, and reconciliation models. That decision must be based on the
portfolio criteria and measured checking/MBT usefulness, not file size or a
preferred model count.

## Delivery gates

- Specification synthesis may not close until the model portfolio, coverage
  matrix, canonical model locations, and MBT seams are named.
- Architecture review must verify that every model maps to the same workflow
  algebra used by dry-run, live-fake, test, and production interpreters.
- Implementation tickets must link their acceptance scenarios to the owning
  model properties and state how Quint-connect traces reach the implementation.
- An implementation slice that changes modeled behavior must update its model,
  executable adapter, generated/selected scenarios, and production-reopening
  coverage in the same dependency path.

This keeps formal models upstream of implementation design and makes them
executable conformance assets rather than retrospective documentation.
