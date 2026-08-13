# Issue 78 — qualify repository verification locking

Status: accepted, implemented locally for review (GitHub issue #78 remains open; declared blocking edges are #59 and #167).

This qualification starts after the provider-neutral target-verification journey from #59/#167 has selected one exact candidate occurrence and one opaque verification plan. The person affected is the coordinator operating the Dalph run. The systems at the boundary are Dalph, the target repository's configured public verification wrapper, the wrapper-owned repository/resource lock, and the operating-system child process. Dalph's workflow journal contains the request intent; Git owns candidate/ref facts; the execution substrate owns the child-process observation. Dalph does not create a second record for the repository lock.

## Scenario 1 — a public wrapper waits, verifies, and releases its own repository lock

At the start, candidate occurrence `M` is bound to request `V` and plan `P`; the target repository is the exact repository/ref selected by the candidate facts. The configured command is one executable and its already-selected arguments for the target's public verification wrapper. No Dalph heavy-lock lease exists, and Dalph has no private wrapper command or lock operation to call.

The coordinator starts verification for `V`. Dalph records the durable verification intent and invokes that one public wrapper directly, passing the complete request. If another verification currently owns the target repository lock, the wrapper reports that it is waiting. The wrapper then acquires and owns the lock, runs the target's guarded checks, emits a terminal result, and releases the lock before the child process settles. Dalph records typed waiting, acquisition, terminal, and release observations; it stores and rereads every artifact and the manifest before sealing evidence.

The wrapper boundary is one direct, non-shell child-process invocation. The request is one JSON document on standard input. The wrapper emits one JSON object per standard-output line: `Waiting`, `Acquired`, `Terminal`, and `Released` for a settled run (or `Interrupted`/`Failed` when it cannot settle). Terminal artifact bytes are base64 on the wire and are decoded only after the complete terminal object validates. The adapter exposes the typed lifecycle observations to its runtime contract and passes only the terminal result to the existing provider-neutral journal protocol.

If the wrapper reports a complete `Passed` result whose correlation is exactly `V`, the visible result is a passing verification for `M` and later integration may use the sealed evidence. If the child process disappears before a truthful terminal/release observation, Dalph reports a typed boundary failure and leaves evidence unsealed. Retry/reconciliation remains owned by the #59 provider-neutral protocol; this adapter only invokes the configured `runOrResume` wrapper operation and does not claim to prove whether a lost real wrapper run began. Dalph never acquires the repository lock itself, invokes a private guarded command, or wraps the public wrapper in another guarded command. A different target remains independently usable while `M` waits.

Acceptance tests:

- `invokes exactly one public wrapper and keeps lifecycle observations typed`
- `waits for the wrapper-owned repository lock then releases it`
- `keeps another target usable while exact M verifies and releases only M's target when it settles` (#59)
- #59's provider-neutral retry/reconciliation test remains the owner of lost-response behavior; this adapter has no real-wrapper retry claim.

## Scenario 2 — interruption and wrapper failure are observations, not success

At the start, `V` is still the only request for `M`. The wrapper is waiting for or holding its own repository lock, or it has begun guarded checks without completing them. Dalph's process-local target responsibility may still name `M`, but no success evidence has been sealed.

The OS interrupts the wrapper, or the wrapper reports a typed failure while it owns the lock. The wrapper is responsible for releasing its lock; the adapter observes the wrapper's interruption/failure and the release (or reports that release was not observed). Dalph records a nonpass terminal when the wrapper supplies one, or a typed boundary failure when it cannot supply a truthful terminal. It preserves the exact candidate/request and does not promote or replace `M`.

The forbidden result is a `Passed` evidence event inferred from process exit, partial output, lock release, or a stale artifact. This adapter does not infer retry safety or reconstruct a lock lease; the #59 provider-neutral protocol owns retry/reconciliation after this boundary reports its typed observation.

Acceptance tests:

- `maps interruption to a typed observation and keeps success fail-closed`
- `maps wrapper failure and missing release to a fail-closed boundary failure`
- `seals failed killed partial and timed-out diagnostics without passing evidence` (#59)
- #59's provider-neutral retry/reconciliation test remains the owner of lost-response behavior; this adapter has no real-wrapper retry claim.

## Scenario 3 — partial or malformed output cannot seal success

At the start, `V` has been sent to the public wrapper. The wrapper emits waiting/acquisition observations and either emits a `Partial`, `Failed`, `Killed`, or `TimedOut` terminal, or exits after only a prefix/malformed response. Artifact bytes may be present, but they are not proof of complete verification.

Dalph accepts only a schema-valid terminal correlated to `V`. A valid nonpass terminal is journaled as stopped verification after artifacts are stored and reread; malformed, missing, foreign, or incomplete output is a typed boundary failure. In both cases no passing evidence is sealed and no integration promotion follows. The wrapper remains the sole owner of its heavy lock; retry/reconciliation is outside this adapter and remains the #59 protocol's responsibility.

Acceptance tests:

- `seals nonpass terminal observations without treating partial verification as success`
- `rejects malformed or incomplete wrapper output`
- `records a contradiction and fails closed for a foreign wrapper result` (#59)

## Scenario-to-test mapping

| Chronological scenario | Acceptance test(s) |
| --- | --- |
| Wrapper waits, acquires, verifies, and releases its own lock for exact `M` | `invokes exactly one public wrapper and keeps lifecycle observations typed`; `waits for the wrapper-owned repository lock then releases it`; `keeps another target usable while exact M verifies and releases only M's target when it settles` (#59) |
| Wrapper/process interruption or failure | `maps interruption to a typed observation and keeps success fail-closed`; `maps wrapper failure and missing release to a fail-closed boundary failure`; `seals failed killed partial and timed-out diagnostics without passing evidence` (#59); #59 owns lost-response retry/reconciliation |
| Partial, malformed, or foreign output | `seals nonpass terminal observations without treating partial verification as success`; `rejects malformed or incomplete wrapper output`; `records a contradiction and fails closed for a foreign wrapper result` (#59) |

The existing #59 conformance tests cover the provider-neutral journal/evidence consequences named above. The tests listed here cover the real child-process and repository-wrapper boundary added by #78.
