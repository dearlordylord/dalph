# Coding-agent control planes: second-pass market scan

**Research date:** 2026-07-30
**Scope:** A deliberately broader second pass over coding-agent control planes,
including incumbent code hosts, tracker vendors, commercial agent fleets, and
tools that do not describe themselves as orchestrators. This is research only
and changes no Dalph runtime behavior.

## Revised conclusion

The first scan found the right niche competitors but underweighted the most
dangerous category: products that already own an authoritative boundary.
GitHub and GitLab own repository, PR, CI, permission, and merge facts. Linear
and Atlassian own task state, assignment, and dependency facts. They do not
need to reproduce Dalph's architecture to absorb its user-facing job.

The strongest findings are:

1. **OpenAI Symphony is now the closest source-visible shape match.** Its
   specification describes a long-running service that polls a tracker,
   filters dependency-blocked issues, dispatches bounded concurrent Codex
   sessions into deterministic per-issue workspaces, reconciles tracker state,
   retries failures, stops ineligible work, and exposes runtime status
   ([specification](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md)).
   The current Elixir implementation includes Linear, GitHub, Jira, Asana, and
   GitLab adapters and explicitly remains evaluation-grade prototype software
   ([implementation README](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/README.md)).
2. **GitHub is the largest platform threat.** Agent HQ presents a fleet
   mission-control layer over multiple coding agents, while the enterprise
   Agent Control Plane adds policy, audit, MCP allowlists, and session
   visibility. GitHub already owns the surrounding issue, branch, PR, Actions,
   review, and merge surfaces
   ([Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/),
   [enterprise control plane](https://github.blog/changelog/2026-02-26-enterprise-ai-controls-agent-control-plane-now-generally-available/)).
3. **GitLab is the closest incumbent implementation threat.** Duo Agent
   Platform can turn an issue into a draft merge request, iterate on feedback,
   resolve conflicts, and run through GitLab CI. Its foundational flows also
   cover CI repair, review, security review, and vulnerability remediation
   ([Developer Flow](https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/developer/),
   [foundational flows](https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/)).
   The checked-out GitLab source contains flow catalogs, project consumers,
   workflow permissions, audit-event processing, triggers, pipeline-backed
   execution, and persisted workflow/session associations; this is more than a
   marketing shell.
4. **Linear and Atlassian are plausible tracker-native control planes.**
   Linear delegates an issue to an agent without replacing the human assignee,
   ties a coding session to that issue, and supports diff/PR review, rebase,
   lint, feedback, and merge from Linear
   ([coding sessions](https://linear.app/docs/coding-sessions),
   [delegation](https://linear.app/docs/assigning-issues)).
   Rovo Dev plans work, runs parallel background tasks, reviews against Jira
   acceptance criteria, and creates draft PRs from Jira work items
   ([Rovo Dev](https://www.atlassian.com/software/rovo-dev),
   [Jira issue-to-code](https://support.atlassian.com/jira-software-cloud/docs/generate-code-from-a-work-item-in-jira/)).
5. **Factory and Devin are the closest commercial fleet experiences.**
   Factory Missions decomposes multi-day goals into worker sessions with Git
   handoffs, validation, repair, and recovery
   ([Missions](https://factory.ai/news/missions)). Devin's coordinator launches
   child sessions in isolated VMs, monitors and messages them, and compiles the
   result ([Managed Devins](https://docs.devin.ai/work-with-devin/advanced-capabilities)).

## Competitive tiers

| Tier | Products | Why they matter |
|---|---|---|
| Authority-platform threats | **GitHub**, **GitLab**, **Linear**, **Atlassian Rovo** | They already own Git or tracker facts and can add dispatch around those facts. |
| Direct delivery-control competitors | **Symphony**, **HerdOS**, Factory Missions, Devin, Cursor Automations, Replit Agent, OpenHands, Kiro | They mechanically select, dispatch, isolate, observe, and often recover multiple coding tasks. |
| Executor or narrow-domain controllers | Codex cloud, Jules, Amp, Amazon Q, Junie, Sentry Seer | They provide strong asynchronous execution or control one authoritative event class, but not the whole delivery frontier. |
| Cockpits and specialist niches | Kandev, Paperclip, Coder, Chartr, Superset, Orca, Overstory, Agent Orchestrator, Gas Town, Beads, Sandcastle, Hive, Multica | They can win adjacent operator, governance, environment, or coordination needs without implementing Dalph's complete correctness contract. |

This tiering is about strategic pressure, not a simple feature count. GitHub can
be a more serious competitor than a feature-closer startup because it can make
its control plane the default place where work is assigned and merged.

## The newly important middle

Several products were too substantial to classify as mere agent launchers:

- Cursor Automations can trigger background agents from GitHub, Linear, Slack,
  PagerDuty, schedules, and webhooks, and now supports multi-repository
  automations
  ([automations](https://cursor.com/changelog/03-05-26),
  [multi-repo](https://cursor.com/changelog/05-20-26)).
- Replit's Task System decomposes work onto a task board, uses isolated copies,
  queues beyond a bounded concurrency limit, exposes logs/tests/previews, and
  applies or dismisses results with conflict assistance
  ([task system](https://docs.replit.com/core-concepts/agent/task-system)).
- OpenHands explicitly markets an Enterprise Agent Control Plane for policy,
  cost, audit, deployment, and workflow governance. Its emphasis is the generic
  agent platform rather than Git-delivery convergence
  ([control-plane framing](https://www.openhands.dev/blog/agent-control-plane),
  [enterprise product](https://www.openhands.dev/blog/openhands-enterprise-agent-control-plane)).
- Kiro autonomous mode plans against acceptance criteria, delegates to
  subagents, works in isolated sandboxes, and follows PR feedback. Its GitHub
  documentation also reveals an important missing claim primitive: assigning
  the same issue from multiple users creates separate tasks, and users are told
  to coordinate manually
  ([GitHub integration](https://kiro.dev/docs/web/github/),
  [autonomous mode](https://kiro.dev/docs/web/autonomous-mode/)).
- Sentry Seer owns a narrower but strategically valuable boundary: an observed
  production issue. It can assess actionability, produce a patch/PR, and expose
  an asynchronous issue-fix API with step state and retry
  ([Seer](https://docs.sentry.io/product/ai-in-sentry/seer),
  [API](https://docs.sentry.io/api/seer/start-seer-issue-fix/)).

## What still appears distinct in Dalph

No reviewed product documents the full conjunction below:

- the external tracker remains authoritative for task identity, lifecycle,
  dependencies, grouping, and claims;
- Git remains authoritative for lineage, with one exact worktree and immutable
  planned Base SHA per task attempt;
- dispatch consumes explicit, bounded resource positions while integration
  resources remain separate and serialized;
- ambiguity-crossing effects record intent first, observe afterward, and
  reconcile before retry;
- integration advances from an accepted head rather than letting independent
  workers race to merge;
- cleanup is exact, disposition-typed, recoverable, and fail-closed;
- tracker, Git, execution substrate, and workflow journal facts are not copied
  into a second authority database.

Symphony intersects most strongly with the first three visible behaviors, but
its own draft specification says exact in-memory scheduler state is not
restored, ticket writes are normally delegated to the agent prompt/tools, and
it is not a multi-tenant control plane. It does not prescribe Dalph's planned
Base SHA, intent/observation journal, accepted-head integration, or typed
cleanup protocol. HerdOS remains stronger around a GitHub-native task DAG,
review-head locking, tier integration, and monitor-driven recovery; see the
[initial scan](./control-plane-competitors-2026-07.md).

## Strategic read

The market is converging from four directions:

1. code hosts are adding fleets, policy, audit, and merge;
2. trackers are adding delegated issue-to-PR sessions;
3. agent vendors are adding hierarchical dispatch and long-running missions;
4. open-source schedulers are adding polling, dependency filtering, bounded
   workers, reconciliation, and worktree isolation.

Dalph should therefore avoid positioning as merely “run many coding agents.”
That surface is already crowded. Its defensible claim is a correctness-oriented
delivery coordinator that preserves existing system authorities and makes
claiming, Git lineage, retries after ambiguous outcomes, serialized
integration, and cleanup explicit and testable.

## Evidence limits

The 28 source-visible candidates are pinned in
[`.references/COMPETITORS.md`](../.references/COMPETITORS.md). Closed products
were evaluated from official documentation and release announcements. Those
sources establish advertised and documented behavior, but they do not prove
internal implementation, crash semantics, or correctness under races.

This note supplements the
[initial control-plane scan](./control-plane-competitors-2026-07.md) and the
[Chartr source comparison](./chartr-source-comparison.md).
