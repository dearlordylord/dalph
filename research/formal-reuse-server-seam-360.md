# Owned Apalache server seam for #360

Status: static investigation only. No checker or server was launched and no installation was changed. The installation agent had not confirmed readiness when this note was written. This documentation changes no Dalph runtime behavior.

When a developer invokes the local formal command, the runner must start its identified server, prove that server owns the selected listening socket, direct Quint children to that socket, and prove the process stopped before publishing success. An ambient server is outside that custody and must remain untouched.

## Installed source facts

The inspected pinned package is `@informalsystems/quint@0.32.0`, available in the original workspace at `node_modules/.pnpm/@informalsystems+quint@0.32.0/node_modules/@informalsystems/quint/dist/src/` while integration installation is pending.

- `cli.js:105` and `cli.js:352` expose `--server-endpoint hostname:port` for compilation and verification. Default is `localhost:8822`. `apalache.js:83` accepts IPv4/DNS-style names and numeric ports; it does not accept Unix sockets or IPv6 literals.
- `apalache.js:285` has a private `tryConnect(endpoint, retry=false)` which obtains the command service descriptor through gRPC reflection and constructs the CHECK/TLA client. `connect` is exported; `tryConnect` is not.
- `apalache.js:193–254` loads `reflection.proto`, queries `shai.cmdExecutor.CmdExecutor`, and applies a five-second reflection deadline. With retry enabled it waits up to sixty one-second connection observations. Neither constructed gRPC client is explicitly closed in the inspected implementation.
- `apalache.js:374–398`: `connect()` first tries the requested endpoint; on any failure it fetches artifacts and spawns a replacement server. The replacement uses **the same requested port**, via `spawn(exe, ['server', '--port='+port])`. This does not redirect to the ambient default port, but creates an unowned replacement and can download after observation. Endpoint routing alone therefore cannot prove the required fail-closed behavior.
- `apalache.js:305–318`: `fetchApalache` trusts existence of the launcher; otherwise it downloads/unpacks the distribution. Complete preflight must check the JAR and launcher independently, and checking must forbid this fallback.
- `verify.js:49`: TLC verification first compiles through Apalache at the supplied endpoint. `verify.js:56` then calls `fetchApalache` to obtain the local distribution.
- `tlc.js:104–174`: TLC resolves `apalache.jar` through `QUINT_HOME`, then spawns `java` through PATH with heap/stack options, `tlc2.TLC`, workers (default `auto`), and runner-generated temporary paths. Thus TLC is not independent of server routing or Java identification.
- `config.js`: artifact directories derive from `QUINT_HOME`, otherwise `os.homedir()/.quint`.
- Repository `quint-temporal-gate.mjs` pins Apalache `0.56.1`; its preparation obligation is an actual default-backend check and must remain in the complete manifest even when artifacts are prepared beforehand.

## Server and Java boundary

The existing `/home/node/.quint/apalache-dist-0.56.1/apalache` distribution contains launcher scripts and one `lib/apalache.jar`. The JAR embeds Z3 native libraries for supported platforms, including Linux aarch64/amd64. Hashing the whole JAR identifies these embedded solver bytes.

Static class inspection finds `ServerCmd` exposes `--port` (overrides environment `PORT`) and `--type` (checker/explorer). `RpcServer` references `io.grpc.ServerBuilder.forPort(int)`; no host/bind-address option was found. This indicates wildcard binding rather than explicit loopback binding and needs confirmation in the finite probe. If the accepted private-endpoint contract requires loopback-only listening, a unique owned port is insufficient: that is a limiting seam to report before adding a proxy, namespace, or backend fork.

The launcher resolves its own symlinks, reads `APALACHE_JAR`, `JVM_ARGS`, `JVM_GC_ARGS`, and `TMPDIR`, invokes shell tools for directory/temp preparation, and uses `exec java ... -jar "$APALACHE_JAR"`, preserving PID across the shell-to-JVM transition. Its default heap is 4096m and default GC options are explicit. Direct identified-Java launch with equivalent declared arguments avoids shell-tool ambiguity, provided the resulting effective profile is explicitly identified.

Java currently resolves to `/home/node/.local/java/jdk-17.0.18+8-jre/bin/java`. Identify and observe the complete resolved JRE tree (including `conf`, `lib/modules`, `lib/server/libjvm.so`, security settings/data and native libraries), not only the launcher/version string. `ldd` on this launcher and JVM shows additional external libc/pthread/dl/rt/m/loader objects under `/lib/aarch64-linux-gnu` and `/lib/ld-linux-aarch64.so.1`; include their resolved bytes/locations and links. The same rule applies to Node and the Rust evaluator. An ELF dependency inventory must account for native objects dynamically loaded by the runtime and embedded Z3, not merely the launcher's first `ldd` output. Strip Java injection variables unless explicitly accepted and identified. Effective passed-through values require digest identity, including unset versus empty.

## Smallest bounded client change

A pinned pnpm patch is a smaller, reviewable seam than reimplementing gRPC reflection or monkey-patching CommonJS exports through a preload. Under an explicitly runner-owned endpoint marker, `connect()` can require exact endpoint equality and return `tryConnect` failure before entering automatic spawn/download. Under the same marker, `fetchApalache` can refuse missing prepared artifacts. When the marker is absent, hosted/raw Quint behavior remains unchanged. The marker is runner-owned transport metadata; the wrapper must strip caller versions and supply its own value.

For readiness, export a narrowly scoped reflection-only readiness operation which closes its reflection client after completion. Avoid using exported `connect()` as a readiness probe before fallback is disabled. Existing custody already records intent before spawn, process identity afterward, exact process-group absence and terminal receipts through `run-bounded-command.mjs` / `gate-spawn-registration.mjs`; reuse those primitives for the long-lived server rather than introducing another process protocol. A server lifecycle adapter is required because the current bounded helper waits for exit and is not a readiness-returning resource handle.

## Finite experimental probe (proposed, not executed)

Select these provisional guards **before** launch: one 30-second server/readiness/check allowance, 5 seconds total TERM-to-KILL shutdown accounting, 2 seconds absence accounting, and a 40-second outer watchdog. These are experimental limits, not a new production policy. One failed probe terminates the experiment; do not retry or increase deadlines.

After installation readiness, use a disposable worktree/report directory and existing exact-worktree admission/custody. Prepare a tiny one-state Quint fixture and identified artifacts before input observation. Select one unused ephemeral port, launch identified Java/JAR once, and inspect `/proc` socket-inode ownership to reject a bind race or ambient responder. Confirm the listener address and that the owned process identity still matches. Readiness performs one bounded gRPC reflection operation after the owned socket appears, without command execution or fallback launch. Direct one real `quint verify` obligation to `127.0.0.1:port`, with fallback suppression active; assert the child connects to the owned server and no second JVM server appears. Terminate only the recorded owned process/group, prove absence using existing custody, and retain timing/output/terminal evidence. The owned server and child checking both consume the same 30-second experiment allowance.

Before that real probe, controlled fixtures should prove failed readiness/endpoint mismatch cannot spawn/download; an unrelated ambient listener remains untouched; ownership mismatch rejects launch qualification; and shutdown failure prevents success. Scenario mapping: S9 → `uses and terminates only the identified owned server`; S10/S13 → readiness/ownership/termination failure and unresolved-custody fixtures; S1 → real fixture result plus stopped-server/child evidence. These are proposed tests, not claimed passing results.

Assessment: fallback suppression and an adapter over existing custody are bounded work. Loopback-only binding, complete native runtime closure/observation, and proving socket ownership are still uncertain prerequisites. Do not silently substitute unique-port routing or executable-version hashing for those requirements.

## One-shot real probe result

After the parent confirmed the bounded frozen installation succeeded and the integration checkout resolved pinned Quint coherently, the proposed experiment ran once. Command:

```sh
SERVER_PROBE_JAVA=/home/node/.local/java/jdk-17.0.18+8-jre/bin/java timeout --signal=TERM --kill-after=7s 40s node scripts/with-gate-slot.mjs -- node .scratch/formal-reuse-probes/server-owned/probe.mjs
```

The outer command exited zero. Execution including owned-server shutdown took **4617.552139ms**. Existing admission created run `a168d276-ef6b-4932-9afa-abadce1b1013`. The probe hashed the resolved Java launcher (`5b573fb29319147f5d93edbf44cd95442f54cd5a08ce740006e3bd3ebb5eb7d4`) and prepared Apalache JAR (`4753c0ebb2cbb266e2c6ac19ab5ca3827d726cc80fd1fc5d7c1eeb64736cd60b`) before launching. These two hashes establish this experiment's artifacts; they are not a claim of complete production runtime identity.

The server used process group `1450836`, port `40713`, and owned socket inode `236809859`. `/proc/1450836/fd` proved that the endpoint socket belonged to the launched server. The listener was `tcp6` address `00000000000000000000000000000000:9F09`, confirming wildcard binding. The child explicitly connected to `127.0.0.1:40713` through the pinned private reflection implementation, extracted into a scratch-only VM export. It never called `connect()` and therefore could not enter its automatic download/spawn fallback. It loaded, parsed, typechecked and compiled the tiny one-state fixture, then performed one CHECK. Reflection and CHECK both passed.

Existing custody receipts provide the terminal evidence:

| Boundary | Obligation | Actual result | Group absence |
| --- | --- | --- | --- |
| Tiny fixture reflection/CHECK child | `79e96729-4119-4459-b49f-611f2db2b867` | passed, exit 0 | true |
| Owned server after planned AbortController stop | `a64ef728-8cdc-4c3b-9966-22c3dfe0231a` | cancelled, exit 143 | true |
| Enclosing admitted probe | `8408c80d-051f-41ed-b5da-be5ca80eafea` | passed, exit 0 | true |

The probe additionally proved `kill(-1450836, 0)` returned ESRCH and the selected endpoint had no listener after shutdown. Every original ambient listening-socket record remained present and unchanged. An ambient Apalache protocol responder was not specifically manufactured; this proves existing ambient sockets were untouched, while the explicit ambient-Apalache scenario remains a controlled integration-test obligation. No experiment retry was performed.

Retained evidence: `.scratch/formal-reuse-probes/server-owned/outer.log`, `result.json`, `receipts-summary.json`, `probe.mjs`, `check.cjs`, and `tiny.qnt`; original custody receipts are under the common Git directory's `dalph-gates/runs/a168d276-ef6b-4932-9afa-abadce1b1013/receipts`. Apalache generated its default ignored `_apalache-out/server` diagnostics, retained untouched. No tracked feature file or installed package was edited.

The wildcard listener is a disclosed backend limitation, not an additional network-security requirement invented by this investigation. The approved wording requires an invocation-owned server at a private endpoint but does not explicitly require loopback-only binding. In the supported cooperative local setting, a unique invocation endpoint combined with exact socket/process ownership, explicit child routing, no fallback creation, and proven terminal absence provides a practical interpretation. Do not claim loopback isolation. If a stronger bind-address requirement is imposed, revisit this limitation before adding infrastructure.

The practical implementation cost is now bounded and testable: a small pinned client patch suppresses fallback under runner-owned transport metadata and exposes bounded readiness with closed clients; a short runner sequence starts `runBoundedCommand` without awaiting it, observes its exact owned socket, races readiness/checking against unexpected server settlement, records planned stop, aborts, then awaits and validates the existing cancelled receipt. The successful outer helper exit proves descendants stopped before publication. Preserve cancelled as a distinct server disposition; never convert it into a generic passed checker receipt. Controlled fixtures still need to prove bind races, unexpected exit, failed readiness, fallback prohibition, and incomplete shutdown reject success. Complete effective runtime observation remains the separate input-seam requirement.
