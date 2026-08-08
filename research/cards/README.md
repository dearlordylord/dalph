# Competitor reliability architecture cards

Each card is a pinned-source audit of one open-source control plane. Cards
describe the product in its own terms before comparing it with Dalph.

Required sections:

1. scope, pin, and evidence boundary;
2. plain-language architecture;
3. state-owner table;
4. scheduling and capacity;
5. restoration layers:
   - control-plane task/run;
   - agent session, context, and logs;
   - committed, staged, unstaged, untracked, ignored, conflicted, and stashed
     worktree state;
   - live process/container/VM state;
6. immediate restart;
7. restart after a week and external drift;
8. Git starting-point and integration behavior;
9. code organization by layers and end-to-end slices;
10. production/test/fake/dry-run dependency seams;
11. verification inventory;
12. chronological failure table;
13. maintenance risks;
14. ideas Dalph should consider;
15. confirmed unknowns and negative-claim search record;
16. technical and user-visible consequences.

Every factual claim uses a fixed-commit source link. Product documentation is
not enough when reachable source or tests can establish the behavior.

Cards do not edit the shared [research index](../README.md), the
[reference index](../../.references/COMPETITORS.md), or the cross-product
comparison. The main research thread owns synthesis.

## Card index

| Product | Source audit | Fault experiment |
|---|---|---|
| [Gas Town + Beads](./gastown-beads-reliability-architecture.md) | Complete | Not run |
| [HerdOS](./herdos-reliability-architecture.md) | Complete | Not run |
| [OpenAI Symphony / Elixir OTP](./symphony-otp-reliability-architecture.md) | Complete | Not run |
| [Paperclip](./paperclip-reliability-architecture.md) | Complete | Not run |
| [Agent Kanban](./agent-kanban-reliability-architecture.md) | Complete | Not run |
| [Any Managed Agents](./any-managed-agents-reliability-architecture.md) | Complete | Not run |
| [AIF Handoff](./aif-handoff-reliability-architecture.md) | Complete | Not run |
| [Kandev](./kandev-reliability-architecture.md) | Complete | Not run |
| [Warren](./warren-reliability-architecture.md) | Complete | Not run |
| [Burrow](./burrow-reliability-architecture.md) | Complete | Not run |
