# Symphony C0 preflight harness

This research-only harness prepares the smallest safe Symphony experiment:
C0 (stop before claim), separately for an in-BEAM Orchestrator reset and a
whole-BEAM restart. It does not change Dalph runtime behavior and never edits
the pinned source checkout.

The current implementation is deliberately fail-closed. It creates an owned
temporary root, copies the exact pinned source revision with `git archive`,
constructs a credential-free allowlisted environment, probes private-network
and resource containment, validates a harmless exact-PID signal canary, and
writes a complete blocker record when any proof fails. It does not start
Symphony or inject either C0 fault unless every preflight proof passes.

Run from the repository root:

```sh
research/experiments/harnesses/symphony/run.sh
```

An expected preflight blocker exits with status 2 and writes a new immutable
bundle under `research/experiments/results/`. Status 1 is a harness failure.
The bundle distinguishes the two C0 outcomes, records whether Symphony ever
started or a crash was injected, inventories every child process, stores exact
command arguments/timestamps/output hashes, and hashes every evidence file.

This first increment does not contain an armed Symphony fault driver. That is
intentional: the host must first pass and independently review all idle
canaries, including the in-BEAM name/PID seam, before executable fault logic is
added. A passing-looking result cannot be manufactured by bypassing a failed
gate.
