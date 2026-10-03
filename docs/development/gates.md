# Gate custody and diagnosis

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

### Heavy-gate admission

`check:all`, `check:ci:quality`, `test`, `check:quint`, `check:baseline`, and
standalone `check:preflight` take the exact worktree lock before one of two
clone-wide slots.
A second writer in that worktree waits without consuming a spare slot; another
worktree can use it. Nested admitted commands validate the active run and register
beneath it rather than acquiring again. `DALPH_GATE_SLOT` alone grants no admission.
Set `DALPH_GATE_SLOTS` for another machine size. Development tiers remain unadmitted.

`test:gate-resume` runs at most four test files concurrently because its process
fixtures also launch nested gate owners. The subreaper timeout fixture allows
ten seconds for startup and begins its intentional one-second timeout only
after the descendant identity is published. The historical-absence fixture
likewise starts its 30-second watchdog after its controlled child is ready.
Termination and absence checks
and the full gate's 120-second stage limit remain unchanged. These test-harness
controls do not change Dalph runtime behavior or application Exit budgets.

The full coverage stage has a finite 35-minute allowance. Candidate
`843511df5a2c3664947c86659c32b9d038d6a200` reached the former 20-minute boundary
after recording 427 ordinary/late coverage chunks, before completing its serial
group. Focused V8 runs observed 93 passing tests in six serial files before the
seven-minute diagnostic stop, then the remaining five tests passed in 92.94
seconds. The allowance covers the complete suite and report generation; no
individual test deadline, assertion, exclusion, or custody requirement changes.

#### Parallel work during a full gate

Freeze the full gate's exact candidate worktree. Independent work may continue
in other worktrees, but a declared blocking edge still forbids implementation;
read-only planning may continue. Do not change tools, dependencies, Git
configuration, or packed refs shared with the candidate. Run candidate Git
reads with `GIT_OPTIONAL_LOCKS=0`, and defer a write when its shared scope is
unknown. The input observer and final comparison decide whether the candidate's
qualification evidence remains valid.

This is a cooperative operating rule. It adds no dispatcher, scheduler state,
active-gate file, new command, or automatic prompt injection.

The runner prints its run ID and `.scratch/quality-gates/<run-id>` report directory.
Each bounded child records spawn intent before launch, its observed process group,
logs, and genuine terminal result. Coverage writes below that run's `coverage/`
directory; both verifiers consume `DALPH_COVERAGE_DIRECTORY`. Shared package builds
remain protected by exclusive worktree ownership. Safety records and unresolved-run
fences live in the Git common directory, outside artifact/report cleanup. Do not
unlink lock files or manually remove fences.

If a runner dies or cannot prove a writer group absent, the incomplete-run fence
refuses another writer even after the kernel lock closes. Run `gate:status <run-id>`
to inspect evidence, then ordinary `gate:reconcile <run-id>` after writers stop.
Reconciliation takes worktree, exact slot, then registration locks; closes
registration; checks the complete spawn inventory; and clears fences only after
every observed group is positively absent. Old nested launches are refused after
closure. An unobserved spawn intent, corrupt inventory, or live/unprovable group
stays fenced. Group absence never supplies a missing exit code. There is no age/PID
shortcut or force-clear.

After a host reboot, a maintainer may use
`gate:reconcile <run-id> --previous-boot=<recorded boot UUID>` only when the
recorded run names the exact current worktree/common directory, custody root,
report directory, slot, locks and fences, and its hostname matches while its
recorded boot differs from the current boot. This separate path accepts open or
closed registration, closes an open registration, and requires an exact canonical
obligations directory containing only structurally valid `no-child` or `observed`
records. It never probes or signals old process groups and never invents absence,
receipt, terminal, or qualification evidence. It captures raw fence and inventory
digests, atomically publishes `previous-boot-ended.json` with `stopped`/`UNPROVEN`
custody, then clears the exact slot fence before the worktree fence. A retry
validates the complete durable proof and clears only matching fences; the proof
writer must retain the recorded hostname and use a boot distinct from the old
boot, while a later retry may use any newer boot on that hostname. Its
`recordedAt` value is checked for canonical timestamp shape only, so clock
rollback does not invalidate durable custody. A corrupt, foreign, newer, or
incomplete proof remains fenced. Historical status remains ordinary current-boot
status and has no previous-boot mode.

This cooperative boundary protects admitted heavy commands and shared build/report
writers on local Linux with Git, bash, flock, and atomic local-filesystem publication.
It does not coordinate other clones/users, distributed filesystems, direct build/tool
commands, or arbitrary escaped descendants. Audited synthetic Codex process fixtures
write only disposable fixture storage or stdio and retain their scoped cleanup;
production process semantics are unchanged. An ambient
`DALPH_RUN_REAL_CODEX_QUALIFICATION=1` or `DALPH_QUALIFICATION_ENV_CAPTURE` is rejected
at fresh and inherited admission before launch. Run opt-in real qualification
separately; tests can still set their own disposable capture paths internally.

A command exit, stopped custody, and final qualification are distinct evidence.
A failed child receipt retains its historical absence observation. If its enclosing
test later stops the group, a separate exact group-absence record can prove stopped
custody without rewriting that child result. Missing terminal receipts remain
`UNPROVEN`; successful earlier stages are not a
final green gate. Interrupted ordinary candidate checks restart from the
beginning after stopped-writer reconciliation. The runner does not credit a
stage resume or cross-worktree formal proof. Standalone `check:quint` remains
available for formal diagnostics. Automatic MBT is temporarily excluded pending
#363; `test:mbt` remains an explicit manual command.

A synthetic detached writer can create its fixture readiness file after launch
while its parent is still publishing the post-spawn process-group observation.
The custody test therefore waits, for at most its existing ten-second fixture
deadline, until the writer's exact obligation is `observed` before corrupting
that variant. If the observer dies, the still-live writer keeps both fences; an
`observed` record rewritten as `no-child` while retaining its process group must
be rejected, and reconciliation must not clear either fence. No retry applies:
the fixture releases the original writer and reconciles that run. This is
qualification-tool behavior only; it changes no Dalph runtime command, provider
boundary, journal fact, retry, or cleanup behavior.

| Qualification scenario | Acceptance test |
| --- | --- |
| A detached writer reports fixture readiness before its parent can publish the post-spawn observation; the test waits for the exact observed variant, kills the enclosing observer, and proves corrupting that variant cannot clear either fence | `scripts/gate-custody.test.mjs`: `formal-copy observer death preserves registered detached writer custody before any next launch` |

Bootstrap prepares dependencies before freezing the candidate. Ordinary candidate
checks retain a live Linux inotify observer and require Python 3. The observer
watches source, resolved tool and configuration inputs, detects edit-and-restore
and replacement, and fails on queue overflow, watch loss, or observer failure.
It drains before the final input comparison and remains in the registered gate
process group. No observer receipt grants resume or cross-worktree reuse credit.
Transient memory-mapped mutation is outside the cooperative filesystem guarantee.
Metadata-only events on a path that is only a strict ancestor of an input do not
invalidate the run by themselves. Membership, rename, and replacement events on
the same path still invalidate except for the local candidate index policy
below, and the final comparison rejects any lasting change that alters resolved
identity.

Guarded full-gate children use `GIT_OPTIONAL_LOCKS=0`, so read-only status checks
leave index stat-cache metadata untouched. The ordinary local `check:all`
candidate additionally observes staged index entries at each stage boundary
instead of watching raw index-file replacement: an outside `git status` that
refreshes only stat metadata does not invalidate a long run. A persistent
staged-entry change fails the next boundary comparison, and the final complete
snapshot also checks staged entries. Source bytes, HEAD, selected refs, and
other Git authority remain observed. A staged-only change followed by a reset
between two stage boundaries can escape this semantic index check; local
qualification is tied to the frozen HEAD and watched source bytes rather than
transient index metadata. Standalone `check:quint` guards formal source and tool
inputs; it does not bind Git HEAD or the index. Only explicitly constructed
internal Git coordination lock paths—the candidate's `index.lock`,
the shared `packed-refs.lock`, and the lock paths for its exact symbolic
selected-ref chain—may be treated as transient coordination when their
create/remove pair is observed. No `HEAD.lock` or arbitrary `*.lock` path is
exempt. A real same-batch ref event remains dirty even when a lock is created
and removed; strict guards also invalidate raw index events. A persistent
internal lock fails the final authoritative snapshot.
User-configured authority files named `*.lock` remain observed, so editing and
restoring one rejects reuse. External Git observation during a run must use the
same optional-lock setting.

The shared common Git config is not part of the live filesystem observer: linked
worktrees can replace that file while adding only another branch's settings.
The guard instead compares the effective local configuration at each validation
boundary; foreign `branch.*` sections do not invalidate qualification, while a
candidate-branch or repository-wide setting change does. A setting changed and
restored before a boundary is intentionally ignored because the candidate's
effective Git authority is unchanged. Worktree-local `config.worktree`, refs,
and other Git authority files remain observed. The local candidate compares
semantic index entries; the CI quality shared-input guard retains raw index-file
observation.
This is qualification-tool behavior only and changes no Dalph runtime command,
provider boundary, journal fact, retry, or cleanup behavior.

| Qualification scenario | Acceptance test |
| --- | --- |
| Another maintainer adds an unrelated branch section while the shared common config is replaced; boundary comparison retains the candidate identity | `scripts/gate-resume-inputs.test.mjs`: `an unrelated branch section can be added while the candidate config watch remains live` |
| Another maintainer adds branch metadata whose branch name merely extends the candidate's branch name; exact Git section/subsection parsing keeps it unrelated | `scripts/gate-resume-inputs.test.mjs`: `a branch whose name extends the current branch remains unrelated configuration` |
| The exact current branch's Git configuration changes; the observer refuses the candidate even though similarly prefixed foreign branch sections are ignored | `scripts/gate-resume-inputs.test.mjs`: `the exact current branch section remains candidate-relevant configuration` |
| A repository-wide setting in the subsection-less `[branch]` section changes; the observer refuses both the next stage and final qualification | `scripts/gate-resume-inputs.test.mjs`: `a subsection-less branch setting remains repository-wide candidate configuration` |
| A persistent repository setting retargets an external ignore file | `scripts/gate-resume-inputs.test.mjs`: `candidate history rejects a persistent configuration retargeting of external ignores` |
| A repository-wide Git setting changes after an unrelated replacement; the re-armed observer refuses both the next stage and final qualification | `scripts/gate-resume-inputs.test.mjs`: `a candidate-relevant config replacement fails after an unrelated replacement re-arms the watch` |
| The parent-directory replacement event arrives in one observer drain and the obsolete file-watch removal arrives in the next; the observer watches the new generation immediately and treats only the later old-generation removal as obsolete | `scripts/gate-resume-inputs.test.mjs`: `split parent replacement and obsolete file removal events re-arm before the later removal` |
| A shared Git setting changes and is restored before validation | `scripts/gate-resume-inputs.test.mjs`: `a shared config edit restored before validation is ignored` |
| Git creates and removes one explicitly constructed coordination lock (`index.lock`, shared `packed-refs.lock`, or a lock for the exact symbolic selected-ref chain) without changing the authority bytes; the selected-ref/index controls prove the scoped allowance | `scripts/gate-resume-inputs.test.mjs`: `bound candidate history allows transient selected ref lock coordination`; `bound candidate history allows transient index lock coordination`; `bound candidate history allows transient packed-refs lock coordination` |
| A selected-ref write remains dirty, and strict raw-index guards reject a raw index write even when it is restored or accompanied by a transient index lock; local semantic-index checks instead compare staged entries at boundaries, tolerate a status-only stat refresh, and may miss a staged-only change that is reset entirely between boundaries | `scripts/gate-resume-inputs.test.mjs`: `bound candidate history observes selected ref ancestor replacement and restore`; `a transient index lock cannot hide a real candidate index mutation`; `semantic candidate identity tolerates a normal status stat refresh`; `semantic candidate identity rejects a persistent staged entry change at the boundary`; `semantic candidate identity rejects a persistent staged entry change at finish without a boundary check` |
| Ordinary `git status` refreshes only index stat metadata during local semantic observation | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity tolerates a normal status stat refresh` |
| A persistent staged-entry change is rejected at the next local semantic stage boundary | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity rejects a persistent staged entry change at the boundary` |
| A persistent staged-entry change is rejected by the local semantic final snapshot even without an earlier boundary assertion | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity rejects a persistent staged entry change at finish without a boundary check` |
| Persistent skip-worktree and assume-unchanged flags are rejected by local semantic observation | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity rejects persistent skip-worktree and assume-unchanged flags` |
| An internally constructed `index.lock` persists through the final authoritative snapshot | `scripts/gate-resume-inputs.test.mjs`: `a persistent index lock fails the final authoritative snapshot` |
| A user-configured external authority file named `*.lock` is edited and restored | `scripts/gate-resume-inputs.test.mjs`: `candidate history observes external excludes ending in .lock edit and restore` |

Stages have exact bounded command contracts. A completed stage's generated
artifact roots become protected inputs for later stages. Ordinary checks grant
no reuse credit. Vite/Vitest caches are disposable outputs, not proof of a
previous stage. Admitted lint passes dprint `--incremental=false`; formatter
plugin code and metadata remain inputs.
Normal edit-loop formatting keeps its incremental behavior. Other tool cache state
is included unless explicitly generated.
Local full qualification scans the complete ancestry of the exact candidate HEAD
for secrets, including removed ancestor content; it binds that SHA in the actual
scanner command and input identity. Standalone, preflight and hosted secret scans
retain the default all-ref history. Unrelated loose branch updates do not change
the locally selected candidate; selected refs and history controls remain observed.
Original and new output counts remain exact evidence, without a success ceiling.
An admitted child forwards at most 550 lines or 64 KiB to the console, then prints
its complete log path. Its receipt and log retain all output; truncation never
changes its exit verdict. A failed truncated child also shows its last 8 KiB.
Commands without retained logs remain untruncated. Presentation is per child,
not a shared qualification budget, so a verbose prefix cannot exhaust a suffix's
allowance. Quiet-command progress reporting is separate from child output.

The guarded formal profile opts into a dedicated fd3 NDJSON channel from its
bounded checker children through `run-formal-profile.mjs` to
`run-formal-workflow.mjs`. Lifecycle lines identify the semantic command,
elapsed time, absolute deadline, and retained log; a quiet command receives one
heartbeat after at most 15 seconds. The heartbeat says that backend progress is
unknown. Last-observed stdout/stderr bytes are activity evidence only, never
backend progress, and are not echoed one line per chunk. Compact mode retains
these lifecycle lines while suppressing successful raw checker output and
timing detail. The channel is live-only and non-evidentiary: reuse starts no
transport, a lost parent leaves any already-emitted start/heartbeat without a
synthetic terminal, and receipts, custody, formal reports, and evidence remain
authoritative.

This is repository-tooling behavior only; no Dalph command, provider boundary,
journal fact, retry or runtime cleanup changes. Output-policy tests prove bounded presentation and malformed-count rejection;
retained child receipts preserve exact output counts independently of console limits.

The executable Quint command manifest and hosted model-family ranges generate
`packages/dalph/src/qualification/formal-command-inventory.generated.ts`.
The production provenance schema and positive live-qualification fixtures read
its command count and shard assignment. After changing either input, run
`node scripts/generate-formal-command-inventory.mjs --write`. The early
`test:formal:controls` check rejects a stale generated inventory or a missing
or overlapping shard position before coverage. The existing negative fixture
with a truncated profile remains independent. This is qualification tooling
only; it changes no Dalph workflow decision or external request.

Ordinary `check:all` runs every selected stage once for its exact candidate.
Interrupted runs retain custody until reconciliation and restart without prefix
credit. Standalone formal reuse is governed separately by
[formal verification](formal.md#formal-reuse-and-handoff).
