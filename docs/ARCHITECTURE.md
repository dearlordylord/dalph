# Ralph Tooling Architecture

This document owns stable architecture for Dalph repository tooling. It does
not own a target repository's rules, product runtime, authored content, or
application architecture.

Canonical boundary terminology lives in [CONTEXT.md](CONTEXT.md).

## Historical-Harness Boundary

The Ralph orchestrator is a clean tooling system. `scripts/ralph-run.sh` is a
one-off historical execution harness, not its architecture, compatibility
baseline, migration source, fallback scheduler, or runtime substrate. The
historical harness may supply candidate tooling requirements, failure evidence,
and design lessons. A candidate becomes an accepted tooling requirement only
when an owning decision or implementation specification explicitly accepts it.

The Ralph orchestrator must not invoke, wrap, resume, migrate, or preserve
behavioral parity with the historical harness. Historical plan indexes, shell
stages, claims, run directories, prompts, retained runs, and cleanup
conventions remain evidence outside the Ralph orchestrator's managed namespace.
Tracker claims, journal runs, attempts, sessions, evidence, and recovery state
are allocated and owned only through the orchestrator's typed ports.

## Documentation Authority

| Document or system                                                                 | Tooling authority                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Ralph tooling context](CONTEXT.md)                                                | Canonical boundary terminology and the tooling/main-application distinction      |
| This document                                                                      | Stable Ralph tooling structure and ownership boundaries                          |
| Accepted implementation specification                                              | Executable Ralph requirements and acceptance                                     |
| Canonical issue tracker                                                            | Work identity, accepted planning decisions, and dependency state                 |
| [`research/`](../research/)                                                        | Historical investigation and decision evidence after accepted facts are promoted |
| Historical `ralph-run.sh` sources in their origin repository                      | Historical harness behavior only                                                 |

A target repository's architecture, ubiquitous language, and modeling
assumptions are not Dalph architecture owners.
