# Superseded review-loop executor source-boundary decision

Status: superseded by issue #162's planned-attempt executor decision.

This record previously treated a separately identified outer invocation and
the current detailed review-loop implementation as v1 milestone requirements.
That was premature: the executor's inner workings had not been accepted as
milestone design.

The accepted milestone boundary is now:

- generic Dalph identifies executor work by the planned attempt's `RunId` and
  `AttemptId`, with no `ExecutorOuterInvocationId`;
- one admitted planned attempt keeps one task-work position until its complete
  executor work is terminal or safely suspended;
- a controlled fake executor drives the production coordination loop without
  review, evidence, handback, retry, or restoration vocabulary;
- Dalph and the fake executor share one process lifetime during the milestone;
  and
- adapting or redesigning the current review-loop implementation happens after
  the fake-provider milestone.

The accepted chronological scenarios are in
`docs/scenarios/planned-attempt-executor-boundary.md`. The remainder of this
file is retained only as provenance for the superseded decision.

Previous status: accepted Wayfinder reconciliation of issue #133 under issue #126,
published as [implementation issue #158](https://github.com/dearlordylord/dalph/issues/158).

## Concrete problem

Today generic Dalph reconstruction and activation directly import the only
executor implementation. The shared workflow operation and interpreter
algebras also expose evidence capture, review, findings handback, retry, and
convergence members. The runtime already projects those actions as opaque
outer invocations, but the source graph still lets generic orchestration learn
the review-loop algorithm.

This is a source-ownership defect in the current v1 architecture. It is not a
request for executor configuration, a plugin system, or a second production
executor.

## Decision

Create one focused v1 implementation ticket. Keep issue #133 closed because it
delivered the coarse executor outer protocol, and keep issue #127 as the v2
owner for multiple/configurable executor behavior.

The v1 ticket moves the **review-loop executor** into an enforced
`review-loop-executor` module tree within `@dalph/orchestrator`. The name
describes the concrete algorithm: capture implementation evidence, invoke a
fresh reviewer, return findings to the implementer, and stop with acceptance
or bounded non-convergence. “Selected executor” is rejected because no person
or runtime mechanism currently selects among executors.

The application composition root installs one review-loop executor bundle.
Generic reconstruction, frontier derivation, admission, and activation depend
only on an injected executor-facing interface containing the already accepted
outer correlation, provider lifecycle, wait, interruption, continuation,
observation, and outcome values. Dalph orchestration separately owns the
zero-or-one task-work capacity requirement. For example, an executor may report
an invocation active, but it never asks the controller for a position.

The review-loop executor module owns:

- its internal workflow operations and interpreter members;
- its internal journal event schemas, codecs, causal validation, and
  reconstruction;
- implementation and review artifacts;
- review, handback, convergence, retry, and restoration logic; and
- its coding-agent, reviewer, handback, and related provider adapters.

Generic Dalph owns:

- the executor outer invocation contract;
- common journal record ordering, storage, and physical integrity;
- task, attempt, responsibility, frontier, admission, and activation facts;
  and
- normalized executor outer outcomes.

The implementation may redesign the unreleased journal event envelope, tags,
schemas, and codec composition when that produces a cleaner boundary. Dalph
has no released product database or durable compatibility target. The ticket
must not add migrations, upcasters, compatibility wrappers, or fallback
semantics solely for current repository fixtures.

## Smallest replaceability proof

The tracer bullet injects one executor bundle into generic reconstruction and
activation, binds the review-loop bundle in production composition, and runs
generic tests with a minimal stage-name-free test bundle. The test bundle is
proof that the outer interface is sufficient; it is not a second production
executor and creates no registry or configuration surface.

An enforced import rule prevents generic reconstruction, frontier, admission,
and activation modules from importing the review-loop module or internal
evidence/review types. Tests that deliberately know review-loop details move
beside that module.

## Issue ownership

- **#126** owns publication of the new v1 ticket and its blocking edges.
- **#133** remains closed and links forward to the reconciliation ticket.
- **#127** remains future research. It now carries the accepted v2 direction
  that executor ownership is per planned task attempt, not per run.
- **#66**, **#69**, and **#83** remain the reuse candidates for a future
  executor mismatch: clean-restart the exact attempt, perform only authorized
  cleanup, and show the problem and choices to the operator.

Issue #127 must decide protocol identity allocation, executor-owned event
routing and version compatibility, installed-handler discovery, behavior when
the old executor is unavailable, and the exact user-visible restart path. It
must not make one executor silently ignore another executor's history. Unknown
executor history may represent unfinished work or owned resources and
therefore remains fail-closed.

## Scenario-to-test mapping

| Scenario | Concrete result | Required proof |
| --- | --- | --- |
| Dalph starts one opaque review-loop invocation | Generic code sees only the outer invocation while the review-loop executor preserves existing internal behavior. | `generic activation continues an opaque review-loop invocation`; existing focused evidence/review/handback/convergence tests; checked import rule. |
| Dalph restarts while a reviewer invocation is unresolved | Generic journal reconstruction delegates executor history and restart reuses the exact reviewer invocation. | In-memory and reopened-SQLite reconstruction tests plus a stateful reviewer that completes during downtime. |
| A stage-name-free test executor drives generic orchestration | The same generic frontier/admission/activation path works without review-loop vocabulary or production multi-executor machinery. | `generic orchestration uses a stage-name-free executor bundle`; production composition test; emitted API/source scan. |

The detailed chronological scenarios are in
[`docs/scenarios/planned-attempt-executor-boundary.md`](../docs/scenarios/planned-attempt-executor-boundary.md).

## Deferred work

V1 does not add durable executor protocol identities, per-attempt executor
selection, an executor registry, multiple installed production executors, or
executor-switch commands. Issue #127 owns those v2 decisions.

No ADR is added. The v1 module boundary is intentionally reversible, the
accepted authority split already exists in canonical architecture, and this
decision reconciles source ownership with that architecture rather than
choosing a new hard-to-reverse system topology.
