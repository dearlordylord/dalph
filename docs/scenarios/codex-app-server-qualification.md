# Issue #75: qualify the Codex app-server executor on real hosts

Issue: [Qualify Codex app-server executor against real Codex behavior](https://github.com/dearlordylord/dalph/issues/75)

Status: acceptance evidence for the ten accepted chronologies and refinements in issue #75.

No person triggers these fixture events. A Dalph process, the pinned Codex CLI,
its app-server and shell children, Git, the private executor store, and the
fixture model provider are the relevant systems. The fixture starts with one
exact worktree and planned Base SHA, an empty private store, no Codex rollout,
and no workflow-journal executor result. Git owns the worktree and commit;
Codex owns thread and process facts; the private store owns only Dalph's
association and launch records. A test starts the built Dalph host, or kills it
at the named cut. A successor always rereads those authorities before acting.

The visible results are only `ExecutorWorkExecuting`,
`ExecutorWorkSafelySuspended`, or a normalized terminal/projection. The private
Codex thread id never enters a public executor
report, generic cassette, or workflow-journal event. A lost response, missing
rollout, unreadable process, foreign correlation, timeout, or crash must never
fabricate terminal success or safe suspension. Retries reuse a proven exact
thread or replace only a conclusively empty pre-turn allocation; they never
send a second task turn after an ambiguity-crossing turn request.

## Issue #307 qualification starts one isolated controlled-provider child

The protected qualification job is the affected operator boundary. Before the
job starts, GitHub has supplied only its repository token through the protected
`DALPH_LIVE_GITHUB_TOKEN` secret; no OpenAI, API, or Codex-provider secret is
configured. The controller has one disposable checkout and an empty temporary
fixture root. The controlled loopback Responses endpoint is the provider used
by this qualification only; it never calls OpenAI.

When the job invokes the shipped qualification command, the outer controller
creates a fresh random throwaway credential for that invocation. It passes the
credential only to the controlled child under
`DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL`, and passes that child an isolated
`CODEX_HOME` whose `config.toml` names the same qualification-specific env key.
The child receives the ordinary GitHub token separately. Dalph's
`codexExecutorPrivateStateDirectory` is a different path containing only
attempt/app-server ownership state; `codexHome` contains only controlled Codex
configuration. The controller does not serialize, log, publish, or return the
throwaway value, and its redaction checks reject output that would expose it.

If setup or the child exits before qualification completes, the controller
retains the existing exact cleanup disposition and never retries by reusing the
credential. A retry starts a new invocation with a distinct generated value.
The workflow refuses to start without `DALPH_LIVE_GITHUB_TOKEN`; it does not
look for or require an external provider credential. A failure from the
loopback endpoint is a controlled qualification failure, not permission to
fall back to OpenAI or to another provider.

### Acceptance-test mapping

| Qualification outcome | Executable evidence |
| --- | --- |
| The protected workflow requires only the GitHub secret and contains no external provider secret. | `production live workflow exposes only the GitHub secret to the protected qualification` |
| The production generator returns distinct random throwaway values, and the production composition invokes that generator once per invocation, supplies its exact value only as the qualification-specific child environment entry, and rejects the child record before publication when the record contains it. The safe failure result contains no value bytes. | `generates distinct random controlled-provider credentials without serializing their bytes`; `generates, supplies, and rejects one fresh controlled-provider credential per invocation` |
| Controlled `codexHome` and Dalph-owned `codexExecutorPrivateStateDirectory` are distinct. The isolated config selects exactly one provider, names the qualification key, accepts only its loopback-branded endpoint, disables request/stream retries, and contains no OpenAI provider. | `production live qualification fixture separates Codex home from executor private state`; `rejects malformed worktree and Git head facts before returning an accepted response` |
| The controlled endpoint accepts only `/v1/responses` on its bound loopback listener, invokes only the injected Git-head reader during its four expected requests, and retains only safe operation tags and counts. No external model-client boundary exists in this endpoint. | `controlled qualification provider serves loopback responses without an OpenAI call` |

The qualification runner builds the checked-in Dalph host, verifies Codex
`0.149.0`, and runs the same suite on Linux and macOS in
`.github/workflows/codex-app-server-qualification.yml`. The raw-protocol tests
are deliberately separate evidence for Codex notification and JSON-RPC cuts;
the built-host tests below prove the normalized Dalph boundary.
The hosted Linux leg uses one disposable OS account for Dalph and its Codex
descendants. GitHub runner processes therefore have a provably foreign
effective UID when their protected process environments are unreadable, while
every process the fixture creates remains subject to the same fail-closed
ownership census as production.

## Scenario-to-test mapping

| Accepted chronology or refinement | Concrete chronological outcome | Executable evidence |
| --- | --- | --- |
| 1. Create and materialize | Dalph asks real Codex to start one thread in the exact worktree, privately associates it, sends one task turn, and first reports `ExecutorWorkExecuting`. | `normal built host returns ExecutorWorkExecuting then the sealed Accepted commit without exposing its Codex thread id` |
| 2. Empty pre-turn loss | Dalph dies after real `thread/start` but before a task turn. A successor sends exactly one task turn; no lost process reports success. | `a killed empty allocation is replaceable before the first task turn and sends no duplicate task turn` |
| 3. Turn-response loss | The fixture accepts one turn while Dalph loses its continuation. The successor retains the same private thread, rereads Codex, and makes no replacement model call. | `a lost turn response is reconciled on restart with the same private thread and no duplicate task turn` |
| 4. Restart | A later built process projects the sealed outcome and rereads the exact evidence bytes, digest, correlation, and Git commit. | `built create reports ExecutorWorkExecuting, process restart projects the same thread as terminal Accepted, and rereads evidence` |
| 5. Safe suspension | Real Codex launches a long-lived shell child capable of changing the worktree. Dalph interrupts the turn and independently observes that exact PID absent before reporting `ExecutorWorkSafelySuspended`. | `active real turn suspends only through the normalized executor boundary` |
| 6. Stuck survivor | Real Codex launches a TERM-resistant shell child. The production application Exit cutoff closes, its executor drain remains unresolved through the original five seconds, the exact child is still live at the result, private state is nonterminal, and Exit reports `TimedOut` with requested status 1. The test then kills that exact disposable PID so it cannot leak. | `unresolved executor activity makes the real application Exit time out without releasing its position` |
| 7. Terminal seal | A real terminal notification becomes exactly `Accepted` with the Git commit or `Failed`; `Completed` is never inferred. A later process reuses the seal. | `terminal seal: Accepted names the real Git commit while Failed remains distinct`; `unexpected death after terminal notification preserves the sealed result for the next process` |
| 8. Graceful application Exit | The production Exit coordinator closes admission, drains the exact executor to `ExecutorWorkSafelySuspended`, closes the app-server process group, releases the coordinator lock, reports status 0, and a later process resumes the same thread without another model call. | `the Exit action safely suspends before closing the owner and the next host resumes the same thread` |
| 9. Death at every boundary | Built-host cuts cover ready-before-thread, post-thread/pre-association, association-write in progress, post-association, lost turn response, interruption in flight, and post-terminal. Raw tests separately cut the app-server process at notification/JSON-RPC boundaries. Each successor rereads private/Codex/OS facts and emits no fabricated report. | `unexpected death at the ready boundary produces no fabricated report before thread/start`; `a killed empty allocation...`; `Dalph death while the production executor writes the private association starts exactly one later task turn`; `a killed associated empty thread...`; `a lost turn response...`; `unexpected Dalph death during the real interruption boundary reconciles without safe or replacement work`; `unexpected death after terminal notification...`; raw `process-death cut ... preserves no fabricated executor result` cases |
| 10. Contradiction | Missing, malformed, or unreadable real rollout state projects exactly `Unreadable`; foreign final evidence becomes `Failed`; a foreign public request is `NoReport`. Model-call counts do not change. | `a missing real Codex rollout after an ambiguous turn projects Unreadable without replacement model work`; `a malformed/unreadable real Codex rollout projects Unreadable without replacement model work`; `a foreign final correlation cannot fabricate Accepted...`; `a foreign project correlation returns NoReport...` |
| Post-thread-start/pre-association refinement | The `allocate` cut proves an unassociated real thread is not a task turn; the blocked-store cut additionally runs the production executor through real `thread/start` and stops while its exact `AssociatedPreTurn` write is in progress. | Empty-allocation and `production executor writes the private association` tests above |
| Suspension/terminal race refinement | Real terminal failure or acceptance wins over a concurrent suspension request; neither case fabricates `ExecutorWorkSafelySuspended`. | `terminal failure wins over suspension at the built host boundary`; `terminal acceptance wins over suspension at the built host boundary` |
| Dalph-only death refinement | Dalph alone is SIGKILLed after a turn request while its detached app-server remains exactly live. The successor proves the prior PID absent before projecting the same thread and making no replacement call. | `a lost turn response is reconciled on restart with the same private thread and no duplicate task turn` |
| Prior-leader-loss refinement | If a `Launching` intent or recorded app-server leader remains but the leader is already absent, an escaped real work process still carries its exact durable launch token. A successor repeatedly reads the token census, stops each exact process, and proves a fresh census absent or inert before admitting a replacement; the built host records that the child cannot mutate the worktree at the instant replacement `ready` arrives. Malformed, omitted, empty, permission-denied, or never-quiescent host observations fail closed. | Built host: `restart stops a real escaped token child after the prior app-server leader is gone and before replacement admission`. Controlled cuts: `does not clear a Launching intent until its escaped token child is absent`; `stops an escaped exact-token child before replacement after its prior leader is absent`; `repeats the durable-token census until a later token child is also absent`; `fails closed when the durable-token recensus bound is exhausted`; `fails closed when Darwin reports a live process with malformed stat text`; `fails closed when Darwin omits a recorded live leader or returns an empty census`; `fails closed when an exact-token census cannot read a live process environment` |
| Private-id refinement | The built host's known private id is absent from every emitted public event; the maintained cassette now exposes only the private record tag and asserts the known cassette thread id is absent from serialization. | `normal built host returns ExecutorWorkExecuting then the sealed Accepted commit without exposing its Codex thread id`; `runs maintained Codex executor stories through the concrete production executor` |
| Supported hosts | One pinned runner and one test list are used unchanged on both supported operating systems. The Linux job runs Dalph and Codex under one disposable account so unrelated protected runner processes are provably foreign; platform-specific process observations must satisfy the same result contract. | workflow matrix entries `ubuntu-latest` and `macos-latest`, each running `pnpm qualify:codex` |

No provider mutation retry applies: the fixture provider receives model calls
but owns no tracker lifecycle or claim. No GitHub facts participate. Crashes and
retries apply only at the explicitly mapped Codex, private-store, process, Git,
and application Exit boundaries.
