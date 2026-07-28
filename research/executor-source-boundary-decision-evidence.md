# Superseded executor source-boundary ownership evidence

Status: provenance only.

This evidence supported a separate outer-invocation identity and preservation
of the detailed review-loop implementation inside the fake-provider milestone.
Issue #162 later rejected both premises. The accepted milestone boundary uses
the planned attempt's `RunId` and `AttemptId`, a stage-name-free controlled fake
executor, and shared Dalph/fake-executor process lifetime. Do not use the
requirements below to implement #158; they remain only to explain how the
superseded design arose.

Previous status: primary-source research input. The accepted
[review-loop executor source-boundary decision](review-loop-executor-source-boundary-decision.md)
supersedes this note's preliminary package and terminology recommendations.

Reopened issue #131 also supersedes this note's executor-declared
resource-use wording. Dalph owns the task-work capacity requirement. For
example, the executor reports an invocation active while Dalph updates the
state of that task's one position.

After owner grilling, v1 uses the canonical name **review-loop executor** and
an enforced module tree inside `@dalph/orchestrator`, not a new executor
package. It installs one executor bundle and may redesign unreleased journal
schemas without compatibility machinery. Durable executor protocol identity,
multiple installed executors, switching, and mixed-executor recovery remain in
issue #127; the accepted v2 direction binds executor ownership per planned task
attempt rather than per run.

## Decision

Create a new, focused implementation ticket as a **Wayfinder reconciliation of
issue #133**, and make it block the later map slices that rely on truthful
generic reconstruction and activation. Do not reopen #133 and do not assign the
work to #127.

The person-visible behavior does not change: when an accepted task attempt
needs implementation, evidence capture, review, handback, or recovery, the
selected review-capable executor still performs the same steps and generic
Dalph still schedules only opaque outer invocations. The defect is that the
source boundary does not tell that same story. Generic reconstruction and
activation currently import the selected executor directly, generic managed
history validates review/convergence facts, and the shared operation/interpreter
algebra exposes review and handback methods. A focused ticket can correct those
dependencies without adding executor selection, a registry, plugins,
configuration, or a second production executor.

This is Wayfinder work because the accepted map must reconcile a closed ticket's
written result with the surviving source graph before it publishes the remaining
implementation dependency graph. Issue
[#126](https://github.com/dearlordylord/dalph/issues/126) explicitly owns that
ticket-and-edge publication. Issue
[#127](https://github.com/dearlordylord/dalph/issues/127) explicitly calls
configurable pipelines future research, and its owner comment says to wait for
v1 use before choosing per-run versus per-invocation protocol selection or
extracting that future composition seam
([owner comment](https://github.com/dearlordylord/dalph/issues/127#issuecomment-5096059650)).
The new ticket must therefore be narrower: make the one already-selected
executor a truthful source component and inject its one bundle at the
composition root.

## Answers to the required Wayfinder questions

### 1. What did #133 actually accept?

Issue #133 was closed under a narrower, behavior-facing interpretation, but
that interpretation is narrower than its written required result.

The live issue required generic frontier, admission, reconstruction, and
activation modules to contain no evidence-, review-, findings-, or
handback-specific knowledge, with those names remaining only inside the
selected executor protocol and adapter
([issue #133](https://github.com/dearlordylord/dalph/issues/133)). The accepted
handoff repeats the same requirement and asks for proof that no generic module
retains that vocabulary
([handoff lines 17–37](issue-131-handoffs/issue-133-executor-boundary.md#L17-L37)).
The closing comment reports typed outer projection, declared capacity, and
recovery behavior, but does not report a source/import constraint
([closing comment](https://github.com/dearlordylord/dalph/issues/133#issuecomment-5094881864)).

The implementation did achieve the coarse runtime view: outer types expose
only correlation, declared capacity, waits, interruption, and outcomes
([executor-boundary.ts lines 4–79](../packages/orchestrator/src/executor-boundary.ts#L4-L79)).
However:

- `managed-history.ts` imports the selected executor directly
  ([line 23](../packages/orchestrator/src/managed-history.ts#L23)) and itself
  validates implementation dispositions and review/handback retry exhaustion
  ([lines 340–403](../packages/orchestrator/src/managed-history.ts#L340-L403));
- `managed-activation.ts` directly imports reconstruction, projection,
  continuation, stage recovery, and worker lookup from the selected executor
  ([lines 23–29](../packages/orchestrator/src/managed-activation.ts#L23-L29)) and
  calls its projection while deriving the generic frontier
  ([lines 147–205](../packages/orchestrator/src/managed-activation.ts#L147-L205));
- the common `WorkflowOperation` identity projection still switches over
  `SealImplementationEvidence`, `ReviewImplementation`,
  `HandBackReviewFindings`, and `RecordImplementationDisposition`
  ([workflow-operation.ts lines 255–265](../packages/orchestrator/src/workflow-operation.ts#L255-L265));
  and
- the common `WorkflowInterpreterService` still requires handback, evidence
  sealing, and review methods
  ([workflow.ts lines 287–301, 329–340, and
  365–373](../packages/orchestrator/src/workflow.ts#L287-L373)).

The follow-up verification accurately records the mismatch: it says behavior
was covered while import direction remained protected only by review/scans, and
that `managed-history.ts` and `managed-activation.ts` select the protocol
directly
([lines 117–125](issue-131-handoffs/issue-133-followup-verification.md#L117-L125),
[lines 128–166](issue-131-handoffs/issue-133-followup-verification.md#L128-L166)).
Its statement that the work “belongs with #127” is a follow-up disposition, not
the live #133 acceptance result, and the later live #127 owner comment
explicitly defers that broader composition decision.

Therefore the surviving shared algebra is unresolved #133 acceptance debt. A
new reconciliation ticket preserves #133's closed implementation provenance
while giving the missing source result a reviewable scenario, tests, and
blocking edges.

### 2. Must the algebra split before a second executor?

Yes, split executor-internal operations from the orchestrator-facing
operation/interpreter algebra for truthful v1 ownership. Do not wait for a
second executor.

The accepted architecture says the executor owns implementation, restoration,
review, and artifact strategy, while Dalph owns recorded workflow history and
coordination responsibilities
([architecture decision lines 107–119](resumable-frontier-architecture-decision.md#L107-L119)).
The canonical specification already says generic reconstruction and activation
retain only outer correlation, resource use, wait/interruption, and outcome and
do not inspect executor artifacts
([specification lines 122–139](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#L122-L139)).
That ownership rule is about the current system, not hypothetical
multi-executor configuration.

The split should preserve one generic journal transport and envelope, while
moving selected-executor operation variants, internal event schemas and causal
validation, evidence/review artifacts, recovery, and provider adapters behind
one selected-executor runtime bundle. Generic orchestration should consume only
the outer boundary and that injected bundle's outer methods. This is a source
and dependency correction; it does not change the accepted workflow behavior,
Quint transition semantics, retry bounds, or durable bytes.

### 3. What is the smallest replaceability tracer bullet?

Extract and inject **one statically selected executor bundle**, then prove the
generic modules against a tiny in-test substitute:

1. Define the orchestrator-facing executor service from the existing coarse
   types. It supplies reconstruction/validation results, outer projection,
   continuation, fresh provider-capacity observation, and wake information.
2. Move the current review-capable executor's internal operation/interpreter
   members, journal-event decoding/validation, recovery, artifacts, and
   provider adapters behind that service in an executor-owned package or
   package-private module tree.
3. Bind exactly one production implementation in the application composition
   root. No registry or configuration is introduced.
4. Run generic reconstruction, frontier, admission, and activation tests with a
   minimal direct/no-review fake bundle whose internal stage name is absent from
   generic source and output. The fake is test evidence, not a second product
   executor.
5. Enable an import rule in the same change so generic modules cannot import
   the selected implementation or its internal types.

This uses the already-proven outer vocabulary rather than inventing another
protocol. The existing high-cardinality test proves deterministic projection
for the current selected adapter, but it imports that adapter itself
([executor-boundary-reconstruction.test.ts lines
29–35 and 112–138](../packages/orchestrator/src/executor-boundary-reconstruction.test.ts#L29-L138));
it is not yet a replaceability test.

### 4. Who owns internal journal events, artifacts, recovery, and adapters?

The **selected review-capable executor package** owns:

- executor-internal operation and event schemas, codec extensions, causal
  validation, and internal reconstruction;
- implementation/review evidence types and stores;
- review, handback, convergence, retry, and internal restoration logic; and
- coding-agent, reviewer, handback, and related executor-provider adapters.

The generic orchestrator package owns outer invocation identities and schemas,
the generic journal store/envelope and append/read capability, responsibility,
frontier, admission, activation, and normalized outer outcomes. The production
composition root may depend on both packages and install the selected executor.
The dependency must not run from generic orchestration to selected-executor
internals.

This package split follows the accepted authority table: the executor owns its
algorithm, sessions/invocations, review/restoration strategy, and internal
artifacts; the workflow journal owns only recorded managed workflow history
([specification lines 48–60](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#L48-L60)).
“Executor owns internal journal events” means it owns their schema, meaning,
validation, and interpretation; it does not create a second persistence
authority or a second journal.

### 5. Which tests and constraints prove the boundary?

The new ticket's scenario-to-test mapping should include:

| Concrete scenario | Required proof |
| --- | --- |
| Generic Dalph reconstructs a run containing selected-executor history. | A generic reconstruction test receives only the injected bundle's outer reconstruction result; its fixture and assertions name no internal review/evidence/handback stage. |
| Generic Dalph derives, admits, and continues an outer invocation. | Activation/frontier/admission tests use a direct/no-review fake bundle and assert only correlation, declared resource use, wait, continuation, and outcome. |
| The selected review-capable executor resumes after each accepted crash cut. | Existing focused in-memory and SQLite executor tests remain with the executor package and retain the #133 scenario-to-test matrix. |
| A developer imports an executor-internal module from generic reconstruction, frontier, admission, or activation. | ESLint `no-restricted-imports` (or an equivalent checked dependency rule) fails. The current ESLint rules contain no such restriction ([eslint.config.mjs lines 210–258](../eslint.config.mjs#L210-L258)). |
| A generic source, emitted declaration, trace, or snapshot contains an internal stage name. | A checked source/import scan plus code-connected API/trace snapshot rejects `review`, `reviewer`, `findings`, `handback`, `evidence sealing`, and the selected adapter path in the named generic module set. |
| Production chooses the current executor. | A composition test proves the root installs exactly the review-capable bundle without registry/configuration machinery. |

Keep the existing tests that prove typed capacity declaration and normalized
outcomes
([executor-boundary.test.ts lines 40–85 and
155–231](../packages/orchestrator/src/executor-boundary.test.ts#L40-L231)).
Move tests that deliberately know review/evidence internals beside the selected
executor. Aggregate test counts are not evidence for this source boundary.

## Existing specifications and tasks to revise

1. **Issue #126:** add the new focused implementation ticket and native blocking
   edges to the Wayfinder ticket graph. Its accepted operational scenarios must
   begin with the concrete current selected-executor invocation and map every
   scenario above to a named test.
2. **Issue #133:** leave it closed; add a reconciliation link from its history
   to the new ticket. Do not rewrite the completion commit as though the coarse
   outer-boundary work failed.
3. **Issue #127:** keep it open as future research for configurable pipelines
   and the per-run versus per-invocation selection decision. Revise/cross-link
   only enough to state that the new ticket extracts one static selected
   executor and does not implement #127.
4. **`docs/CONTEXT.md` and `docs/ARCHITECTURE.md`:** preserve the current
   uncommitted corrections because they truthfully identify the selected
   executor as the actor. Replace their statement that #127 owns the surviving
   source split with the accepted new ticket once it exists, and record the
   final package/import ownership.
5. **`docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md`:** strengthen the executor outer
   protocol's conformance clause from behavioral opacity to source/import
   opacity and add the scenario-to-test mapping. This is not a modeled behavior
   change unless the implementation changes durable events, external calls,
   retry/crash rules, or outcomes.
6. **`research/resumable-frontier-architecture-decision.md`:** add a
   reconciliation note to the retained/refactored `WorkflowOperation` and
   `WorkflowInterpreter` disposition: only orchestrator-facing members are
   retained there; current executor-internal members move with the selected
   executor. Preserve the historical decision rather than silently changing
   its baseline.
7. **The #133 handoff and follow-up verification:** keep them as historical
   evidence. A new accepted decision/handoff should supersede only the
   follow-up's assignment of the source seam to #127 and should carry the new
   scenario-to-test mapping.

No production file, test, accepted model, or GitHub state was changed by this
research note.
