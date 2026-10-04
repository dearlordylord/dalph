# Alice isolates the Dalph host's Codex provider state

> **DRAFT — NOT TO BE TRUSTED.** This document was produced before the
> requested sequential design discussion was completed. It is not an accepted
> specification or implementation authority. Its decisions, contracts, test
> mappings and review conclusions require fresh discussion and validation.
> Individual user choices do not approve the surrounding design.

Alice supplies a dedicated provider home when starting a Dalph host. Each exact
planned attempt and integration session uses its own owned app-server under
[issue #434](https://github.com/dearlordylord/dalph/issues/434), while those
unit processes share the host's explicit provider-home namespace.
[Issue #431](https://github.com/dearlordylord/dalph/issues/431)
owns diagnosis and this proposed configuration. No live provider reproduction
has been run for this design, and no runtime behavior changes in this edit.

## Evidence and governing behavior

The issue reports integration stopped after IntegratorRunStarted and the same
retained Run later delivered with a private provider home and original request
parameters. That distinguishes an environment worth investigating; it does not
prove shared-home contention or any Codex internal cause.

For this design, #434's accepted per-attempt and integration-session containment
supersedes the shared-process premise in [ADR 0014](../adr/0014-isolate-codex-integration-session-threads.md).
Preserve the separation of execution/integration work and exact thread
ownership, not a shared process lifetime. Preserve
[complete owned-session discovery](production-codex-integrator.md#2-a-lost-thread-response-is-recovered-only-by-exact-ownership) and
[bounded RPC ambiguity rules](bounded-codex-rpc.md#a-codex-request-stops-answering).
[D21-D23](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence) prohibit inferring
absence from an incomplete list or retrying uncertain effects without
reconciliation. [D50 onward](../DELIVERY-INVARIANTS.md#application-exit)
preserve Exit admission and custody. The governing
[plannedAttemptExecutor model](../../specs/plannedAttemptExecutor.qnt) laws
`everyCallHasOneDurableIntent` and `unmatchedIntentBlocksAnotherCommand` constrain
exact attempt commands; home configuration and provider wire deadlines need
their existing process/RPC tests as well, rather than a claim of model coverage.
Implementation must identify and extend the exact affected model laws if it
changes launch or continuation authority.

## Proposed supported environment

- Design decision after reading #434: keep the maintainer's selected one
  operator-initialized provider home per Dalph host. Its per-attempt and
  integration-session app-servers share that home, never their launch/lease
  slots, transport, notification scope, or containment. This avoids per-unit
  authentication bootstrap/copying. Separate provider homes per unit are outside
  this slice, not a hidden prerequisite for #434. Shared-home provider behavior
  still requires qualification; this decision proves no cause or concurrency
  guarantee. Other configuration/diagnostic details remain proposed.
- Add an explicit absolute `codexProviderHome` configuration locator. Keep it
  distinct from executor-private association state, journal/evidence storage,
  repository, attempt worktrees, and integration candidates. Validate canonical
  path, directory identity, owner and private permissions before admission.
- The operator creates and authenticates the home with the installed provider's
  supported setup. Dalph never copies credentials, desktop databases, sessions,
  or config automatically. A missing home or missing usable authentication is
  a typed configuration/capability failure before claims or task work. Do not
  print secrets while proving access.
- Pass the selected home only to each exact unit's owned provider child. Do
  not edit the caller's environment or ambient home. Existing deliberate
  provider credential forwarding must not be silently dropped. Record effective
  provider model and policy/configuration identity through current owner seams.
- Pin the canonical home identity in every unit's private launch/session
  associations. Restart must reconcile the same namespace before enumerating
  sessions. A retained session bound to another home yields EnvironmentMismatch;
  it never becomes absent and never authorizes thread/start.
- The home is mutable provider-owned state, not a workflow database to duplicate
  or clean on task completion. Preserve it through Exit and failed setup.
- Add a separate canonical-home host lease; existing private-store launch
  fences do not protect a home shared by independent stores. Before any unit
  spawn, claim the home for one exact host owner/incarnation and persist custody
  references to its unit launch slots. Canonical filesystem identity, not path
  spelling, keys this lease; aliases and another host's private store cannot
  bypass it. The home lease admits this host's independent units, never another
  host. Unit process ownership and writer observations remain #434's facts.
  The new lease is a design requirement, not an existing implementation claim.
- After host death, a released OS lock alone does not clear the durable home
  fence: units may survive. Reconcile every referenced exact unit's launch,
  session and stopped-writer proof before transferring home custody. Live,
  foreign, missing or unreadable evidence retains the fence. Do not signal a
  foreign host to steal its home. Exit releases the host-home lease only after
  its owned units are proved stopped; failed finalization retains it. Scope is
  cooperating Dalph hosts on the supported local filesystem. The operator must
  reserve the dedicated home from unrelated Codex/desktop use; this lease is
  not a machine-wide provider lock.
- For compatibility, an existing ambient-home launch may continue only after
  exact association/launch reconciliation in that same environment. A new
  explicit home cannot silently relocate it. Adoption needs an explicit fresh
  host setup or a separately specified stopped-session migration.
- Keep `thread/list`'s existing scoped cwd, `modelProviders: []`, source kinds,
  pagination, duplicate/cursor validation and exact ownership checks. Isolation
  is not permission to weaken those semantics.

## Bounded diagnosis before implementation

#434 defines the selected containment composition for this diagnosis; it is not
implemented by this task. Qualification must exercise distinct unit processes,
including two concurrent attempts plus integration, before claiming support.
Design decisions are made now; diagnostic execution against that composition
depends on #434's implementation. Its legacy shared-custody migration remains
owned by #434, not an implicit provider-home migration here.

Use metadata-only diagnostics through the existing app-server read boundary,
never a database scan. Pin provider executable/version, model/config identity,
one existing exact owned session, its unit owner, and request shape. Log method,
request ID,
page ordinal, cursor fingerprint, timing, sent/pending/response counts,
completion/error category, and owned-close result. Exclude authored text,
credentials, raw payloads, full environment, and unrelated thread identifiers.

First run the original complete scoped list through the exact unit's app-server
against the ambient home
and a legitimately initialized isolated home. Each independent probe has a
three-minute wall-clock stop, recorded as an absolute UTC time before launch;
keep the existing sixty-second RPC bound and reserve shutdown time. The probe
creates no task/thread/turn and performs no provider mutation. Do not move an
existing session to the isolated home; use its own pre-existing owned session,
or explicitly label the trial non-equivalent and avoid a causal conclusion.

Then, only if these observations discriminate an unanswered list, test one
request-filter difference at a time in a separate bounded read-only probe. A
query with omitted cwd/provider filter is diagnostic only, never an automatic
production fallback. Compare completeness/ownership as well as latency.
Observe deadline and exact close behavior independently. If stopped writers
cannot be proved, preserve custody and stop that line of probing. Two
non-advancing trials require a changed experiment, not another live retry.

Competing hypotheses are shared-history enumeration cost/contention, provider
filter behavior, and a deadline/close boundary that hides the original failure.
No hypothesis is selected merely because one isolated invocation succeeds.
Bulk variants belong in controlled protocol tests.

## Chronologies and acceptance mapping

Names below are proposed additions to existing tests, not passed observations.

| Starting facts, trigger and ordered calls | Crash/retry and visible/forbidden result | Acceptance test seam |
| --- | --- | --- |
| R has an exact accepted executor session and unrelated provider history. Integration records discovery intent, lists all pages plus loaded sessions, then reads and validates only candidate matches for its own session/workdir. | Crash preserves discovery/session associations; retry repeats complete reads. Alice sees exact session or explicit unknown/conflict, never a foreign session or duplicate start. | `Integrator discovery ignores foreign sessions while preserving complete owned enumeration` in Codex Integrator/app-server tests |
| `thread/list` receives no response. The existing RPC deadline ends the local wait and the exact owner close protocol runs. | Lost response or crash preserves existing session/candidate and uncertain intents. Later activation reconciles; no absence inference, duplicate turn, or silently live wait. Alice sees sanitized method/deadline and unresolved close if applicable. | `unanswered Integrator enumeration retains its session and authorizes no second start` in bounded RPC and Integrator recovery tests |
| Alice supplies initialized dedicated home H with no prior Run. Host validates and acquires H, then #434's unit owners launch distinct app-servers with child-only environments and prove policy/access before work. | Restart reconciles H and each exact unit/session before continuation. Alice sees effective namespace/profile without secrets; ambient home is unchanged. One unit's close cannot close another process. | `one host home survives distinct executor Integrator owners and host restart without ambient writes` in configuration/process/production-host tests |
| Retained session belongs to H1 but Alice configures H2, or H has missing auth, wrong owner, unsafe path or another live launch owner. | Fail before claims/new sessions. No implicit relocation/bootstrap, old database copy, or treating missing enumeration as absence. Exact H1 remains inspectable. | `changed unsafe or uninitialized provider home cannot authorize a replacement session` in configuration and recovery negative controls |
| Exit races with a pending list or unresolved close. Host seals admission, drains/closes through existing owner, and records observations. | Crash/retry retains unresolved custody. Alice sees Exit result independently of task delivery; no stopped claim without proof and no deletion of H. | `provider enumeration during Exit preserves exact launch custody through deadline` in Exit/process tests |
| Two hosts with different private stores select the same canonical H or aliased path. The second acquires no unit launch while the first home lease/fence remains. | Crash of the first host cannot transfer H while any referenced unit writer is live or unproved. Reject/wait preserves all resources; no foreign close or credential copy. | `independent host stores cannot share or steal an unresolved provider home` in real filesystem lease and unit-recovery tests |

Required real-host evidence is one minimal version-pinned bounded comparison and
one owned-launch/close test; controlled tests cover bulk malformed pagination,
identity, environment, and timing variants. Authentication/bootstrap remains an
explicit operator procedure with documented permissions. Update production
configuration, unit launcher tests that currently assert ambient home, and provider
recovery associations together. Keep #430's truthful diagnostics separate from
the still-unproven cause. This draft is not a diagnosis or availability claim.
