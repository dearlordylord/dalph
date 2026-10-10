# Dalph resumes an exact retained merge during authorized Retry

Accepted scope: [#512](https://github.com/dearlordylord/dalph/issues/512), under
[#491](https://github.com/dearlordylord/dalph/issues/491). The Operator explicitly
authorizes Retry after a conclusive NotPrepared. The native provider owns the
same session, resource, candidate path, private record and Codex thread. Git
owns registration, HEAD and ordered parents; the execution substrate owns
current stopped-writer observations. No target publication is authorized here.

## Governing behavior

Before admitting the retained worktree, preserve
[exact terminal evidence and quiescence](production-codex-integrator.md#3-turn-recovery-requires-the-exact-token)
and [reconcile-before-retry invariants](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence).
The [accepted integration model](../../specs/acceptedResultIntegration.qnt)
constrains `noAutomaticIntegratorSuccessor` and the existing explicit Retry,
one FullRerun and no third-session rules. This refinement changes only native
worktree validation and its fresh custody read. It changes no workflow action,
event, journal schema, control algebra or Quint state; existing protocol replay
fixtures remain applicable. Optional diagnostic handling composes accepted
[#511](candidate-local-documentation-links.md), without rewriting its source
behavior or evidence.

## P1: The Operator retries a stopped, sealed NotPrepared merge

Initially the native owner creates one detached candidate at target H for
accepted C. During its first authorized turn, Codex creates M with direct
ordered parents [H,C], runs applicable required checks, and returns conclusive
NotPrepared after a diagnostic. Dalph seals that exact terminal private turn;
all owned writers stop. The target still names H and accepted C is unchanged.
The Operator authorizes the next contiguous Retry in the same session/resource.

Dalph reads the exact private record, verifies session and canonical path and
existing run admission, then reads Git's NUL-delimited registration and disk
presence. Initial creation and ambiguous worktree/add remain strict H. A
materialized candidate at H retains the existing admission route. For a moved
HEAD, Dalph requires ThreadWithRuns and a sealed NotPrepared predecessor. It
resumes and rereads the exact owned thread, verifies the predecessor's terminal
id/token/status, rejects foreign or contradictory history, and obtains a fresh
complete Absent activity census. An already-recorded current Retry token is
recognized without allocation; live or uncertain activity still blocks.

Git must then report HEAD M with exact ordered direct parents [H,C], target H,
and the exact accepted C commit object. Only then can the same native owner
continue the next provider turn. No reset, replacement or inferred Prepared
occurs. Codex reruns applicable required checks, verifies the merge and unchanged
authorities, and reports Prepared only after required checks exit zero. Earlier
failed optional diagnostic exits and raw bytes remain intact.

Acceptance: `accepts only an exact retained ordered merge after stopped Retry
reconciliation` in the [worktree tests](../../packages/dalph/src/application/codex-integrator-worktree.test.ts);
`reconciles retained Retry ... before any new provider turn` in the
[provider tests](../../packages/dalph/src/application/codex-integrator.test.ts);
and `retains an exact merge after NotPrepared and qualifies a native contiguous
Retry` in the [real Codex fixture](../../packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts).
The physical fixture uses authenticated Codex 0.162.1, two actual turns, successful
provider-run docs/runtime checks in both turns, immutable raw and sealed bytes,
identical retained M/path/thread/session, private snapshots and stopped process
census before Retry and after completion.

## P2: Dalph refuses contradictory ownership before the next turn

At the same reopening boundary, initial creation at another head, absent,
foreign, prunable or branched registration, missing disk path, malformed,
reversed, missing or extra parents, arbitrary descendants, changed H/C, wrong
session/resource/path, unsealed/foreign/noncontiguous predecessor, and live,
uncertain or unreadable custody all fail closed. Dalph returns the existing
typed preparation failure without starting another turn or removing history.
A lost read supplies no authorization; retry repeats authoritative reads.

Acceptance: the worktree tests' `refuses ... and preserves retained history`
cases prove parent shape, Git failures and unchanged H/C; existing registration
and materialization cases prove missing/foreign/prunable/branched/path rejection.
The provider tests' retained Retry negatives prove no second turn for live or
unreadable custody, foreign history and a Prepared predecessor. Existing
session/path collision and foreign-thread cases prove exact owner refusal.
The [private-store tests](../../packages/dalph/src/application/codex-integrator-private-store.test.ts)
`rejects every noncanonical provider-run history transition before persistence`
and `rejects noncanonical locators and contradictory private run or record states`
prove unsealed, foreign and noncontiguous history refusal before use.
The [Integrator protocol tests](../../packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts)
prove exact human authorization, fresh target reads, foreign Run refusal and
non-Retry/stale/conflicting evidence refusal at the unchanged outer boundary.

## P3: Dalph reconciles the already-authorized pending Retry

If preparation is interrupted between native admission, run-token recording,
turn start or result sealing, retain the candidate, private history and custody.
Reactivation rereads the same record and execution substrate. It reconciles the
already-authorized run rather than appending another human direction, fabricating
a result, or allocating a duplicate token. A stopped terminal current turn can
be recovered; an active or unreadable writer stays fenced. No automatic Retry,
second FullRerun or third session is introduced.

Acceptance: `restarts an unfinished retained-merge run two with its same durable
token` proves lost turn-start response recovery and preserved run-one evidence.
`applies a recorded Retry after restart without another user request` and the
existing [successor recovery fixtures](../../packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-result-recovery.test.ts)
exercise unchanged workflow replay/control rules. Existing cleanup tests remain
selected because retained registration must not weaken removal authorization.

Tracker claims, membership, publication, promotion and cleanup mutations are
inapplicable to this repair's provider admission boundary. Parent delivery stops
#512 at accepted candidate/Integrating, previews those exact bytes, resumes #501's
already-authorized pending run two at its unchanged H, then resumes #512 and
#511 native publication in that order. No manual push/closure or new #501
blocked_by #512 dependency belongs to this implementation.
