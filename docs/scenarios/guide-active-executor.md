# Alice sends information to one active executor

Alice submits a short clarification through Dalph's running CLI or MCP host.
Dalph sends it through the executor's own provider session to the exact active
turn Alice selected. [Issue #433](https://github.com/dearlordylord/dalph/issues/433)
owns this proposed protocol. The operation, schemas and tests are not shipped;
this documentation edit changes no runtime behavior.

## Governing behavior and provider evidence

Preserve [exact executor lifecycle](autonomous-executor-work.md#begin-once-then-observe-the-same-executing-work),
[host receipt versus application](running-host-clients.md#one-decoded-request-and-result-algebra),
[D21-D23](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), and
[Exit cutoff](../DELIVERY-INVARIANTS.md#application-exit).
The [plannedAttemptExecutor model](../../specs/plannedAttemptExecutor.qnt)
laws `everyCallHasOneDurableIntent` and `unmatchedIntentBlocksAnotherCommand`
constrain existing commands. Guidance needs a distinct modeled effect, not an
unrecorded RPC hidden in passive observation or a new Begin/Resume.

Issues [#4](https://github.com/dearlordylord/dalph/issues/4),
[#7](https://github.com/dearlordylord/dalph/issues/7), and
[#8](https://github.com/dearlordylord/dalph/issues/8) own intermission, independent
review evidence, and exclusive session custody. Reuse their custody/evidence
constraints without transferring custody, granting raw RPC, or claiming an
operator-assisted review independent. The first slice targets the planned
attempt's active implementation turn, not an Integrator or reviewer session.

[Issue #434](https://github.com/dearlordylord/dalph/issues/434) supplies one owned
app-server containment per exact planned attempt and separate Integrator
custody. Route guidance through that exact unit owner; the host control router
is not a shared provider or lifecycle authority. Repeated guidance/status reads
must not construct an app-server. If containment is unavailable or an item-stop
intent is unresolved, reject new guidance before provider contact. A guidance
deadline/close may affect only its selected unit, never a sibling attempt or
Integrator. This design does not implement #434's routing or migration.

Provider facts were checked on 2026-10-04 against installed codex-cli 0.160.0's
generated `TurnSteerParams`/`TurnSteerResponse` schemas and
[official app-server documentation](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn).
`turn/steer` appends input to an active turn, requires `expectedTurnId`, and
returns `turnId`; it does not start a new turn or accept policy/schema/cwd
overrides. The installed schema also permits `clientUserMessageId`. Neither
fact establishes durable deduplication, replay safety, or model comprehension.
Dalph's current `CodexAppServer` adapter exposes no steer operation; its owned
boundary must be extended and qualified before advertising this capability.

## Proposed public contract

- Add `GuideActiveExecutor` with exact request identity, RunId, TaskId,
  AttemptId, active-turn selection, and plain UTF-8 text, limited to 16 KiB.
  `dalph attach guide` and MCP `dalph_guide_active_executor` are proposed native
  names using the existing host command grammar and shared operation contract.
- The snapshot supplies an opaque active-turn selection for the current host,
  exact attempt, provider work-unit revision and current turn. It carries no
  credential or raw provider correlation. The caller echoes it; Dalph resolves
  provider IDs internally. Reselecting the same attempt after a new turn needs
  a new token, so queued guidance cannot drift to a replacement turn.
- Return `Submitted` for durable receipt, then `Acknowledged` (provider accepted
  for the exact turn), `Rejected` (safe non-transmission or exact provider
  rejection), or `Unknown` (effect may have occurred). Do not label any outcome
  Understood, Applied, or TaskChanged. Reading request status sends nothing.
- Active implementation only: reject suspended, terminal, purged/replacing,
  ambiguous/foreign, unavailable provider, review phase and unsupported adapter.
  Do not queue guidance for a future turn, resume a suspended attempt, create a
  session, or switch to a second app-server/client.
- One in-flight guidance effect per attempt, admitted through existing bounded
  controls. Serialize it with that attempt's provider command/ownership gate.
  Do not serialize unrelated task attempts behind a long provider call.
- Guidance conveys information only. It cannot change the immutable planned
  specification or Base, approve dependencies/laws, accept a result, grant
  recovery/replacement, or bypass tracker reconciliation and ordinary review.
  Send that boundary notice with the operator text, preserving it as operator
  content rather than fabricating system authorization.

## Alice sends evidence during implementation

**Starting facts.** R is active, P1 implements A with owned provider thread T1
and active turn U1; no suspension, replacement, review, integration or Exit
cutoff has intervened. Alice reads a snapshot selecting P1/U1, then notices
that reference code can run without an installation the executor assumed.

**Ordered calls.** Alice submits Q1 with that selection and clarification.
The host validates shape, UTF-8 bound, capability and cutoff; records receipt;
and returns Submitted. The executor gate rechecks exact current association,
turn, phase and custody. It records an exact guidance effect intent before
calling the already owned app-server's `turn/steer` with T1, U1 and text.
Response turnId must equal U1. Dalph records Acknowledged only for that exact
response; a mismatching response is a protocol conflict with ambiguous delivery,
not permission to resend. Alice sees acknowledgement independently of any
later task progress. Existing lifecycle and acceptance protocols remain owners.

**Crashes and retries.** Persist text in executor-private storage before durable
receipt. Reconcile receipt acknowledgement by request identity. A request with
no effect intent may dispatch only after current targeting is revalidated.
Once an effect intent exists, a crash before or after the wire call is ambiguous
unless independent provider evidence proves otherwise. Restart may read the
exact owned thread/history; it never automatically retransmits or retargets.
Exact redelivery returns the recorded state; a changed payload/selection under
Q1 is a contradiction. Same text with a new request is not implicit replay
authorization for an unresolved Q1.

Use Q1-derived `clientUserMessageId` only if the qualified adapter preserves it.
An exact independently observed provider message/receipt may prove accepted
delivery. Matching text, a missing message, and a mere JSON-RPC request ID prove
neither acceptance nor non-application. If the provider exposes no conclusive
receipt observation, retain Unknown and offer inspection, not a retry button.
Never promise exactly-once delivery from a client-side mutex or marker alone.

## Sensitive text and evidence retention

The operator deliberately sends text to the provider; it may persist in provider
history. Retain its exact bytes in the existing executor-private store's
protected namespace (private directory and owner-only file permissions), plus
integrity digest and target/request association. Journal/control/status/traces
contain only metadata, byte count, outcome and a private reference, never text
or raw provider responses. The reference is not a public download endpoint.
No encrypted-at-rest promise is made. Inform the operator of provider/private
retention before use; this is not a secret-delivery mechanism.

Store writes precede receipt; uncertain private writes are read by exact
identity/digest before retry. A crash before receipt may leave an unreferenced
private object; disposition-gated cleanup handles it later. Automatic cleanup
cannot erase unresolved guidance evidence. Audit can identify operator
involvement without exposing its content. Guidance to reviewers remains
unsupported until review-independence rules are specified.

## Rejection, completion, replacement and Exit races

Given stale U1, another task, replaced work unit, completed/suspended P1,
unsupported capability, oversize input, or lost custody, Q1 is rejected before
transmission. No alternate client, thread/start, turn/start, Resume, worktree
change, claim mutation or specification edit follows. No provider effect needs
crash reconciliation on this pre-call path.

If completion wins the executor gate, reject Q1. If guidance wins but U1 ends
before the provider validates expectedTurnId, record the actual rejection or
ambiguity; never send to U2. An acknowledgement may precede terminal acceptance,
but does not reopen a sealed outcome. If Exit wins admission, HostClosing
rejects Q1. If Q1 was admitted first, its bounded call/outcome participates in
existing drain; unresolved delivery remains Unknown through shutdown. It never
justifies keeping the host alive indefinitely or claiming all writers stopped.

## Acceptance mapping and delivery order

These are required new tests at the named existing seams, not current passes.

| Issue scenario | Acceptance test |
| --- | --- |
| 1: Correct active delivery | `Alice's guidance reaches only the selected owned implementation turn` in executor/app-server tests and running-host CLI/MCP parity |
| 2: Unsupported/stale/terminal states | `guidance rejection starts no session turn resume or replacement` with controlled executor/capability and host negative controls |
| 3: Concurrent attempts/replacement | `a stale active-turn selection never guides another task or successor turn` in ownership/executor race tests |
| 4: Crash/lost response/duplicate | `guidance intent loss retains Unknown without replay and exact receipts coalesce` in private-store/journal/protocol prefix tests |
| 5: Completion and Exit | `guidance completion and Exit races report the actual admitted turn disposition` in executor lifecycle and host drain tests |
| Unit containment | `guidance timeout or stopped-unit rejection cannot close or contact another attempt or Integrator` in #434's production routing/containment seam |
| 6: Acceptance boundary | `operator guidance cannot change planned acceptance or authorize recovery` in tracker/attempt and ordinary acceptance tests |
| Sensitive retention | `guidance text stays out of journal stdout snapshots and protocol diagnostics` in storage/serialization tests |

Implement capability/typed outcomes and private custody first, then model intent
and ambiguous recovery with laws `guidanceNeverTargetsAnotherTurn`,
`ambiguousGuidanceNeverAutomaticallyReplays`, and
`guidanceNeverGrantsTaskAcceptanceAuthority`. Add controlled wire tests for exact
expectedTurnId/response and all races, then the common host operation and clients.
One minimal live owned-turn acknowledgement test qualifies a pinned provider
version; it does not prove comprehension. Preserve intermission and reviewer
independence as explicit unsupported scope. Maintainer acceptance of these
details remains required before behavior-changing implementation.
