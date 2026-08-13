# Production executor policy research

Status: provisional, incomplete candidate research—not an accepted operational
specification—for
[#127](https://github.com/dearlordylord/dalph/issues/127), finalized against
Dalph `4d6c610f5` on 2026-08-12 after #167 integration.

Maintainer clarification on 2026-08-13: the executor implementation remains
deliberately unspecified. This research inventories possible implementations;
it does not select an adapter, review loop, commit-based workflow, agent
topology, or provider topology. “Production executor adapter” below means
possible implementation-specific boundary glue, never a generic Dalph
algorithm.

This document changes no Dalph runtime behavior. It does not accept a
production executor, turn the experimental review loop into product policy, or
close #127. Issue #167 is now integrated and closed; its maintained shared
cassette registry has been reread below. The remaining blocker is the product
decision itself: a maintainer must accept complete production-executor
operational scenarios before any recommendation becomes implementation
authority.

Source-audit status: every externally attributed claim below was reread against
the linked first-party specification, documentation, or pinned source on
2026-08-12. An independent research review subsequently spot-checked the
primary-source claims and found them sound, then identified four boundary gaps:
terminal quiescence, restart-stable policy persistence, unsupported provider
capabilities, and overclaiming acceptance readiness. This revision addresses
all four. The final repository reread used integrated master `4d6c610f5`; GitHub
reported #167 closed and #127 open with its `wayfinder:research` label.

## Integrated #167 reread

Issue #167 integrated 59 maintained authored cassettes through the public
production coordinator: 56 key-bearing catalog executions plus three stronger
capstone tests. The five-task diamond, ten-task restart spine, and A-to-B story
all drive ordinary planned-attempt work through Accepted-result candidate
construction, Git validation, verification, promotion, focused tracker
completion, exact completion-claim deletion, and final settlement. The
ten-task story preserves exact B/C attempt identity across coordinator restart.
The catalog convergence guard rejects `controlled`, `fake`, `synthetic`, and
dry-run vocabulary in shared delivery/cassette source; the two #167-touched
production projections reached 100% statement, branch, function, and line
coverage in the integrated gate.

That evidence validates the intended coarse boundary: generic Dalph can carry
exact planned-attempt identity, journal-first commands, current-state
projection, safe suspension, terminal reports, an accepted Git commit and its
accepted-result evidence manifest, restart, and finality without knowing
implementation/reviewer stages. It does **not**
select a production adapter, review count, provider topology, retry policy,
survivor policy, or terminal-sealing implementation. Those remain #127's
unaccepted product choices.

The concrete event under investigation is this: Alice is observing a Run.
Dalph selects an eligible tracker task, plans one attempt with an exact Base
SHA and worktree, records that it is about to ask the selected executor to
work, and then asks. An executor implementation may edit files, run commands,
use one or several agent sessions, review, lose a response, or survive Dalph;
none of those possibilities is selected. Before Dalph releases that attempt's
capacity, the executor must either return a terminal result or prove safe
suspension through the outer contract. Generic Dalph does not know what
internal evidence, if any, an implementation uses to reach either report.

## Question and evidence boundary

The question is what a real executor should do after Dalph gives it one exact
planned task attempt. The generic boundary is already settled by
[#162](https://github.com/dearlordylord/dalph/issues/162): the subject is the
attempt's `RunId` and `AttemptId`; internal provider requests, processes,
sessions, implementation steps, review steps, retries, and restoration handles
do not become generic Dalph identities. One attempt keeps its task-work
position until the complete executor work is terminal or the executor proves
safe suspension.

The research inspected:

- the current `PlannedAttemptExecutor` contract, journal-first command
  protocol, exact current-state projection, controlled fake, accepted-result
  manifest, attempt Restart protocol, and application Exit suspension path;
- the historical review-loop implementation immediately before its
  milestone-era removal, including content-addressed implementation evidence,
  independent review sessions, findings handback, bounded semantic rounds,
  technical retries, and reconstruction
  ([last pre-removal tree](https://github.com/dearlordylord/dalph/tree/6cde58ec9fb2d439d6e0035ceb055ccfbaa3e117));
- current first-party Codex app-server protocol documentation and source at
  [`openai/codex@631bbb33`](https://github.com/openai/codex/tree/631bbb33cc0b92da7a7eb232c874462caa8f1e44),
  especially thread resume, turn interruption, background-terminal cleanup,
  and detached review;
- Anthropic's first-party Claude Code and Managed Agents session
  documentation as observed on 2026-08-12;
- the Model Context Protocol Tasks and cancellation specifications; and
- the pinned Symphony and Kandev source audits already checked into this
  repository, used only as find aids; claims retained here cite the owning
  specification or source directly.

External APIs are moving targets. Citations to an unversioned official page
establish what that owner documented on the audit date, not a permanent Dalph
compatibility promise.

The current repository claims above are grounded in
[`executor.ts`](../packages/contracts/src/executor.ts),
[`executor-locator.ts`](../packages/contracts/src/executor-locator.ts), the
[`planned-attempt executor scenarios`](../docs/scenarios/planned-attempt-executor-boundary.md),
and the [`changed-attempt Restart scenarios`](../docs/scenarios/issue-66-clean-restart-changed-attempt.md).
Those sources establish the coarse boundary and accepted restart behavior;
they do not establish any proposed inner production policy in this document.

## Boundary conclusion and unaccepted implementation questions

Dalph must not specify a universal implementation or review pipeline. No first
production implementation has been selected. The existing opaque executor
locator does not imply a plugin system or authorize generic Dalph to learn how
an executor implementation works. A direct implementation, one or several
agent sessions, a review loop, a managed remote executor, or another algorithm
remain possibilities rather than accepted product behavior.

If a later accepted scenario selects a concrete executor implementation, that
implementation specification will need to answer questions such as:

1. Resolve the planned attempt's existing opaque `TaskExecutorLocator` to one
   installed adapter and one immutable policy snapshot before crossing a
   provider boundary. The adapter must durably bind that snapshot to the exact
   planned `RunId` and `AttemptId` before its first provider, tool, or
   subprocess effect. A locator should be stable enough to resolve the
   same adapter after restart, but the immutable policy snapshot—not mutable
   process configuration—fixes the already-selected policy; generic Dalph
   should not parse its internal version or configuration.
2. Give the implementation the exact planned attempt. Its private protocol owns
   any implementation orchestration, lifecycle obligations, evidence meaning,
   retry policy, and convergence decision it actually introduces. The
   execution substrate remains authoritative for live sessions and processes;
   the evidence store remains authoritative for immutable bytes. The adapter
   retains exact references and rereads those authorities instead of copying
   their facts.
3. Require the adapter to expose a read-only exact-attempt projection and to
   distinguish unsupported, temporarily unavailable, incompatible, running,
   safely suspended, and terminal conditions. Failure to resolve or project
   exact state is not a fabricated terminal failure.
4. Accept `SafelySuspended` only after the adapter has proved that every
   activity it owns is stopped or is itself durably suspended and unable to
   keep changing the attempt. A queryable handle to work that is still running
   is restoration evidence, not suspension evidence. The adapter must also
   validate enough retained state to resume the same attempt; conversation
   persistence alone is insufficient.
5. Define how the implementation earns each terminal report without exposing
   its inner workflow. Today `Accepted` carries the Git commit and an
   accepted-result evidence manifest proving only that the exact attempt
   accepted that commit; it does not prove review. `Failed` and `Completed`
   expose no corresponding evidence reference. The accepted outer meaning
   still requires that no executor-owned activity can keep changing the
   attempt. Any private sealing, session, or process protocol belongs to the
   selected implementation and cannot be inferred here.
6. Bound semantic correction and transient technical retry independently.
   Exhausting either selects a failed disposition, but produces
   `Terminal(Failed)` only after the common terminal seal proves no owned
   activity can still change the attempt. Executor-owned diagnostic evidence
   explains the exhausted bound; the adapter must not silently loop or let
   generic Dalph infer a review policy. The current `Failed` result carries no
   evidence reference, so #127 must either add one opaque diagnostic reference
   or accept that generic Dalph can show only failure while an adapter-specific
   surface owns the explanation.
7. Change executor policy only through an explicit Operator action. Reusing the
   existing exact Restart protocol requires P1's exact `SafelySuspended`
   evidence before Alice chooses Restart. A late `Accepted` report may satisfy
   quiescence only after that Restart choice is already applied and fresh
   tracker/Git checks still authorize replacement; `Completed` and `Failed`
   do not authorize P2. Preserve the old worktree and evidence, record a
   distinct successor attempt atomically, and never reuse the old attempt
   identity for different policy. A new command that accepts other terminal
   states would be a novel product decision and amendment, not reuse of #66.

This is an inventory of later composition questions, not a V1 registry, plugin
system, or selected built-in implementation. A map from opaque locators to
installed Layers would become relevant only if accepted scenarios eventually
require more than one concrete implementation. It must not be extracted merely
because this research can describe it. Earlier issue comments discussed one
statically installed bundle while deferring multiple-executor selection; they
do not select the bundle's inner algorithm
([#127 single-bundle scope](https://github.com/dearlordylord/dalph/issues/127#issuecomment-5104706022),
 [#127 composition constraint](https://github.com/dearlordylord/dalph/issues/127#issuecomment-5096059650)).

## Why “resume,” “stop,” and “safe” must remain separate

Current provider protocols make three different claims:

- **Conversation continuation.** Codex `thread/resume` reopens stored history;
  Claude Code exposes session resume; Claude Managed Agents preserves history
  and checkpoints an idle sandbox. These mechanisms can make later work more
  effective, but they do not prove that an earlier process or tool call is no
  longer running
  ([Codex resume](https://github.com/openai/codex/blob/631bbb33cc0b92da7a7eb232c874462caa8f1e44/codex-rs/app-server/README.md#L351-L361),
  [Claude Code CLI resume](https://docs.anthropic.com/en/docs/claude-code/cli-usage),
  [Managed Agents idle checkpoint](https://platform.claude.com/docs/en/managed-agents/events-and-streaming#resuming-an-idle-session)).
- **Turn interruption.** Codex reports an interrupted turn only after
  `turn/completed`, but explicitly says that interruption does not terminate
  background terminals. Those require a separate list/clean/terminate path,
  which the pinned app-server documentation marks experimental
  ([Codex interruption and terminal cleanup](https://github.com/openai/codex/blob/631bbb33cc0b92da7a7eb232c874462caa8f1e44/codex-rs/app-server/README.md#L1121-L1169)).
  Managed Agents accepts `user.interrupt`, but the resulting idle event uses
  the same `end_turn` stop reason as ordinary completion, so the adapter cannot
  derive “interrupted safely” from that reason alone
  ([Managed Agents interruption](https://platform.claude.com/docs/en/managed-agents/events-and-streaming#integrating-events)).
- **Durable task cancellation.** MCP Tasks exposes a queryable task state and
  a dedicated `tasks/cancel` operation. A receiver should try to stop the task
  but must report it `cancelled` before replying and must leave that state in
  place even if execution later completes or fails. A cancelled task state is
  therefore explicitly not proof that arbitrary subprocesses or tool side
  effects are quiescent. Generic MCP request cancellation is weaker still: a
  receiver may ignore it when processing has completed or cannot be cancelled
  ([MCP Tasks cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-cancellation),
  [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)).

Therefore a production adapter needs a provider-specific quiescence protocol.
It may combine a completed turn interruption, a background-process census,
provider task/session status, and execution-substrate child-process exit. A durable
handle to an executing remote task is useful for restart projection but cannot
authorize suspension. None of those observations should leak through the
generic boundary as a provider session ID or process ID. Together, only when
they prove no owned activity can continue changing the attempt, they authorize
the adapter's one exact `SafelySuspended` report.

## Concrete candidate stories

These are domain-specialist-readable research stories, not yet accepted
operational scenarios. Each names the competing outcome that #127 still has to
settle.

They remain incomplete examples pending maintainer acceptance. The
integrated #167 cassette-registry reread confirms the coarse boundary but does
not fill in production-executor policy. In particular, these stories do not
yet settle the affected person's exact command or observation surface; the
complete starting tracker, Git, executor, and Journal facts; one concrete
trigger; the selected provider and every chronological boundary call; the
durable location and schema of any implementation-private policy snapshot and
request intent/observation records; whether an implementation reviews at all;
any semantic-round and technical-retry limits; which
remote activities may survive Dalph; every crash cut and retry result; the
visible and forbidden results; concrete reasons when a person, boundary, crash,
or retry does not apply; or the acceptance-test names and negative controls.
Story 5 must also split Pause and application Exit into separate triggers before
acceptance. Where the stories below offer competing outcomes, ticket A must
choose one rather than copying both into an implementation specification.

### 1. One implementation reaches an evidence-backed accepted commit

Alice is observing a Run in which Dalph selected an eligible tracker task. Its
planned attempt P binds Base SHA B, worktree W, and executor locator E. Dalph
has recorded its responsibility and the exact start-or-continue command intent.
The adapter resolves E to an immutable policy snapshot. Before the first
provider or tool effect, it durably records an adapter-protocol policy snapshot
binding P's exact `RunId` and `AttemptId`, E, and the immutable policy
fingerprint and evidence-store content reference, then records the exact
provider-request intent separately. Only then does it
start or resume its implementation provider in W and observe the provider's
streamed tool and message events. If it crashes before that record is durable,
restart crosses no provider boundary. If it crashes after the record but before
or during the first provider request, restart reuses that exact snapshot, reads
the adapter intent, and reconciles the exact provider request before repeating
anything. A changed installed default cannot change P's policy after either
crash cut.

The provider reports that it is finished. The adapter does not treat that text
or process status as acceptance. It asks Git for W's current state, reads the
diff from B, runs the policy's required verification, resolves one exact commit
C, and seals a manifest correlating C with P. If a future selected
implementation requires review, it gives a separate reviewer agent session the
exact evidence selected by that implementation, not an unbounded live
workspace view. The reviewer is instructed not to modify the worktree; a
different model or provider is a possible later policy, not part of
“independent,” and the role is not human. The reviewer accepts it. The adapter
returns `Terminal(Accepted(C, manifest))` only after the common terminal protocol has
enumerated every adapter-owned activity, proved none can continue changing W,
and sealed that quiescence evidence with C and the manifest. Dalph records that
report before the task-work position is released.

If Dalph dies after sending the command but before recording the report, the
next process first projects E's exact state. It records the projected terminal
report instead of starting a second implementation. Alice sees the accepted
commit and evidence. Dalph must not infer C from branch `HEAD`, a clean process
exit, or reviewer prose. A negative control leaves one background terminal or
remote task alive after C is sealed and forbids the terminal report and
position release.

Why this is plausible: Codex app-server exposes a dedicated detached or inline
`review/start` operation against uncommitted changes, a base branch, or a
specific commit
([Codex review](https://github.com/openai/codex/blob/631bbb33cc0b92da7a7eb232c874462caa8f1e44/codex-rs/app-server/README.md#L1191-L1215)).
The historical Dalph review loop already demonstrated content-addressed diff,
implementation-output, and review manifests, but its exact stages and limits
remain evidence rather than requirements.

This entire review chronology is only one investigated possibility. Choosing a
reviewing implementation, a non-reviewing implementation, or some other inner
algorithm still requires owner acceptance.

### 2. Findings cause bounded correction, then visible non-convergence

The adapter has sealed round-one implementation evidence. An independent
reviewer returns exact findings. The adapter records its own internal evidence,
hands the findings to the implementer session, and creates a new immutable
evidence snapshot after correction. It never asks generic Dalph for a second
task-work position.

If a later review accepts, the story ends as story 1. If findings remain when
the policy's captured semantic-round limit is reached, the adapter returns
`Terminal(Failed)` only through the same terminal sealing protocol as
`Accepted`: it seals executor-owned non-convergence diagnostics and proof that
no provider request, remote task, model turn, tool call, background terminal,
or subprocess can still change P. With the current outer result Alice can see
only the coarse failure; she can see that the executor stopped after its
declared bound only if #127 adds an opaque diagnostic-evidence reference or
accepts an adapter-specific diagnostic surface. Generic Dalph must not parse
review rounds from that evidence. The adapter must not silently increase the
bound after restart, discard earlier findings, turn a reviewer transport
failure into a semantic finding, or report failure while one survivor remains
active. A negative control deliberately leaves one owned survivor executing
and requires a nonterminal running/unavailable observation while P keeps its
position.

The existing review loop separated semantic rounds from technical retry and
sealed cumulative finding history. That is a sound design candidate, but the
old default and the maintainer's current adapter default are not generic
product constants. A future policy snapshot should carry the chosen bound.

### 3. A transient provider failure retries without duplicating an effect

The adapter has sent one provider request under an adapter-private request
identity. The connection drops after the provider may have accepted it. The
adapter records its own intent before the call and asks the provider for the
exact request/session/task state before repeating anything. When the provider
shows the original result, the adapter consumes it. When the provider proves
absence and the policy allows retry, it waits until the captured retry time and
repeats the same logical request. When the provider cannot answer, the adapter
stays unavailable rather than guessing.

Generic Dalph sees only `Running`, a current projection failure, safe
suspension, or a terminal report. It does not receive provider request IDs or
technical retry ordinals. This follows Dalph's authority rule while permitting
very different provider protocols.

MCP Tasks is useful prior art because the receiver creates a durable task
handle, clients can poll it after reconnecting, and final results are retrieved
through the task rather than inferred from lost notifications
([MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)).
It is not sufficient by itself because support is negotiated and retention is
bounded by the receiver's TTL.

### 4. Dalph restarts while the executor process survives

P is running in a separately hosted executor. Dalph dies after recording a
start-or-continue intent. The executor process and perhaps a provider session
remain live. On startup, Dalph reconstructs P's generic responsibility and
calls `project(P)` before another command. The adapter reads its immutable
policy snapshot and append-only request protocol state, then rereads live facts
from the provider/execution substrate. It returns exact `Running`,
`SafelySuspended`, or `Terminal` evidence for P.

If it finds a provider session but cannot prove whether owned subprocesses are
still active, it returns a typed unreadable exact-state observation. That is
different from an unavailable adapter or an incompatible stored protocol. P
keeps its position unless a prior exact safe-suspension report already released
it. Dalph does not start another executor over W merely because its old local
process disappeared.

This is materially stronger than Symphony's documented restart, which forgets
worker sessions and rebuilds from tracker state plus the workspace
([Symphony restart boundary](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1688-L1715)).
Kandev demonstrates useful layered recovery—durable task sessions, provider
resume tokens, exact surviving worktrees, and lazy process recreation—but its
source also shows that provider context, filesystem state, and live-process
liveness remain distinct facts
([Kandev session model](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/models/models.go#L912-L948),
 [Kandev resume token](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_resume.go#L895-L914),
 [Kandev worktree reuse](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_lifecycle.go#L78-L129),
 [Kandev resume lock and reread](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_resume.go#L632-L712)).

Competing outcome: the first production adapter may deliberately share Dalph's
process lifetime. If so, #127 should say so and defer survivor adoption rather
than expose a false projection capability.

### 5. Pause or application Exit asks the executor to stop safely

P is running. Dalph records the exact suspension command intent, then asks the
adapter to suspend. The adapter prevents new internal work, interrupts the
active model turn, settles any already-issued tool boundary according to its
own intent/reconciliation rules, and enumerates background terminals or remote
tasks. It preserves W, commits or stores no invented user work, and validates
the provider/session handle needed to resume P.

Only after every owned activity is stopped, or the provider proves a retained
remote job is itself suspended and cannot keep changing P, does the adapter
return `SafelySuspended(P)`. A queryable handle to still-executing work is not
enough. A lost response is reconciled through `project(P)`. A provider's
interrupt acknowledgement, idle session, stopped local wrapper, or preserved
transcript alone is not enough.

Alice sees either safe suspension, a precise still-running/unavailable reason,
or a bounded application-Exit timeout. Dalph must not release the position on
process disappearance or manufacture safety to make Exit succeed.

### 6. The configured executor cannot be resolved or projected

After restart, P names opaque locator E. Five different outside facts must not
collapse. The current binary may have no installed adapter that recognizes E;
a known adapter may resolve E but lack one capability required by P's durable
policy snapshot; a known adapter may reject the stored policy/evidence protocol
version; the adapter may be temporarily unable to reach its provider or state
store; or it may read a record whose correlation contradicts P. Dalph obtains
a current read-only observation and shows Alice the exact category: unsupported
locator, `UnsupportedCapability` naming the required capability, incompatible
protocol, temporarily unavailable authority, or exact-state contradiction. An
unsupported locator or incompatible decoder crosses no provider boundary. A
capability check may use read-only provider negotiation when that is the owning
source of support, but `UnsupportedCapability` sends no implementation or
review request. None reports P terminal, and Dalph does not persist installed
support as authority instead of resolving and checking it again when needed.

If the last exact report was `Running`, P keeps its task-work position because
no safety proof exists. If the last exact report was `SafelySuspended`, it may
remain out of capacity while Alice decides what to do. Installing compatible
support lets the same attempt project and resume. A missing module must not be
treated as a failed task, a missing capability must not be presented as an
unrecognized locator, an outage must not be misreported as missing support, and
an incompatible codec or contradictory correlation must not silently fall back
to a different executor.

### 7. Alice explicitly changes policy without abandoning the old resources

P1 is pre-integration and safely suspended. Alice chooses to replace its
executor policy. Dalph records one explicit choice correlated with P1 and the
old/new policy fingerprints. It preserves P1's worktree, branch, commits,
uncommitted work, provider evidence, and journal history.

The safest existing product mechanism is the accepted Restart protocol: after
fresh tracker and Git reads, atomically record P1 as superseded and P2 as a
distinct planned attempt with a distinct exact worktree and new opaque executor
locator. P2 then enters ordinary admission. P1 is never resumed under a
different policy, and no cleanup is implied. This directly reuses the
chronology in
[`issue-66-clean-restart-changed-attempt.md`](../docs/scenarios/issue-66-clean-restart-changed-attempt.md).

A narrower in-place policy update is possible only when the selected adapter
defines it and proves it does not change the identity or meaning of unfinished
work—for example, adding a tool to an idle remote session. Anthropic Managed
Agents permits full replacement of tools/MCP configuration only while a
session is idle
([session update](https://platform.claude.com/docs/en/managed-agents/session-operations#updating-the-agent-configuration)).
That provider feature is not enough to make in-place mutation the generic
Dalph rule.

Competing outcome: owner acceptance may prefer a separate
`ChangeExecutorPolicy` command instead of extending Restart. Either way, the
old attempt must have exact `SafelySuspended` evidence before Alice uses the
existing Restart command, and its artifacts must remain disposition-owned. A
new command accepting a terminal state needs its own accepted authority rule.

## Candidate terminology and boundary shapes

These names are provisional. They describe distinct phenomena and should not
be added to `docs/CONTEXT.md` until scenarios are accepted.

### Keep unchanged at the generic boundary

- **Planned-attempt executor work**: all work for one exact planned attempt.
- **Planned-attempt executor-work report**: `Running`, `SafelySuspended`, or
  `Terminal` for the exact `RunId`/`AttemptId`.
- **Task executor locator**: the opaque planned value already present in
  `PlannedTaskAttempt`. Generic code must compare and persist it, not parse it.
- **Accepted result**: the exact Git commit plus its content-addressed
  accepted-result evidence manifest. The manifest proves the exact attempt's
  acceptance claim; it implies neither review nor later target verification.

### Add only if accepted stories require them

```text
ExecutorAdapterResolution =
  | Resolved
  | UnsupportedLocator { locator, explanation }
  | IncompatiblePolicy { locator, supportedProtocol, observedProtocol, explanation }

ExecutorCapabilityResolution =
  | Supported
  | UnsupportedCapability { locator, policyFingerprint, requiredCapability, observedSupport, explanation }

ExecutorAttemptProjectionFailure =
  | TemporarilyUnavailable { locator, authority, explanation }
  | ExactStateUnreadable { locator, explanation }
  | CorrelationContradiction { expectedRunId, expectedAttemptId, observedCorrelation }
```

Adapter resolution classifies installed/readable support before a provider
call. Capability resolution proves whether that known adapter/provider can
perform each behavior required by the durable policy snapshot.
`UnsupportedCapability` is nonterminal and distinct from an unrecognized
locator, incompatible stored protocol, or temporary outage. Attempt projection
failures classify a known adapter's current read of one exact attempt. None is
an executor terminal report or a tracker fact.

```text
ExecutorPolicyFingerprint = opaque content identity
ExecutorPolicyChangeRequest = {
  requestId, runId, attemptId,
  fromFingerprint, toExecutorLocator, toFingerprint
}
```

The fingerprint belongs in executor-protocol state or in the opaque locator's
resolution contract. A fingerprint alone is not recovery authority:

```text
ExecutorAttemptPolicySnapshot = immutable adapter-protocol state binding:
  exact RunId and AttemptId,
  executor locator,
  policy fingerprint plus evidence-store content reference,
  and policy protocol version.

ExecutorProviderRequestIntent = append-only adapter-protocol state naming:
  exact RunId and AttemptId,
  immutable policy snapshot,
  provider boundary and adapter-private request correlation,
  and the fact that the next ambiguity-crossing effect is intended.

ExecutorProviderRequestObservation = append-only adapter-protocol state naming:
  the exact earlier request intent,
  observed provider result or unreadable/ambiguous outcome,
  and the reconciliation decision before any retry.
```

The snapshot and first exact request intent must be durably acknowledged before
the first provider, tool, or subprocess effect. Observation and reconciliation
are later append-only records; they cannot be fields retroactively added to the
immutable snapshot. After a crash, the adapter rereads this protocol state,
rejects any correlation or fingerprint contradiction, rereads live
session/process facts from the execution substrate, and reconciles an
ambiguous intent with the named provider boundary before retry. It must not
recompute unfinished P's policy from a newly installed default. Do not expose
review rounds, models, provider session IDs, or retry schedules in
`PlannedTaskAttempt` merely to make the fingerprint human-readable.

If a future accepted scenario requires Alice to obtain failure diagnostics
through generic Dalph, one candidate additional outer shape is:

```text
FailedResult = { diagnosticEvidence: EvidenceReference }
```

The reference reveals no review stage or provider identity. The selected
adapter owns the diagnostic schema and meaning, while the evidence store owns
the immutable bytes; generic Dalph only preserves and presents the opaque
reference. If owner acceptance instead chooses an adapter-specific diagnostic
surface, the generic result should remain coarse and story 2 must name that
surface explicitly.

```text
SafeSuspensionEvidence = executor-private manifest proving:
  no executor-owned activity remains unclassified,
  no survivor can keep executing or changing the attempt,
  every retained remote job is authoritatively suspended and queryable,
  the same attempt can resume from retained artifacts,
  and the evidence names the exact RunId/AttemptId.
```

Generic Dalph needs the report, not this candidate internal schema. Whether a
concrete implementation retains such evidence, and what claim it proves, is an
unaccepted implementation decision.

Terminal means the complete executor work ended; it is not merely a
classification of an inner provider's last message. Generic Dalph receives
only its existing exact terminal report. A future implementation specification
must explain how that implementation establishes the claim without exporting
its private stages into the generic contract.

The existing `PlannedAttemptExecutorService` operations remain the right
coarse surface:

```text
startOrContinue(plannedAttempt) -> exact report
requestSuspension(plannedAttempt) -> exact report
project(runId, attemptId) -> optional exact report
```

The production error channel must stop mentioning
`ControlledFakeExecutorMismatch`. An implementation ticket should introduce
the provider-neutral failures needed by the selected adapter: incompatible
policy, temporary authority outage, unreadable exact state, and correlation
contradiction. `UnsupportedLocator` belongs with a later real selection seam,
not the single-adapter implementation. Provider-specific diagnostics remain
behind the adapter.

## Protocol configurability

The planned attempt already binds an opaque executor locator, so **selection
per planned attempt** is the least surprising future rule. Per-run selection
would duplicate or constrain a fact already present in every attempt. It would
also make a later replacement attempt with a different executor awkward.

That does not justify extracting a registry now. If real use later requires a
second installed adapter, the smallest candidate composition is:

```text
TaskExecutorLocator -> one of a fixed set of installed Effect Layers
```

The composition root would own this map. The generic workflow depends on the
`PlannedAttemptExecutor` service. Each adapter owns its policy decoder,
provider capability checks, evidence schemas/meaning, lifecycle orchestration,
and internal tests. It reads immutable bytes through the evidence store and
live session/process facts through the execution substrate. A missing key
produces `UnsupportedLocator`; a known adapter with an unreadable policy
version produces `IncompatiblePolicy`.

Capability negotiation should be explicit at provider boundaries. MCP peers
exchange task capabilities during initialization, and a requestor should add a
task only when the receiver declared support for that request category.
Tool-level support can then be required, optional, or forbidden
([MCP task capability negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#capability-negotiation)).
Dalph should not assume queryable task restoration merely because the provider
speaks MCP.

## Review and convergence evidence from one historical implementation

The historical review loop demonstrates mechanisms that could be reused if a
future accepted implementation chooses review:

- seal the implementation diff and output before review;
- run review from exact stored evidence for a named implementation claim and
  an exact attempt;
- use a distinct reviewer session or detached thread;
- accumulate stable finding identities;
- hand findings back to the implementer without allocating another Dalph
  task-work position;
- keep semantic correction bounds separate from transient-call retry bounds;
  and
- return evidence-backed acceptance or coarse terminal failure with explicit
  adapter-owned bounded-non-convergence diagnostics.

None of the following is an accepted requirement: review itself, a particular
number of rounds, a fresh reviewer every round, one provider for both roles,
exact handback prompt shape, commits as internal milestones, or the old event
vocabulary. Generic Dalph's outer contract does not distinguish these possible
implementations.

OpenAI Agents SDK's serializable `RunState` is useful evidence that internal
approval/handoff state can survive a process boundary, but it is a runner
checkpoint rather than proof that arbitrary shell side effects are quiescent
([OpenAI Agents HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/)).
Likewise, Claude Managed Agents checkpoints an idle sandbox but deletes that
sandbox state after its fixed retention window; important artifacts need an
independent durable destination
([Managed Agents retention](https://platform.claude.com/docs/en/managed-agents/events-and-streaming#resuming-an-idle-session)).

## Scenario-to-future-test mapping

These are required seams for later implementation tickets; no current test is
claimed to prove the production stories.

This table is evidence planning, not completion of the candidate stories'
acceptance-test field. #167 is integrated and its maintained shared cassette
registry has been reread. No row authorizes implementation until the maintainer
accepts a completed chronology containing every field inventoried above.

| Candidate story | Future acceptance evidence |
| --- | --- |
| Evidence-backed accepted commit | Production-adapter contract test starts one exact P, seals diff/output/verification/review and no-survivor evidence, returns exact `Accepted(C, manifest)`, and rejects clean exit, prose SHA, mutable `HEAD`, unsealed review, or one still-running background terminal/remote task as terminal proof. |
| Findings and bounded correction | Adapter scenario tests accepted-on-later-round and exact-limit `Terminal(Failed)` with sealed non-convergence diagnostics plus the same no-survivor proof required for Accepted; a survivor negative control forbids Failed and retains capacity. Restart retains the captured limit and finding identities; technical failures do not consume semantic rounds. The acceptance test also proves whichever generic-reference or adapter-specific surface Alice uses to obtain the explanation. |
| Durable attempt policy and ambiguous first provider request | Crash-cut tests stop before the exact `(RunId, AttemptId)` immutable policy snapshot, after its durable acknowledgement, after the separate adapter request intent, and after provider acceptance. They prove no provider effect before durability, the same snapshot despite changed installed defaults, projection/reconciliation before repeat, correlation contradiction failure, and no duplicate provider request. |
| Surviving executor process | Real child or controlled remote-task test kills Dalph, keeps executor work live, restarts Dalph, and projects the exact P without a second start. A negative control removes the query handle and requires unavailable state while capacity remains held. |
| Safe suspension | Real provider-adapter test interrupts the active turn, enumerates/settles background processes, validates resume state, and only then returns `SafelySuspended`; negative controls leave one background terminal or remote task executing and forbid the report. |
| Executor cannot resolve or project P | Composition/reopening tests separately cover an unrecognized locator, a recognized adapter missing one named required capability (`UnsupportedCapability`), unsupported policy version, provider/state-store outage, unreadable record, and correlation contradiction. Each remains visible and nonterminal; UnsupportedCapability sends no attempt-work request; all preserve capacity according to the last exact report. Installing compatible support permits the same attempt to project again. |
| Explicit policy change | Existing-Restart test accepts Alice's choice only from exact `SafelySuspended` P1, records it once, preserves P1 resources, and creates at most one distinct P2. A late `Accepted` report may prove quiescence only after the choice; Completed/Failed cannot authorize replacement. Any new command accepting other terminal states requires a separately accepted amendment. Crash cuts around the atomic replacement never run P1 under P2's policy. |
| Several executor locators | Generic conformance suite runs the same planned-attempt command/reconciliation scenarios against two test adapters while source/import checks keep their internal names out of generic orchestration. |

Every adapter also needs a capability matrix test covering: state projection,
survivor adoption, exact turn/task cancellation, background-process census,
conversation resume, evidence durability, and policy-version compatibility.
Each cell must prove support or the adapter's exact nonterminal
`UnsupportedCapability` outcome; “supported” without naming the capability is
insufficient. Every terminal variant the selected adapter can emit—Accepted,
Failed, or Completed—also needs a negative control that leaves one owned local
or remote activity live and forbids both the report and capacity release.

## Proposed implementation tickets

#167 is integrated. No implementation ticket should begin until #127's product
stories are accepted.

### A. Accept production-executor operational scenarios and policy ownership

Planning/specification ticket. Decide only what the first concrete executor
implementation must expose and deliberately leave its interior unspecified
unless a user-visible or safety requirement forces a choice. If review,
commits, evidence, process survival, or policy change is selected, publish its
chronology and scenario-to-test map rather than implying it through the generic
boundary.

This is the missing decision gate; it must not be folded into implementation
review after code exists.

### B. Make the generic boundary production-capable

Replace controlled-fake-specific failures in the public executor service with
provider-neutral unsupported-capability, incompatible-policy,
temporary-unavailability, state-read, and correlation failures. Add only the
read-only projection observations required by the selected adapter. Preserve
the existing journal-first command/reconciliation protocol and exact
`RunId`/`AttemptId` correlation. The selected adapter protocol defines the
immutable attempt-policy snapshot plus separate append-only request intents and
observations; its implementation reconciles them before another provider
effect. Do not
extract a registry, unsupported-locator path, static multi-adapter map, or
dynamic plugin loader in this ticket.

### C. Reconcile the experimental review-loop executor (#168)

[#168](https://github.com/dearlordylord/dalph/issues/168) still fits, but only
as the implementation of the adapter policy accepted by ticket A. Its current
scope correctly says to retain, change, or delete every historical review-loop
behavior rather than preserve it by default. Amend its scenario list to cover:

- evidence-backed acceptance;
- semantic versus technical bounds;
- crash recovery of internal intents and provider sessions;
- exact safe-suspension proof including background activity;
- common Accepted/Failed/Completed terminal sealing with survivor negative
  controls;
- unsupported-capability, incompatible-policy, temporary-unavailability,
  unreadable-state, and correlation-contradiction outcomes required by the
  selected adapter;
- the exact durable `(RunId, AttemptId)` policy snapshot before the first
  provider effect and every crash/reconciliation cut around it;
- terminal-failure and bounded-non-convergence diagnostics; and
- all deliberately removed old behaviors.

If ticket A chooses a non-review first adapter, #168 should be retitled and
rewritten rather than forcing the old implementation into the accepted design.

### D. Qualify process survival and restart separately

Only if ticket A allows an executor to outlive Dalph. Build real subprocess or
remote-task fixtures, kill Dalph at each command ambiguity boundary, and prove
current-state projection, duplicate-start prevention, output/event recovery,
and conservative behavior when liveness is unreadable. This ticket should not
be hidden inside unit tests for #168.

### E. Add explicit executor-policy replacement

Extend the existing changed-attempt Restart chronology or add the separately
accepted command. Existing Restart must require exact `SafelySuspended`
evidence when Alice chooses it; a late `Accepted` report can only settle an
already-applied choice, and Completed/Failed cannot authorize P2. A different
terminal-state policy requires the separately accepted command/amendment. Both
paths preserve P1 resources, freshly reread tracker and Git facts, and
atomically record at most one P2 with a new locator/fingerprint. Cleanup
remains a later typed disposition.

### F. Extract selection and add further adapters only from real use

A second-adapter ticket should extract the static composition map and prove
that the outer contract is sufficient. The ticket must start from a concrete
use that the selected adapter cannot serve and add import-direction guards at
the same time as the seam. It owns the unsupported-locator outcome and
mixed-executor-history tests. Dynamic discovery, package installation,
remote plugin trust, configuration migration, or a user-authored pipeline DSL
each needs its own security and lifecycle specification; none is justified by
#127 alone.

### Recommended blocking edges and scenario ownership

| Ticket | Candidate stories and future tests it owns | Blocking edges |
| --- | --- | --- |
| A | Accepts the chronology and exact expectations for all seven stories before any implementation test is claimed. | #167 and its reread are complete. Maintainer acceptance of the concrete policy choices is the remaining #127 decision gate. |
| B | Provides the selected adapter's nonterminal projection-failure seams used by stories 3, 4, and 6, including its distinct `UnsupportedCapability` outcome. Contract tests prove each failure remains nonterminal and preserves the last exact capacity fact. | Blocked by A; blocks the portions of #168 that cross the production executor boundary. |
| C / #168 | Implements stories 1 and 2, the selected-adapter part of stories 3, 5, and 6, the durable exact-attempt immutable policy snapshot plus separate request intent before its first provider effect, common Accepted/Failed/Completed terminal sealing, survivor negative controls, plus retained/changed/removed historical-behavior tests. | #158/#167 are complete; #168 remains blocked by the accepted #127 decision (A) and the selected boundary changes (B). If A permits an executor to survive Dalph, D also blocks completion. |
| D | Owns story 4's real-process crash cuts and the process-survival half of story 5. | Exists only if A permits independent process lifetime; then blocks C's production qualification. |
| E | Owns story 7's exact choice, fresh tracker/Git reads, atomic P1/P2 replacement, crash cuts, and preservation assertions. Existing Restart begins only from exact `SafelySuspended`; any broader terminal-state command is a new accepted behavior. | Blocked by A and by C proving the selected adapter's exact safe-suspension boundary. |
| F | Owns story 6's unsupported-locator case and the “several executor locators” conformance row. | Blocked by C plus a documented second-adapter use that the selected adapter cannot serve. |

If these become tracker tickets, copy the applicable story chronology and test
row into each ticket rather than relying on this research file as an implicit
acceptance specification.

## Tradeoffs and rejected shortcuts

### One concrete implementation, if later selected

Selecting one concrete implementation before designing multiple-implementation
composition would minimize configuration and compatibility surface. No such
implementation is selected by this research. The existing opaque locator must
retain stable meaning, and a static multi-implementation map belongs only to a
later accepted use that actually needs it.

### Review loop as one investigated implementation option

A separate, read-only reviewer agent session and exact stored evidence may help
one implementation assess its result. That is not a generic executor stage,
does not require a Git commit as an internal milestone, and has not been
selected. A different model or provider is a possible later option rather than
part of the definition; the reviewer is not a human role.

### Resume provider session whenever possible

Native resume can preserve context and reduce repeated work. Provider handles
expire, become incompatible, or preserve conversation while losing the
workspace/process. The adapter must classify each layer and be able to start a
fresh session over the preserved exact worktree when policy permits, without
calling that the same session.

### Treat cancellation as safe suspension

Rejected. Codex explicitly separates turn interruption from background
terminal cleanup, generic MCP cancellation may be ignored, and the MCP Tasks
draft does not define task cancellation as proof that arbitrary tool side
effects or child processes are quiescent. Safe suspension is an
adapter-produced proof over all owned activity, not an acknowledgement from
one cancellation endpoint.

### Persist internal stages in the Dalph workflow journal

Rejected. The journal owns workflow history, but generic Dalph must not learn
implementation, reviewer, retry, or provider topology. An adapter owns the
evidence schema/meaning, exact evidence-store references, and its internal
protocol state keyed by the exact planned attempt; the evidence store owns the
content-addressed bytes. Generic history records only command intent,
current-state observation, and exact outer report.

### Change policy in place while running

Rejected as a generic rule. It makes the meaning of unfinished work depend on
mutable configuration and makes restart ambiguous. Safe suspension followed by
an explicit successor attempt preserves authority and artifacts. A particular
adapter may support a narrower idle-session update after separately proving
compatibility.

## Post-#167 decision checklist

Before #127 can change from research to accepted design, verify:

1. **Satisfied as research evidence:** #167's integrated 59-entry maintained
   shared cassette registry exercises the complete generic planned-attempt
   boundary without internal-stage vocabulary. This does not accept an inner
   production policy.
2. Any chosen implementation policy is described as chronological person/system
   stories, including every provider call, crash point, retry, and visible
   outcome.
3. Safe suspension names every activity the selected adapter owns and the
   authoritative observation that proves each one stopped or became itself
   suspended and unable to keep changing the attempt.
4. Terminal acceptance names the exact Git commit and the content-addressed
   accepted-result manifest proving that the exact attempt accepted that
   commit. That outer manifest implies neither review nor later target
   verification. Any additional implementation-private evidence must name the
   claim it supports.
5. Unsupported locator, unsupported required capability, incompatible policy,
   temporary authority outage, unreadable exact state, and correlation
   contradiction are distinct visible nonterminal outcomes.
6. Semantic correction and transient technical retry have independent bounds
   captured before work begins.
7. The explicit policy-change story preserves old resources and never changes
   an existing attempt's meaning.
8. #168 is amended to implement only accepted behavior and delete historical
   behavior that no longer fits.
9. Process-survival claims are backed by restart fixtures at real ambiguity
   boundaries, not source inspection alone.
10. The final implementation graph keeps plugin loading and user-authored flow
    configuration deferred until a concrete user story requires them.
11. The selected adapter durably owns one immutable policy snapshot for exact
    `(RunId, AttemptId)` before its first provider effect and reconciles every
    crash cut without consulting a changed default.
12. Accepted, Failed, and any selected-adapter Completed result use one
    terminal sealing rule; survivor negative controls prove none can release
    capacity while owned activity can still change the attempt.

Until those checks pass, this research makes no production-implementation
recommendation. The only settled conclusion is to preserve the opaque
planned-attempt executor boundary and keep every unaccepted inner algorithm out
of generic Dalph.
