# Alice sends information to one exact active implementation turn

Issue: [#433](https://github.com/dearlordylord/dalph/issues/433).

This chronology records the accepted maintainer decisions. Test owners below
are implementation seams until their concrete assertions pass; this document
does not claim a command is already available.

## Governing behavior and boundary

Dalph preserves the existing [executor boundary](planned-attempt-executor-boundary.md)
and [exact Codex containment](isolated-codex-containment.md). Guidance uses the
selected attempt's existing owner; it neither establishes another provider nor
changes delivery, integration, cleanup or task authority. The
[running-host client boundary](running-host-clients.md) owns CLI/MCP admission
and [graceful Exit](linux-supervisor-exit.md) retains its admission cutoff.
Guidance does not grant [result recovery](rejected-provider-result-recovery.md).
Existing delivery invariants and models continue to govern those effects; the
new guidance model must name its request/turn, ambiguity and privacy laws before
runtime qualification.

Alice's Run R already has admitted immutable attempt P1, original Base H1,
tracker-authored task revision and claim, owned worktree W1, and an active
implementation turn T1 in its existing provider thread. P2 may be active beside
it; Integrator sessions and suspended attempts are outside this version. The
tracker owns authored acceptance and dependencies, Git owns commits and refs,
and the execution substrate owns current turn and process observations. The
journal retains workflow intent/observation metadata, not message text or a
derived current-turn authority.

The local text limit is 16 KiB of UTF-8 bytes. Text lives in memory only; metadata
retains exact request identity, selected attempt/turn association and the facts
needed to distinguish redelivery, contradiction and uncertain transmission.
Delivered text may remain in provider session history. No journal event,
private payload file or automatic retransmission queue retains the text.

## G1 — Alice receives acknowledgement for the selected active turn

Alice sends text within the byte limit through CLI or MCP for exact P1. Dalph
admits the request, resolves T1 internally through P1's existing owner, freshly
checks activity and custody, and records exact intent metadata before calling
that owner's `turn/steer` with T1 as `expectedTurnId`. It accepts an acknowledgement
only when the returned `turnId` equals T1. Alice sees that input was accepted for
the selected turn; she receives no claim that the model understood or applied
it. No new turn, provider, revision, Base, claim or delivery permission appears.
Crash and redelivery at this boundary follow G5; completion follows G6.

## G2 — Dalph refuses an unavailable or inappropriate target

Before transmission, P1 may be suspended, terminal, replaced, foreign, in review,
or represented by unavailable containment or an unresolved item-stop fence.
Its provider may lack the guidance capability, or T1 may no longer be active.
Dalph reports a typed refusal without calling another provider, starting or
resuming a turn, queuing to T2, or clearing a fence. Oversized UTF-8 text refuses
before the provider effect. A later deliberate request is a new request, not
replay of this refusal. Crashes cannot turn absent local text into permission.

## G3 — Several active attempts remain independent

P1/T1 and P2/T2 are active under separate exact owners. Alice selects P1 and sends
guidance. Only P1's existing transport receives a call naming T1; P2's turn,
provider, worktree and lifecycle remain unchanged. A crossed attempt/turn
association refuses before transmission. Duplicate and crash behavior remains
G5; no grouping or dependency mutation applies because this is information.

## G4 — Missing acknowledgement becomes Unknown

Dalph records intent and may transmit to T1, but the response is lost, unreadable,
contradictory, or absent at the ten-second acknowledgement deadline. Alice sees
Unknown, not Delivered or known non-delivery. Dalph sends no automatic second
steer, performs no interrupt, and never waits for model comprehension. Exact
later evidence may establish the original disposition; elapsed time itself
cannot do so. A lost response cannot authorize retargeting to another turn.

## G5 — Crash and duplicate handling retain metadata, not text

Dalph can crash after admission, between durable intent and transmission,
after possible transmission, or before recording its observed acknowledgement.
Local text may disappear. Known unsent lost text is not reconstructed or queued.
Possible transmission remains Unknown unless exact provider evidence proves
the original effect. Missing local bytes never prove that nothing was sent.
Exact request redelivery returns its retained disposition without a second
provider call, even if a caller supplies text again. Reusing identity for another
attempt or payload refuses as a contradiction. Alice may deliberately use a new
request identity; Dalph does not infer it from Unknown or assume provider dedup.

## G6 — Completion and Exit races preserve the actual boundary

T1 can complete after selection but before steering. Dalph retains the selected
T1 and refuses its failed precondition rather than sending to T2 or reopening a
terminal result. If T1 accepted input before completion, its exact acknowledgement
remains an acknowledgement for T1. An uncertain overlap remains Unknown. Exit
closes admission: a request after that cutoff cannot start the provider effect;
an admitted request follows the existing host-owned completion/uncertainty rules.
A disconnected client cannot own or retry the underlying admitted effect.

## G7 — Message content grants no workflow authority

Alice's text may propose changed acceptance, another Base, dependency approval,
recovery, or takeover. The input remains informational. Dalph records no such
authority and preserves immutable P1/H1. Tracker reconciliation and ordinary
verification/review still govern results and delivery. Provider-identity-looking
text must not become an application-owned correlation or another owned request.
Crashes and retries use G5 rather than turning content into a durable command.

## Implementation boundaries

The running-host command routes through the established Run control owner;
the journal records request intent and observed disposition, never message text.
The host retains the admitted payload in memory only for this invocation.

`application/isolated-planned-attempt-executor.ts` must select an existing exact
owner and hold its ordinary in-flight lease during guidance. Its current
`ownerFor` path can acquire a provider and therefore cannot supply guidance
admission. An absent, retired or unavailable owner refuses before dispatch.
The existing Codex executor resolves its current provider turn internally;
the app-server boundary uses `expectedTurnId` to enforce that same selection.
These are planned responsibilities, not claims that the command is available.

## Planned verification owners

| Chronology | Concrete assertion and owner to implement |
| --- | --- |
| G1/G2/G3/G6 | `application/codex-app-server-protocol.test.ts`: exact steer parameters, matching/mismatching ACK, absent active turn and no new turn; `application/codex-planned-attempt-executor.test.ts` and `isolated-planned-attempt-executor.test.ts`: existing owner only, exact active turn, custody fences and neighbouring-owner independence. |
| G1/G2/G4/G5 | A guidance protocol/control unit owner: UTF-8 limits, intent before effects, ten-second deadline under TestClock, retained request identity and contradiction, no blind resend, no durable text, no timeout-derived non-delivery. |
| G1/G5/G6 | A running-host guidance composition owner using the production Run/HTTP routing and controlled provider: CLI/MCP reach the owned active turn, exact redelivery sends once, completion and Exit retain the actual disposition. Assertions distinguish real host routing from native process proof. |
| G4/G5/G6/G7 | A subject-scoped guidance Quint family and production conformance adapter: exact request/turn identity, at most one transmission, crash ambiguity, no future-turn retargeting, admission cutoff and metadata-only persistence. Add directed negative controls and canonical obligation registration. |
| G1/G2/G4/G6 | One bounded native Codex qualification using the installed binary and controlled model endpoint: existing process/turn receives steering, exact provider precondition refuses a completed turn, and guidance never starts another provider or interrupts the current one. |

The installed Codex 0.160.0 JSON schema requires `threadId`, `input` and
`expectedTurnId`, returns `turnId`, and permits `clientUserMessageId`. That field
alone establishes no durable deduplication guarantee. The
[official steering contract](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn)
describes active-turn input and its precondition; application metadata and
negative tests must establish Dalph's stronger no-replay guarantees.
