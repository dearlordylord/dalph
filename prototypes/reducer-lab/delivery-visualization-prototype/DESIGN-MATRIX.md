# Delivery visualization design matrix

This matrix prioritizes independent design questions for the delivery visualization prototype. Each experiment keeps the accepted Position + capacity grammar and fixed capacity slots as the baseline and changes one direction at a time.

The prototype changes no Dalph runtime behavior.

## Priority matrix

| Priority | Direction | Concrete user question | Why it comes here | Prototype decision | Success evidence |
| ---: | --- | --- | --- | --- | --- |
| 1 | Rectangle semantics | What must one rectangle say for its stage to be understood without explanatory prose? | Every later direction depends on a stable information grammar. | Accepted: Position + capacity becomes the new original. | A user can identify the entity, current fact, and relevant position without consulting the graph legend. |
| 2 | Temporal behavior | What changed between adjacent accepted landmarks? | Static content must be correct before motion or transition marks explain its change. | Rejected: step navigation already exposes the state change; added temporal labels duplicate it. | A user can narrate two adjacent frames and identify the changed rectangle. |
| 3 | Frontier and capacity | Which tasks are ordered in the frontier, inside the desired prefix, holding positions, or waiting beyond capacity? | This is the central scheduling relationship and uses the rectangle grammar plus temporal changes. | Accepted: fixed capacity slots become the new original. | A user predicts which task can advance next and why another task waits. |
| 4 | Epistemic state | Which facts are complete, fresh, stale, or awaiting a required read? | Crash, pause, and restart are misleading unless observation status is explicit. | Rejected: no epistemic treatment survived review. | A user distinguishes stale-but-complete facts from current tracker facts. |
| 5 | Code–data–graph mapping | Which exact source stage, rectangles, graph nodes, and dependency edges describe the same fact? | Exact synchronization needs stable rectangle meaning and freshness. | Accepted: incident-edge mapping remains the original. | Selecting any surface produces the same bounded set of related facts. |
| 6 | Crash and recovery causality | What survives a crash, what freezes, and what is reconstructed before new work? | Recovery comprehension depends on epistemic state and exact mapping. | Place crash events only where durable responsibility and visible recovery facts change the outcome. | A user identifies why B and C remain held and why X cannot displace them. |
| 7 | Scale and aggregation | Does the model remain legible with large frontiers and settlement histories? | Aggregation is safe only after individual rectangle semantics are stable. | Test 20–100 tasks, multiple capacities, large settlement totals, and explicit remainder summaries. | No task disappears; every slice has a visible remainder summary. |
| 8 | Attention hierarchy | What deserves attention at the current landmark? | Correct dense data still needs prioritization. | Compare changed facts, stable context, warnings, and control gates without changing semantics. | The primary change is found before stable context is read. |
| 9 | Investigation interaction | How does a user inspect, pin, compare, and clear related facts? | Interaction should operate on proven mappings rather than compensate for unclear data. | Test keyboard traversal, pinned selection, adjacent-frame comparison, and second-click clearing. | The user can inspect a causal chain without losing the current landmark. |
| 10 | Educational progression | In what order should a new user encounter the model? | Progressive disclosure follows a stable expert representation. | Test atomic playback, guided first run, and optional explanations while preserving the expert view. | A new user predicts frontier, capacity, crash, and fresh-read behavior after one run. |

## Gates for every priority

- Accessibility: meaning must survive without color and without motion. Keyboard focus, contrast, short labels, and reduced motion are required evaluation criteria.
- Operational scenarios: each prototype must name the actor, starting facts, trigger, boundary, visible result, forbidden result, and acceptance check.
- Graph integrity: the graph is complete or absent. It can be stale. Partial or ghost nodes are forbidden.
- Frontier integrity: frontier membership is ordered and complete. Sliced presentations include a remainder rectangle.
- Completion: every shared chronology reaches full integration.
- Viability: a landmark remains only when it changes a visible fact, teaches a required boundary, or permits a prediction that the adjacent landmarks do not.

## Shared scenario-to-test mapping

| Scenario landmark | What the prototype must prove |
| --- | --- |
| R41 publishes A | The initial complete graph creates the first visible frontier fact; no task is preselected. |
| R42 releases B and C | Both tasks enter together with visible order and capacity position. |
| B and C are admitted | The frontier is consumed one task at a time and held positions remain bounded. |
| Application crash and restart | The last complete graph remains visible and B/C responsibility survives reconstruction. |
| Alice adds X while the app is down | X does not appear until a complete graph containing X is accepted. |
| Run and task pause cycles | No new forward work starts from pre-unpause facts; fresh reads permit progress. |
| Completion sequence | Settlement totals grow and the final frame shows full integration for every task. |

## Accepted foundation: Priority 1 — rectangle semantics

Position + capacity is the new original. Every current task rectangle shows its entity, ordered position or capacity relationship, and current state.

## Rejected direction: Priority 2 — temporal behavior

Change receipts, Before → now rectangles, and Stability age duplicated differences that are already visible when the user moves between landmarks. No temporal overlay remains.

## Accepted foundation: Priority 3 — frontier and capacity

Fixed capacity slots is the new original. The tickets row always shows both task-work positions, including empty positions, plus the complete remainder after the bound.

## Rejected direction: Priority 4 — epistemic state

Observation envelope, Fresh-read gates, and Authority map did not survive review. No epistemic overlay remains.

## Accepted foundation: Priority 5 — code–data–graph mapping

Incident-edge mapping remains the original. A task selection links matching source rows and rectangles to the selected graph node and its incident dependency edges.

## Active experiment: Priority 6 — crash and recovery causality

The graph structure, accepted rectangle grammar, fixed slots, incident-edge selection, second-click clearing, number-key option selection, user-pause coverage, and full integration remain present in every scenario. Four crash arrangements test distinct durable facts:

1. Original — B and C hold both positions; restart preserves both while X is added during downtime.
2. Between admissions — B is held and C is still desired; restart must not manufacture a C responsibility, and newly observed X remains behind C.
3. During integration intent — B has left task work but has not settled; restart preserves B integration intent and C task work without fabricating finality.
4. During Run Pause — restart preserves the user control boundary and both held positions before Unpause and a fresh read.

### Priority 6 scenario-to-test mapping

| Scenario | Crash acceptance check | Completion acceptance check |
| --- | --- | --- |
| Original | Restart reconstructs exact B and C responsibilities; R43 adds X without displacement. | R48 shows 10/10 settled. |
| Between admissions | Restart reconstructs B only; C remains desired and stays ordered before X. | C is admitted before X; R48 shows 10/10 settled. |
| During integration intent | Restart preserves B integration intent and C responsibility; B is not shown settled before observation. | B settles once; R48 shows 10/10 settled. |
| During Run Pause | Restart preserves Run Pause and both held positions; no new selection starts before Unpause and a fresh read. | Task Pause remains exercised later; R48 shows 10/10 settled. |
