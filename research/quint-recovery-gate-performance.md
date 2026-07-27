# Why the Quint recovery gate reached 420 seconds

**Date:** 2026-07-27
**Repository revision studied:** `40ba4f73488fb8cefb6cfd550a84b0ee895c358f`
**Quint:** `@informalsystems/quint@0.32.0`
**Quint Connect:** `@firfi/quint-connect@2.0.2-effect4.1`
**quint-llm-kit:** `520e563613c25abac4c631ea2aa3181ba76ba193`

## Decision

The timeout is not evidence that TLC needs seven minutes to explore the recovery
state space. It is a multiplication problem in the gate:

1. One `quint verify --backend tlc` process spends about 32 seconds preparing
   one proof.
2. TLC then spends only about 1–2 seconds checking that proof.
3. The gate starts a fresh Quint process for each of nine exhaustive profiles.
4. It also starts separate processes for typechecks, deterministic tests, nine
   sampled profiles, and thirteen expected counterexamples.

The current sequential `pnpm check:quint` gate takes **412.19 seconds**, leaving
only **7.81 seconds (1.9%)** beneath its 420-second kill limit. Normal runtime
variance is therefore enough to turn a correct proof portfolio into a timeout.

The immediate proof of concept is to keep the nine exhaustive profiles separate
but run three at a time. That exact portfolio first passed in **235.85
seconds**. The reviewed delivery candidate, with full Quint verbosity 3 and
phase telemetry, passed repeatedly in **229.73–260.27 seconds**. This is a
useful wall-clock fix, but not the long-term cure: it consumed essentially the
same total CPU and still recompiles the whole model for every profile.

## The arithmetic: how “about 30 seconds” becomes 420 seconds

“Thirty seconds” is not one startup pause that somehow expands to seven
minutes. It is paid repeatedly.

| Component | Count | Observed or derived wall time |
|---|---:|---:|
| Exhaustive positive profiles | 9 | **295.96s measured**, about `9 × 33s` |
| All other frontier-model work | 27 commands | about **112.18s** |
| Earlier task-session model work | 3 commands | about **4.05s** |
| Full sequential `check:quint` gate | 39 commands | **412.19s** |
| Quality-gate limit | — | **420.00s** |
| Margin | — | **7.81s** |

The exhaustive total and full-gate total were measured directly. The
per-profile range was **32.27–34.29 seconds**, which explains why nine separate
proof commands consume roughly 296 seconds. The remaining frontier phases were
about 17.5 seconds of typechecks/tests, 52.4 seconds of sampled profiles, and
42.3 seconds of deliberate counterexamples; the task-session model commands
account for the remaining roughly four seconds.

The phrase “30-second startup” is also imprecise. For an unchanged exhaustive
profile at the current revision, the whole command took **33.23–33.53
seconds**, while Quint reported only **1.185–1.654 seconds** inside TLC. Thus
roughly **31.6–32.3 seconds** happened before or around TLC: launching
`pnpm`/Node, loading and parsing the model, resolving and typechecking it,
flattening the selected module, serializing the flattened IR, compiling that IR
to TLA+ through Apalache, fetching/checking the distribution, launching the
JVM, and teardown.

Quint's own v0.32.0 source makes this sequence explicit. Its TLC verification
path converts the selected init, serializes the flattened module, calls
`compileToTlaplus`, and only afterward calls TLC
([`verify.ts`](https://github.com/quint-co/quint/blob/v0.32.0/quint/src/verify.ts#L30-L88)).
The TLC adapter then creates a temporary directory, writes a new `.tla` and
`.cfg`, and spawns a new Java process
([`tlc.ts`](https://github.com/quint-co/quint/blob/v0.32.0/quint/src/tlc.ts#L104-L161)).

This is why reducing TLC's already-small 1–2 seconds cannot rescue a gate that
repeats about 32 seconds of preparation nine times.

## Measurements

All measurements below were taken in the same worktree and environment on
2026-07-27. Quint verbosity was raised where needed to separate its reported
TLC duration from process wall time.

| Experiment | Wall time | TLC time | Finding |
|---|---:|---:|---|
| One unchanged exhaustive profile at `8ce2ee351` | 26.78s | 1.262s | Even the older model was frontend/compiler dominated. |
| The same profile at `40ba4f734` (repeat range) | 33.23–33.53s | 1.185–1.654s | Model growth added about 6.5s outside TLC; TLC did not regress. |
| Current exhaustive profiles | 32.27–34.29s each | 0.808–2.166s | About 93–98% of command wall time is outside TLC. |
| Current sampled activation profile | 4.79s | n/a | The simulator is suitable for fast reachability/safety feedback. |
| Full current sequential `check:quint` gate | **412.19s** | n/a | Only 7.81s below the hard timeout. |
| One activation proof, ordinary compiler lifecycle | about 36.14s | small | Baseline for the persistence experiment. |
| Same proof with a persistent Apalache server | about 31.83s | small | Saved about 4.31s (12%), but compilation was still repeated. |
| Two exhaustive proofs, concurrency 2 | about 36s | n/a | Two independent proofs fit into about one sequential wall-time slot. |
| Three exhaustive proofs, concurrency 3 | about 39s | n/a | Three-way batching remained stable on this host. |
| Full gate, exhaustive concurrency 3 | **235.85s** | n/a | Same proof portfolio passed with 184.15s of timeout margin. |
| Reviewed gate, concurrency 3 and verbosity 3 | **229.73s** | 1.15–2.21s in the observed exhaustive batches | Full diagnostics, phase totals, and the same proof portfolio passed. |
| Final `check:all` formal phase under higher host load | **260.27s** | 1.39–2.92s in the observed exhaustive batches | Stayed below the 270s warning and 300s frontier budget. |

The concurrency proof of concept reduced wall time by **176.34 seconds
(42.8%)**, a **1.75×** speedup. It did not reduce work: total CPU was about
**655.63 seconds**, versus **649.16 seconds** for the prior run, an increase of
about 1%. The speedup comes from overlapping independent compilation and model
checking, not from making a proof cheaper.

Two other experiments bound the available shortcuts:

- Reusing an Apalache server removed only a few seconds because the Quint TLC
  path still sends a fresh flattened JSON program through `compileToTlaplus`
  for every profile. Persistence avoids some server/JVM lifecycle cost; it is
  not a compiled-model cache.
- A generated module intended to combine the profile wrappers into one
  compilation failed with `RangeError: Invalid string length` during
  compilation. Combining everything into one enormous flattened artifact is
  therefore not a safe immediate optimization. It also makes proof ownership
  and failure isolation worse.

## What changed in Git history

The regression accumulated; there is no single commit where TLC suddenly became
slow.

| Revision | Model lines | Gate invariants | Sampled profiles | Exhaustive profiles | Negative profiles | Timeout |
|---|---:|---:|---:|---:|---:|---:|
| [`652900f12`](https://github.com/dearlordylord/dalph/blob/652900f1216f578b6a2ddeea23ca20bd15337945/scripts/check-frontier-recovery-model.mjs) | 1,523 | 8 | 4 | 4 | 3 | 5m |
| [`f415c52f9`](https://github.com/dearlordylord/dalph/blob/f415c52f9e65db1b08927afa291f6370ca601d82/scripts/check-frontier-recovery-model.mjs) | 1,693 | 8 | 4 | 5 | 4 | 5m |
| [`8ce2ee351`](https://github.com/dearlordylord/dalph/blob/8ce2ee351/scripts/check-frontier-recovery-model.mjs) | 1,996 | 8 | 7 | 6 | 4 | 7m |
| [`40ba4f734`](https://github.com/dearlordylord/dalph/blob/40ba4f73488fb8cefb6cfd550a84b0ee895c358f/scripts/check-frontier-recovery-model.mjs) | 2,677 | 24 | 9 | 9 | 13 | 7m |

The first accepted model already launched four exhaustive proofs. The important
historical trend is:

- the model grew **75.8%**, from 1,523 to 2,677 lines;
- the invariant conjunction tripled, from 8 to 24 invariants;
- exhaustive profiles grew from 4 to 9;
- negative profiles grew from 3 to 13; and
- the timeout was raised from five to seven minutes at `8ce2ee351`, masking the
  trajectory without adding a runtime budget or phase telemetry.

From `8ce2ee351` to the current revision alone, the model added 681 lines, the
gate added 16 invariants, three exhaustive activation profiles, two sampled
profiles, and nine negative profiles. One unchanged proof became only about
24% slower (26.78s to roughly 33.4s), while the proof portfolio became much
larger. **The dominant regression is repeated whole-model preparation
multiplied by profile count; model size is the secondary multiplier.**

TLC time staying near one second across old and current revisions rules out a
state-space explosion as the explanation for this timeout. That conclusion is
specific to these bounded profiles and measurements; it does not claim the
model's state space can never grow badly.

## What the official guidance implies

The installed quint-llm-kit was pinned at
[`520e563`](https://github.com/quint-co/quint-llm-kit/tree/520e563613c25abac4c631ea2aa3181ba76ba193).
Its verification guidance separates three jobs:

1. typecheck first;
2. use `quint run` with the Rust backend for witnesses and sampled invariants;
3. increase samples or depth progressively when a witness is not found.

See the kit's
[`verification.md`](https://github.com/quint-co/quint-llm-kit/blob/520e563613c25abac4c631ea2aa3181ba76ba193/agentic/guidelines/verification.md)
and Quint's own description of the tight parse/typecheck feedback loop and
interactive behavioral validation
([“Reliable Software in the LLM Era”](https://quint-lang.org/posts/llm_era)).
Quint's documentation describes `verify` as checking all executions within the
chosen bound, while `run` samples executions
([Secret Santa example](https://quint-lang.org/posts/secret_santa)).

The lesson is not “replace proofs with simulation.” Simulation, deterministic
tests, exhaustive positive proofs, and deliberate negative counterexamples
answer different questions. The lesson is to preserve that layered portfolio
without recompiling an ever-growing monolith serially for every question.

## Prevention policy

### 1. Put a budget on proof preparation, not only on the whole gate

Record, for every formal command:

- command kind and profile name;
- wall time;
- TLC/model-checker time when available;
- preparation time (`wall - checker`);
- maximum RSS; and
- exit/violation classification.

Also print aggregate totals for typechecking, deterministic tests, sampling,
exhaustive positive proofs, and expected counterexamples. Keep these performance
totals separate from the semantic pass/fail result.

Fail or require review when a change:

- adds an exhaustive profile without declaring which acceptance scenario it
  uniquely owns;
- increases estimated sequential formal time above a fixed engineering budget;
  or
- raises the timeout without a written root-cause record.

A hard total timeout is still useful as a final kill switch, but it was too
coarse to reveal this regression. The performance regression budget must be
lower than 420 seconds; otherwise a change is detected only when ordinary
variance starts killing the process.

### 2. Keep proofs sliced; compile smaller semantic units

Each exhaustive profile should check the invariants relevant to that profile,
not automatically inherit every invariant ever added to the model. Before
changing the conjunction, maintainers must record why an omitted invariant is
out of scope and where it is proved instead.

As recovery domains grow, move independently owned phenomena into smaller
models/modules with explicit refinement or conformance boundaries. Activation
ownership is the first candidate: compiling a smaller activation model once per
activation proof attacks the measured bottleneck, whereas shrinking TLC's
one-second search does not.

This requires a semantic review. Blindly deleting invariants or profiles to
improve time would weaken the delivery contract.

### 3. Use bounded concurrency as the immediate mitigation

Run independent exhaustive proofs with concurrency three on hosts that have the
measured CPU and memory capacity. Keep:

- Quint verbosity 3 so the gate retains TLC duration and diagnostic evidence;
- deterministic output grouped by profile;
- fail-closed aggregation after every started child settles;
- bounded, configurable concurrency with a lower setting for smaller CI agents;
- phase and whole-gate timing totals; and
- the same exact profile, init, step, and invariant expressions.

The proof of concept passed in 235.85 seconds, so the seven-minute limit becomes
a genuine kill switch again. Because CPU work did not fall, concurrency is a
mitigation, not permission to keep adding profiles without budget review.

The reviewed script caps concurrency at three and lowers it when the host has
fewer than six available CPUs or 32 GiB of memory. Operators may request a
lower value through `DALPH_QUINT_VERIFY_CONCURRENCY`; the complete value is
validated instead of accepting a numeric prefix. Each child retains at most 16
MiB of diagnostic output. Because choosing an ephemeral port necessarily
closes the reservation before Apalache binds, the script retries once only when
the captured failure explicitly reports an endpoint bind/connect problem;
semantic violations, TLC failures, signals, and resource errors fail
immediately.

One shared policy now gives the complete gate a 420-second emergency timeout,
a 400-second engineering budget, a 100-second task-session sub-budget, and a
300-second frontier sub-budget (with a warning at 270 seconds). A wrapper times
the three task-session commands under one decreasing 100-second deadline before
starting the frontier checks, then runs frontier under an active 300-second
deadline and reports the complete gate time. A shared bounded-process helper
terminates the whole child process group on expiry. This leaves 20 seconds
between the sum of actively enforced sub-budgets and the emergency kill. On the
measured run the task-session commands took about four seconds, so their
allowance is intentionally conservative.

### 4. Remove duplicate Quint compilation from model-based tests

The recovery reconstruction suite has thirteen `quintIt` calls. Each call
invokes `quintRun`; Quint Connect's default run policy starts `quint run --mbt`
and compiles the same source again. The helper's default test timeout is 30
seconds, although this repository overrides many lanes to 60 seconds
([`vitest.ts`](https://github.com/dearlordylord/quint-connect-ts/blob/1fc20ef34e4ed47e3e10c28ae28164ae0b5bab98/src/vitest.ts#L7-L18)).

Quint Connect already exposes a `compiledInput` path for run-mode generation,
which bypasses the Quint CLI and runs the compiled Rust evaluator directly
([README](https://github.com/dearlordylord/quint-connect-ts/blob/1fc20ef34e4ed47e3e10c28ae28164ae0b5bab98/README.md),
[`trace-generation-policy.ts`](https://github.com/dearlordylord/quint-connect-ts/blob/1fc20ef34e4ed47e3e10c28ae28164ae0b5bab98/src/cli/trace-generation-policy.ts)).
All current reconstruction lanes use run mode, so prebuilding and reusing
profile-compatible compiled inputs is the next performance target. Compatibility
must include the selected module/init/step and source hash; one artifact must
not be assumed valid for every profile.

This matters beyond the 412-second `check:quint` result: `pnpm check:all` later
runs coverage, and coverage runs those MBT lanes, paying another substantial
Quint preparation bill.

The final full-gate measurement made that bill concrete: the thirteen frontier
reconstruction MBT lanes took **216.25 seconds** (individual lanes
10.27–29.08 seconds) inside a **217.71-second** coverage run. The production
test assertions themselves are not plausibly responsible for nearly all that
time; the per-lane pattern and Quint Connect execution path identify repeated
model preparation as the next bottleneck to remove.

## Recommended delivery sequence

1. Retain the concurrency-three gate change only while it preserves all current
   proof commands, verbosity 3, per-profile and phase timing, and the
   300-second frontier regression budget below the 420-second safety timeout.
2. Add a checked inventory mapping every profile to its acceptance scenario and
   invariant subset.
3. Prototype a source-hashed compiled-input cache for the thirteen Quint
   Connect lanes and measure cold versus warm coverage.
4. Split activation ownership from the monolithic frontier model only after a
   spec review establishes the refinement/conformance boundary.
5. Keep a recurring benchmark at the four historical revisions or equivalent
   frozen fixtures so future model growth is visible before anyone raises the
   timeout.

## Confidence and remaining uncertainty

**High confidence:** TLC is not the present bottleneck; repeated
frontend/flatten/compile/process work is. The wall/TLC split, unchanged-profile
comparison, persistent-server experiment, and Quint source all agree.

**High confidence:** concurrency three is a valid wall-clock mitigation on the
measured host. It preserves proof count and reduced 412.19s to
229.73–260.27s across reviewed, full-diagnostic runs.

**Medium confidence:** splitting the model and reusing compiled MBT inputs will
produce the largest durable improvement. Both target measured repeated work,
but exact savings require profile-compatible prototypes.

**Low confidence / rejected shortcut:** merging every proof wrapper into one
giant compilation. The prototype already failed with `RangeError: Invalid
string length`, and even a successful compile would create a large,
hard-to-isolate verification unit.
