# Dalph Tooling Context

This context names repository delivery-orchestration concepts. It is separate
from every target repository's application and domain model.

## Language

**Target application**:
The product system in a repository whose work Dalph coordinates.
_Avoid_: Ralph, delivery tooling

**Repository tooling**:
Software that builds, verifies, plans, or delivers changes to the target
application without becoming part of its product runtime or domain model.
_Avoid_: Target application, product runtime

**Dalph orchestrator**:
The graph-native repository tooling that coordinates delivery work. Ralph is
the retained identity of the original research record and historical harness,
not the name of the production orchestrator.
_Avoid_: New `ralph-run.sh`, shell-harness replacement

**Historical Ralph harness**:
The one-off `scripts/ralph-run.sh` experiment and its execution formats.
_Avoid_: Ralph architecture, compatibility baseline, legacy runtime

**Candidate tooling requirement**:
A possible Dalph requirement mined from evidence but not yet accepted by an
owning decision or implementation specification.
_Avoid_: Requirement, contract

**Accepted tooling requirement**:
A Dalph requirement explicitly selected by its owning tooling decision or
implementation specification.
_Avoid_: Observed shell behavior, candidate

**Tracker fixture**:
A serialized, controlled tracker snapshot used as input for dry-run and
deterministic-test scenarios. It is not live tracker authority or managed
workflow history.
_Avoid_: Tracker state file, authoritative snapshot

**Managed execution**:
A run, attempt, claim, session, or artifact created and namespaced by the Dalph
orchestrator.
_Avoid_: Historical harness run, pre-existing workspace

**Tracker execution admission**:
The tracker-owned fact that an open task is within the Dalph orchestrator's
execution scope rather than held outside it.
_Avoid_: Capacity admission, task start

**Task execution admission**:
The coordinator-owned decision that grants a runnable task execution one of the
bounded execution-capacity slots.
_Avoid_: Tracker execution admission, task start

**Task execution start**:
The execution-substrate observation that an admitted task execution actually
began.
_Avoid_: Task execution admission, operation selection

**Task execution outcome observation**:
The execution-substrate outcome subsequently observed for a started task
execution.
_Avoid_: Task execution admission, canonical task ordering

**Operation identity**:
The stable Dalph-owned identity that causally binds one selected operation to
its intent, invocation, observations, and outcome across ambiguity and recovery.
_Avoid_: Task identity, attempt identity, journal position

**Semantic execution trace**:
The non-authoritative, interpreter-neutral projection of workflow phenomena
shared by live, dry-run, and deterministic-test execution.
_Avoid_: Authority journal, audit log, dry-run-specific trace

**Authority journal**:
The Dalph-owned managed workflow history of durable intentions and subsequently
observed outcomes used for reconciliation and recovery.
_Avoid_: Semantic execution trace, tracker state, execution-substrate state

**Journal event envelope**:
The immutable persisted identity, order, event kind, event version, and payload
of one authority-journal fact.
_Avoid_: Serialized coordinator, database row

**Git common directory**:
The canonical Git-owned administrative directory shared by a repository and
all of its linked worktrees. It is the resource scope for live coordinator
ownership, not a worktree, repository root, or Dalph control directory.
_Avoid_: Worktree `.git` file, project directory, coordinator identity

**Git common-directory target**:
A requested path that must resolve to a canonical Git common-directory locator
before either controlled or production ownership observes it.
_Avoid_: Canonical locator, coordinator identity

**Managed-history reduction**:
The total fold that derives a valid recovery state or typed semantic issues from
an ordered authority journal without persisting the derived state.
_Avoid_: Event decoding, coordinator rehydration, reducer rollup table

**Run termination**:
The final managed outcome of a run, classified as completed, blocked, cancelled,
or failed after the required authority observations and managed work settle. A
terminated run does not reopen; later matching work belongs to a new run.
_Avoid_: Empty frontier, paused run, drained run

**Run completion**:
The run-termination disposition established when every task in the run's scope
is tracker-confirmed successful and all managed work is settled.
_Avoid_: Last task success, partial success, temporary quiescence

**Dry-run completion schedule**:
The reproducible pseudo-random order in which the dry interpreter completes
simulated admitted executions for demonstration and scenario exploration.
_Avoid_: Production prediction, randomized task admission, ambient randomness
