# Issue #133 executor-boundary follow-up verification

This bounded audit checks the uncertainty follow-ups after commit
`26b6ce71751668d915d844a40f8369b9d5689811`. It does not reopen issue #133 or
replace its completed review loop. It records executable evidence that is
integrated with the code and explicitly identifies larger follow-up work.

## Findings

### Declared outer resource use

The executor supplies a typed declaration saying whether one opaque invocation
uses one task-work position. The admission controller reads only that
declaration; there is no text classification.

The zero-position variant preserves a choice that predates issue #133:
evidence sealing and terminal-disposition recording are bounded local
Git/journal/store operations, not coding-agent or reviewer work. Before #133,
those transitions carried `requiresTaskAdmission: false`. Issue #133 moved that
existing choice behind the selected executor adapter; it did not derive the
variant from a new user-facing executor use case.

The focused admission test proves that the typed declaration determines whether
the controller reserves a position. The existing Quint invariant
`declaredExecutorResourceUseIsProjected` proves that the controller-facing
projection preserves the executor-supplied declaration.

### High-cardinality reconstruction

The focused test `reconstructs hundreds of completed outer invocations
idempotently without reserving capacity` creates 512 distinct execution intent
and successful outcome pairs, then invokes the production pure reconstruction
protocol.

The result retains 512 exact `ExecutorInvocationResponsibility` entries. Each
projects to one `ExecutorInvocationSettlement`; deriving the frontier twice
returns equal values; the frontier has no transitions; a settled tracker target
permits run termination; and an admission controller rebuilt from the resulting
transitions has zero reservations.

This proves deterministic reconstruction for this 512-entry fixture. It is not
a performance benchmark and does not establish a practical upper bound.

### Executor retry deadline watcher

An executor retry deadline is the branded absolute `notBefore` timestamp in a
durable `TechnicalRetryScheduled` event. Before that instant, the selected
executor projects the exact outer invocation as waiting. At or after that
instant, it may be continued.

The current watcher has a liveness-latency defect:

1. `makeManagedRecoveryActivation` reads the frontier once.
2. It selects the earliest deadline from that snapshot.
3. It performs one `Effect.sleep` until that timestamp.
4. `JournalStore` offers `append`, `read`, and `scan`, but no change
   subscription that can interrupt the sleep.

Therefore, if another concurrently active responsibility inserts an earlier
deadline while the watcher sleeps, the watcher remains asleep until the old
later deadline. If the watched deadline is superseded, the watcher likewise
does not recompute until the obsolete sleep completes. This cannot cause work
to run before its deadline, so it is not a safety violation. It can delay legal
work and keep an otherwise idle activation asleep too long.

Existing TestClock coverage proves stable deadlines: a pending 100 ms handback
wakes after 100 ms, SQLite reopening sleeps only the remaining duration, and an
overdue deadline is immediately eligible. It does not insert or supersede a
deadline after `waitForNextExecutorWake` is already blocked.

The preferred repair is to make a journal/activation change notification race
the deadline sleep. Either result must cause a fresh frontier read before
continuation. An arbitrary polling interval would hide the missing
notification boundary and introduce an undocumented latency policy.

### Reviewer authority can change during coordinator downtime

A concrete restart timeline is:

1. Dalph records `ImplementationReviewIntended` with exact operation and
   reviewer-session identities.
2. The coordinator process dies before recording
   `ImplementationReviewCompleted`.
3. The provider-owned reviewer finishes and retains an accepted disposition
   while Dalph is down.
4. Dalph restarts and reconstructs “review invocation outstanding” from the
   journal. That history is not proof that the reviewer is still running.
5. Dalph calls the reviewer boundary's provider-enforced `createOrResume` with
   the same operation and reviewer-session identities. The provider returns
   the already completed disposition, and Dalph seals and journals the outcome.

The interface documents this exact idempotency key, and recovery invokes it.
The current controlled reviewer tests synchronously produce dispositions or
reuse an already journaled outcome. No test explicitly changes a provider-owned
pending reviewer to completed between a captured journal snapshot and restart.
That missing test is applicable and should use a stateful fake reviewer, not a
new persisted reviewer-status field.

### Persisted pre-#133 fixtures and migration

No actual pre-#133 SQLite database, JSON journal, or other frozen persisted
fixture containing the former four responsibility types was found.

There are programmatically constructed version-1 journal payloads, codec
upcast tests, and SQLite physical-schema migration tests. Those cover the
existing event schema and storage migrations, not a pre-#133 responsibility
encoding. This is expected: responsibility and frontier are reconstructed
projections and are not stored in the journal. Issue #133 changed their derived
shape without changing a durable responsibility record, so no responsibility
data migration is warranted.

## Acceptance criterion × executable lane matrix

“N/A” means that storage reopening cannot add evidence for a source dependency
or vocabulary constraint. “Gap” means the lane is applicable but absent.

| Issue #133 acceptance result | In-memory executable evidence | Closed/reopened SQLite evidence | MBT / Quint evidence | Verdict |
| --- | --- | --- | --- | --- |
| Generic frontier, admission, reconstruction, and activation use only outer executor concepts | Frontier/admission/reconstruction tests exercise only outer responsibility, invocation, wait, and settlement types | N/A | M2 projects outer invocation/resource-use values | Behavior covered; import direction is only protected by review and scans, not ESLint |
| Selected executor owns review, restoration, and artifacts | Implementation-convergence workflow and recovery suites exercise the selected protocol | Technical-retry policy/deadline rows reopen, but not a complete selected-executor convergence run | Intentionally outside generic M2 internal vocabulary | Memory covered; full SQLite selected-protocol reopening is a justified gap |
| Orchestrator sees correlation, wait, interruption/continuation, capacity use, and outcomes | `executor-boundary.test.ts`, property tests, runnable-transition recovery, and activation tests | Stable retry deadlines reopen | M2 outer projection and activation replay | Covered, except live mutation of a blocked deadline |
| Capacity follows the executor-supplied typed resource declaration | Focused admission test plus generated boundary property | Generic capacity reconstruction has SQLite lanes; selected-executor resource-use reconstruction does not | `declaredExecutorResourceUseIsProjected` | Core rule covered; selected-executor SQLite lane is an applicable small gap |
| Same-session handback, fresh reviewer, retry scope, non-convergence, and evidence remain behind adapter | Selected convergence, journal, recovery, retry, and evidence suites | Retry rows and remaining-duration behavior reopen | N/A: internal protocol must not leak into generic M2 | Strong memory coverage; externally completed reviewer restart and full SQLite protocol replay are gaps |
| Transitional symbols/comments disappear | Compile/lint plus repository scans | N/A | N/A | Covered as a source constraint |
| Specification, M2, adapter, scenarios, and applicable reopening lanes change together | Executable adapter and readable unit/integration scenarios exist | Retry reopening exists; no issue-133-specific full protocol reopen | Quint invariant and counterexample exist | Mostly covered; matrix exposes the two SQLite gaps above |
| Full gate and three review passes | Recorded in issue #133 completion evidence and rerun after integrating this follow-up | Same gate | Same gate | Complete local gate passed; the temporary hosted gate was verified separately after excluding Quint |

## Structural import-boundary finding

The repository uses flat ESLint, but no `no-restricted-imports` rule or custom
rule currently prevents generic modules from importing
`selected-executor-protocol.ts` or its internal evidence/review types.
`managed-activation.ts` currently imports the selected protocol directly.

If a second executor must be installable without editing source in the future,
the low-cost preparation is:

1. define an executor runtime/reconstruction service whose interface contains
   only the existing outer types;
2. inject that service into activation and managed-history composition;
3. bind the selected evidence/review executor in the production composition
   root; and
4. add an ESLint restricted-import rule preventing generic modules from
   importing selected-adapter/internal-protocol modules.

This does not require implementing a second production executor now. A
throwaway materially different adapter remains the strongest validation that
the injected outer interface is sufficient.

## Integrated and deferred work

The resource-declaration test remains beside the executor outer-boundary tests.
The 512-invocation reconstruction scenario has its own focused test file because
it exercises reconstruction, projection, frontier finality, and admission
together.

The current architecture is not ready to install a second executor without
editing source. `managed-history.ts` and `managed-activation.ts` select the
current protocol directly. A throwaway direct/no-review executor confirmed
that the existing outer types are coarse enough, but the production seam must
also inject selected-protocol journal validation and current resource-use
observation. That refactor belongs with issue #127's choice between one
executor protocol per run and a protocol registry keyed per invocation.

The ESLint rule belongs after that seam exists. Adding it now would either fail
on the direct imports above or require suppressions that bless the violation.
The deadline watcher repair also remains deferred: it requires a journal or
activation-change notification that can race a blocked deadline sleep, not a
test-only polling interval.

## Durable follow-up owners

- Issue [#127](https://github.com/dearlordylord/dalph/issues/127) retains the
  executor-composition seam and import-direction rule, explicitly deferred
  until a v1 proof of concept works with one selected executor.
- Issue [#154](https://github.com/dearlordylord/dalph/issues/154) owns waking a
  recovered executor retry when its durable schedule changes.
- Tracking issue [#27](https://github.com/dearlordylord/dalph/issues/27)
  records the reviewer-completes-during-downtime and complete SQLite reopening
  scenarios for the next concrete review-capable executor leaf.
- Issue [#153](https://github.com/dearlordylord/dalph/issues/153) owns restoring
  Quint recovery models to hosted CI after the v1 proof of concept.

## Focused commands

```text
pnpm vitest run \
  packages/orchestrator/src/executor-boundary.test.ts \
  packages/orchestrator/src/executor-boundary-reconstruction.test.ts
```

Result after the integrated follow-up: two files passed, four tests passed.

The deadline watcher needs a separately scoped implementation change with
notification-backed TestClock tests before its characterization becomes an
acceptance test.
