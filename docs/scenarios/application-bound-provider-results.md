# Dalph binds provider results to their owned work

The accepted scope is [#429](https://github.com/dearlordylord/dalph/issues/429).
Dalph binds its own identities after observing the exact provider owner; the
model proposes a semantic result and never has to transcribe those identities.

## Governing behavior

This refines result decoding in the [Codex executor](codex-app-server-executor.md),
[Kimi executor](kimi-acp-planned-attempt-executor.md), and
[production Integrator](production-codex-integrator.md). It preserves
[D1–D3 identity and immutable attempts](../DELIVERY-INVARIANTS.md#identity),
[evidence and ambiguity](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), and
[D48a absorbing terminal evidence](../DELIVERY-INVARIANTS.md#operator-requests).
`plannedAttemptExecutor.qnt` continues to govern exact command/report correlation
and one sealed outcome. This change moves model transcription inside the adapter;
it does not change the generic executor protocol or authorize recovery of Failed.

## Chronology and acceptance mapping

Before each case Alice has one immutable planned attempt, its exact Git worktree
and Base, and the provider-private association for that attempt. Provider reads
and Git observations remain authorities. Tracker mutation is outside this
decoder, so mutation retries are inapplicable. No semantic-correction retry loop
is introduced.

1. **Owned semantic result.** The exact provider turn completes with
   `{"version":1,"outcome":"Accepted","commit":"<40-hex>"}`. Dalph first
   reconciles its exact thread/session and turn ownership, then decodes the
   semantic payload, observes Git HEAD/lineage and required evidence, and binds
   internal Run/Attempt identities from the immutable context. Alice sees the
   ordinary accepted report; the prompt and payload need no copied identities.
   Test: `binds an owned semantic result without model-copied identities` in
   `codex-planned-attempt-executor.test.ts`; `binds an owned Kimi semantic candidate without copied identities` in
   `kimi-planned-attempt-executor.test.ts`.
2. **Foreign/stale/ambiguous owner.** A different thread, turn, attempt or duplicate
   ownership marker supplies the same valid semantic payload. The provider
   ownership check refuses it before acceptance or evidence publication. No
   current IDs may legitimize foreign bytes. Tests: existing foreign-thread,
   foreign-turn and duplicate-token controls in the executor suites, extended
   with semantic payloads; `rejects semantic results from another Kimi session
   or worktree` and `refuses a retained Kimi session when load returns another
   identity`.
3. **Bad candidate/evidence.** An exact owned turn returns invalid/missing SHA,
   a candidate different from HEAD, wrong lineage, or invalid evidence. Dalph
   retains safe rejection and does not substitute HEAD for an invalid proposal.
   Tests: existing accepted-evidence/Git rejection tests in both executor suites,
   plus `rejects invalid semantic results without a HEAD fallback` and
   `rejects a Kimi semantic candidate when Git cannot prove Base ancestry`. Codex keeps
   Base lineage at the existing planned-worktree/Git qualification boundary,
   which has the authoritative complete plan; its provider-private association
   does not become another source of Base. `node-worktree.test.ts` and
   `planned-attempt-worktree-observation/protocol.test.ts` remain lineage owners.
4. **Integrator.** A fixed session/run has one exact owned provider turn. Its
   existing version-1 PreparedCandidate/NotPrepared semantic envelope is bound
   to that session after ownership reconciliation; parent/publication checks
   remain later Git boundaries. Another session/run cannot be rebound. Tests:
   `codex-integrator.test.ts` exact preparation, foreign ownership and
   foreign correlation cases; `kimi-integrator-provider.test.ts` exact session
   composition: `binds only the exact Kimi Integrator session: Exact`,
   `ForeignSession` and `ForeignWorktree`.
5. **Crash/duplicate observation.** Crash after reading the owned result but
   before sealing it. Restart reads the same private association, provider turn,
   Git and evidence; it seals once without another turn or publication. Repeated
   observation returns the same sealed outcome. Tests: executor retained-turn,
   sealed-result and crash-boundary cases;
   `recovers an unsealed semantic result without another provider turn` and
   `binds an owned Kimi semantic candidate without copied identities` exercise
   semantic payloads. `production-hermetic-provider-result.ts` emits the same
   identity-free protocol through real Git/SQLite production composition;
   `production-running-host.test.ts` owns its actual one-task delivery and
   exact internal correlation; the provider suite separately owns restart.
6. **Compatibility.** Restart with a supported legacy in-flight result containing
   `commit` and `correlation`. Decode its IDs exactly and reject foreign or
   malformed correlation; never discard a supplied correlation. Sealed Accepted,
   Failed and Completed records keep their existing meaning. In particular a
   sealed Failed is not reparsed as success. Legacy Kimi completion at an
   unchanged Base remains Completed when no candidate is proposed (absent message or legacy prose). Explicit malformed JSON or an invalid structured candidate is Failed even at unchanged Base; changed HEAD
   without a valid semantic or exactly correlated legacy candidate is Failed,
   never implicitly Accepted. Tests: legacy exact/foreign result
   cases and `preserves a sealed failure after semantic output changes`.

Each provider boundary has its existing intent-before-effect and
reconcile-before-retry chronology. A crash before provider observation causes a
reread, not a model restart; after the terminal seal, duplicate observations do
not replace that seal. This scope neither integrates a retained failed candidate
nor changes publication, cleanup, claims or attempt Base. Explicit recovery is
owned by #428.

## Real-host qualification

`codex-real-host-qualification.test.ts` supplies identity-free semantic results
through the real pinned app-server and built Dalph host. Its foreign legacy
correlation remains an independent negative control. Real crash/restart,
interruption and application Exit cases retain their existing assertions.
The escaped/stuck child fixture creates a separate OS session; backgrounding
a shell in the app-server's own group does not establish the required survivor.
This fixture correction changes no production process-ownership, shutdown or
workflow decision. Local qualification exercises all 23 real-host scenarios;
Linux/macOS hosted qualification remains a separate exact-head obligation.
