# Symphony C0 experiment result

**Status:** blocked in preflight; C0 was not run
**Scenario:** stop before claim
**Pinned revision:** `f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`
**Experiment ID:** `97dbf5f6-9f28-4ae8-ae99-0956dfbb7eb8`
**Recorded:** 2026-07-30T20:47:47.792Z

The harness did not start Symphony and did not inject a fault. The credential-free child
environment was constructed, the pinned source was copied through `git archive` into the
owned temporary root, and the harmless exact-PID signal canary was validated. The hard gate
failed on the proofs listed below; this record does not infer a cause beyond their captured
command output and check details.

## Outcomes

- **In-BEAM Orchestrator reset:** not run. No Orchestrator PID existed, so no
  `Process.exit(pid, :kill)` call was made.
- **Whole-BEAM restart:** not run. No BEAM PID existed, so no external kill was sent.
- **Crash injected:** no.
- **Result classification:** blocker/execution record only; this is not a unit test
  represented as crash recovery.

## Blocking proofs

- elixir-runtime: missing: elixir, mix
- network-isolation: unshare canary failed with exit 1; unshare: unshare failed: Operation not permitted
- resource-limits: hard CPU, memory, PID, disk, and elapsed-time containment cannot be proven; cgroup v2 is not writable
- idle-in-beam-orchestrator-canary: not attempted because the complete preflight gate did not pass; no Symphony process was started
- idle-whole-beam-restart-canary: not attempted because the complete preflight gate did not pass; no BEAM start, kill, restart, or snapshot action was attempted
- offline-dependency-proof: not attempted because the complete preflight gate did not pass; offline mode remained enforced and no package registry was contacted
- checkout-cleanliness: required proof missing
- fixed-link-resolution: required proof missing
- fake-protocol: required proof missing
- fixture-bootstrap: required proof missing
- otp-isolation: required proof missing
- teardown-negative-canary: required proof missing
- outside-root-mutation-proof: required proof missing

Exact command arguments, output hashes, timestamps, process ownership, and preflight checks
are recorded beside this file. No external service or package registry was contacted.
