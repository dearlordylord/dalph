#!/usr/bin/env python3
"""THROWAWAY #439: real Git lineage; controlled admission/recovery, not Dalph runtime."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ENV = {**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
       'GIT_AUTHOR_DATE': '2026-10-05T00:00:00Z', 'GIT_COMMITTER_DATE': '2026-10-05T00:00:00Z'}
ROWS = []

class Refusal(Exception):
    pass

class World:
    def __init__(self, root, arm):
        self.root, self.arm = root, arm
        self.repo = root / 'repository'
        self.repo.mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Dalph Experiment')
        self.git('config', 'user.email', 'experiment@example.invalid')
        (self.repo / 'README.md').write_text('base\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'H0')
        self.h0 = self.git('rev-parse', 'HEAD')
        self.git('update-ref', 'refs/heads/integration', self.h0)
        self.ledger_path = root / 'PROTOTYPE-plan-ledger.json'
        self.plans = {}
        self.proofs = {}
        self.selected_reads = 0
        self.repairs = 0
        self.created_worktrees = 0

    def git(self, *args, cwd=None, check=True, input=None):
        p = subprocess.run(['git', *args], cwd=cwd or self.repo, env=ENV,
                           input=input, text=True, capture_output=True, timeout=10)
        if check and p.returncode:
            raise Refusal(f'Git boundary refused: {args[0]} (exit {p.returncode})')
        return p.stdout.strip() if check else p

    def head(self):
        return self.git('rev-parse', '--verify', 'refs/heads/integration^{commit}')

    def ancestor(self, older, newer):
        return self.git('merge-base', '--is-ancestor', older, newer, check=False).returncode == 0

    def advance(self, label, changes):
        worktree = self.root / f'external-{label}'
        self.git('worktree', 'add', '-q', '--detach', str(worktree), self.head())
        for file, text in changes.items():
            (worktree / file).write_text(text)
        self.git('add', '.', cwd=worktree)
        self.git('commit', '-qm', label, cwd=worktree)
        candidate = self.git('rev-parse', 'HEAD', cwd=worktree)
        self.git('update-ref', 'refs/heads/integration', candidate, self.head())
        return candidate

    def qualify(self, required=(), run='run-1', fault=None):
        # These tracker/admission guards are controlled hypotheses, NOT production proof.
        if fault in ('changed-specification', 'changed-prerequisites', 'foreign-claim'):
            raise Refusal(f'Controlled tracker guard: {fault}')
        if fault == 'unreadable-target':
            self.git('--git-dir=' + str(self.root / 'missing-git-dir'), 'rev-parse', 'HEAD')
        observed = self.head()
        self.selected_reads += 1
        if not self.ancestor(self.h0, observed):
            raise Refusal('Qualified target diverges from configured H0')
        for task in required:
            proof = self.proofs.get((run, task))
            if proof is None or not self.ancestor(proof, observed):
                raise Refusal('Controlled per-Run prerequisite proof missing or not in head')
        return observed

    def save(self):
        self.ledger_path.write_text(json.dumps(self.plans, sort_keys=True))

    def reopen(self):
        self.plans = json.loads(self.ledger_path.read_text())

    def plan(self, task, required=(), run='run-1', replacement=None, fault=None, acknowledged=True):
        key = f'{run}/{task}'
        if key in self.plans:
            return self.plans[key]
        head = self.qualify(required, run, fault)
        base = replacement if replacement is not None else self.h0 if self.arm == 'fixed' else head
        self.git('cat-file', '-e', base + '^{commit}')
        plan = {'identity': key, 'base': base, 'selectionHead': head, 'acknowledged': acknowledged,
                'worktree': str(self.root / ('task-' + key.replace('/', '-')))}
        self.plans[key] = plan
        self.save()
        return plan

    def acknowledge(self, plan):
        plan['acknowledged'] = True
        self.save()

    def prepare(self, plan):
        path = Path(plan['worktree'])
        if not path.exists():
            self.git('worktree', 'add', '-q', '--detach', str(path), plan['base'])
            self.created_worktrees += 1
        return path

    def execute(self, plan, required_files=(), changes=None):
        path = self.prepare(plan)
        initial_head = self.git('rev-parse', 'HEAD', cwd=path)
        available = all((path / file).exists() for file in required_files)
        repair = 0
        if not available:
            self.git('merge', '--ff-only', self.head(), cwd=path)
            repair = 1
            self.repairs += 1
        if not all((path / file).exists() for file in required_files):
            raise Refusal('Deterministic workload still lacks required API after explicit repair')
        for file, text in (changes or {plan['identity'].replace('/', '-') + '.txt': 'implemented\n'}).items():
            (path / file).write_text(text)
        self.git('add', '.', cwd=path)
        self.git('commit', '-qm', plan['identity'], cwd=path)
        candidate = self.git('rev-parse', 'HEAD', cwd=path)
        return {'initialHead': initial_head, 'prerequisiteInitiallyPresent': available,
                'repairMerges': repair, 'candidate': candidate,
                'candidateDescendsFromBase': self.ancestor(plan['base'], candidate)}

    def integrate(self, candidate):
        old = self.head()
        merge = self.git('merge-tree', '--write-tree', old, candidate, check=False)
        if merge.returncode != 0:
            return {'integration': 'Conflict', 'headUnchanged': self.head() == old}
        tree = merge.stdout.splitlines()[0]
        integrated = self.git('commit-tree', tree, '-p', old, '-p', candidate, input='integrated\n')
        self.git('update-ref', 'refs/heads/integration', integrated, old)
        return {'integration': 'Applied', 'integrated': integrated, 'parents': [old, candidate]}

    def deliver(self, task, changes, required=(), required_files=(), run='run-1'):
        plan = self.plan(task, required, run)
        result = self.execute(plan, required_files, changes)
        result.update(self.integrate(result['candidate']))
        if result['integration'] == 'Applied':
            self.proofs[(run, task)] = result['integrated']
        return plan, result

    def row(self, case, plan=None, **facts):
        ROWS.append({'case': case, 'arm': self.arm, 'H0': self.h0, 'head': self.head(),
                     'base': None if plan is None else plan['base'], 'selectionHead': None if plan is None else plan['selectionHead'],
                     'selectionReads': self.selected_reads, 'createdWorktrees': self.created_worktrees,
                     'repairMergesTotal': self.repairs, **facts})


def run_case(root, arm, case):
    w = World(root, arm)
    if case == '1-sequential':
        w.deliver('A', {'api.txt': 'A API\n'})
        plan, result = w.deliver('B', {'b.txt': 'B uses A\n'}, ('A',), ('api.txt',))
        w.row(case, plan, **result, finalTree=w.git('rev-parse', w.head() + '^{tree}'))
    elif case == '2-parallel':
        early = w.plan('early')
        w.deliver('A', {'api.txt': 'A API\n'})
        late = w.plan('late')
        first = w.execute(early)
        first.update(w.integrate(first['candidate']))
        second = w.execute(late)
        second.update(w.integrate(second['candidate']))
        w.row(case, late, earlyBase=early['base'], earlyResult=first['integration'], lateResult=second['integration'])
    elif case == '2-shared-file':
        w.advance('A', {'README.md': 'base\nA\n'})
        plan = w.plan('late-independent')
        path = w.prepare(plan)
        text = (path / 'README.md').read_text() + 'B\n'
        result = w.execute(plan, changes={'README.md': text})
        result.update(w.integrate(result['candidate']))
        w.row(case, plan, **result)
    elif case == '3-diamond':
        w.deliver('A', {'api.txt': 'A API\n'})
        b, c = w.plan('B', ('A',)), w.plan('C', ('A',))
        for task, plan in [('B', b), ('C', c)]:
            result = w.execute(plan, ('api.txt',), {task.lower() + '.txt': task + '\n'})
            integrated = w.integrate(result['candidate'])
            assert integrated['integration'] == 'Applied'
            w.proofs[('run-1', task)] = integrated['integrated']
        d, result = w.deliver('D', {'d.txt': 'D uses B C\n'}, ('B', 'C'), ('b.txt', 'c.txt'))
        w.row(case, d, **result, finalTree=w.git('rev-parse', w.head() + '^{tree}'))
    elif case == '4-unrelated':
        unrelated = w.advance('unrelated', {'unrelated.txt': 'external compatible\n'})
        plan = w.plan('B')
        path = w.prepare(plan)
        result = w.execute(plan)
        result.update(w.integrate(result['candidate']))
        w.row(case, plan, unrelatedInitiallyPresent=(path / 'unrelated.txt').exists(), includedUnrelatedAncestor=w.ancestor(unrelated, plan['base']), **result)
    elif case.startswith('5-'):
        fault = case[2:]
        if fault == 'missing-target':
            w.git('update-ref', '-d', 'refs/heads/integration')
        elif fault == 'divergent-target':
            tree = w.git('rev-parse', w.h0 + '^{tree}')
            unrelated = w.git('commit-tree', tree, input='foreign root\n')
            w.git('update-ref', 'refs/heads/integration', unrelated)
        before = len(w.plans)
        try:
            w.plan('B', fault=fault)
            raise AssertionError('Expected admission refusal')
        except Refusal as error:
            ROWS.append({'case': case, 'arm': arm, 'outcome': 'Refused', 'reason': str(error), 'plansAdded': len(w.plans)-before, 'createdWorktrees': w.created_worktrees})
    elif case.startswith('6-'):
        h1 = w.advance('H1', {'one.txt': 'one\n'})
        if case == '6-before-selection':
            h2 = w.advance('H2', {'two.txt': 'two\n'})
            plan = w.plan('B')
        else:
            plan = w.plan('B', acknowledged=case != '6-before-ack')
            h2 = w.advance('H2', {'two.txt': 'two\n'})
            w.acknowledge(plan)
        path = w.prepare(plan)
        w.row(case, plan, H1=h1, H2=h2, preparedHead=w.git('rev-parse', 'HEAD', cwd=path), frozen=plan['base'] == w.git('rev-parse', 'HEAD', cwd=path))
    elif case.startswith('7-'):
        w.advance('H1', {'one.txt': 'one\n'})
        if case == '7-before-intent':
            old_observation = w.qualify()
            w.advance('H2', {'two.txt': 'two\n'})
            plan = w.plan('B')
            recovery = 'No retained plan; one fresh selection after simulated crash'
        else:
            plan = w.plan('B', acknowledged=case == '7-after-ack')
            frozen = json.dumps(plan, sort_keys=True)
            w.advance('H2', {'two.txt': 'two\n'})
            w.reopen()
            plan = w.plan('B')
            assert json.dumps(plan, sort_keys=True) == frozen
            w.acknowledge(plan)
            recovery = 'Prototype ledger retained exact selection; not production Journal proof'
        first = w.prepare(plan)
        second = w.prepare(w.plan('B'))
        assert first == second and w.created_worktrees == 1
        w.row(case, plan, recovery=recovery, duplicateWorktrees=0, runtimeBeginCalls='Not exercised')
    elif case == '8-retained-attempt':
        w.advance('H1', {'one.txt': 'one\n'})
        plan = w.plan('active')
        path = w.prepare(plan)
        frozen = json.dumps(plan, sort_keys=True)
        w.advance('H2', {'two.txt': 'two\n'})
        for state in ('executing', 'suspended', 'recovered'):
            w.reopen()
            same = w.plan('active')
            assert json.dumps(same, sort_keys=True) == frozen
            assert w.git('rev-parse', 'HEAD', cwd=path) == plan['base']
        later = w.plan('later')
        w.row(case, plan, laterBase=later['base'], retainedStates=['executing', 'suspended', 'recovered'], note='States are controlled labels, not native executor recovery')
    elif case == '9-explicit-replacement':
        old = w.plan('old')
        frozen = json.dumps(old, sort_keys=True)
        h1 = w.advance('H1', {'one.txt': 'one\n'})
        replacement = w.plan('explicit-successor', replacement=h1)
        assert json.dumps(old, sort_keys=True) == frozen
        w.row(case, replacement, oldBase=old['base'], oldUnchanged=True, authorization='Controlled supplied Base; #428 production authorization not reimplemented')
    elif case == '10-multiple-runs':
        # External code in global head is insufficient for this Run's prerequisite evidence.
        foreign = w.advance('other-run-A', {'api.txt': 'A API\n'})
        w.proofs[('other-run', 'A')] = foreign
        try:
            w.plan('B', ('A',))
            raise AssertionError('Foreign Run proof admitted dependant')
        except Refusal as error:
            w.row(case, foreignCodePresent=True, refusedWithoutOwnRunProof=True, reason=str(error))
        w.proofs[('run-1', 'A')] = foreign  # explicit controlled observation, not inference from Git
        plan = w.plan('B', ('A',))
        w.row(case + '-authorized-observation', plan, ownRunProofExplicit=True)
    else:
        raise AssertionError(case)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--source-revision', required=True)
    parser.add_argument('--deadline-utc', required=True)
    args = parser.parse_args()
    deadline = __import__('datetime').datetime.fromisoformat(args.deadline_utc.replace('Z', '+00:00')).timestamp()
    cases = ['1-sequential', '2-parallel', '2-shared-file', '3-diamond', '4-unrelated',
             *['5-' + x for x in ['missing-target', 'divergent-target', 'unreadable-target', 'changed-specification', 'changed-prerequisites', 'foreign-claim']],
             '6-before-selection', '6-before-ack', '6-before-preparation', '7-before-intent', '7-after-intent', '7-after-ack',
             '8-retained-attempt', '9-explicit-replacement', '10-multiple-runs']
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='dalph-439-experiment-') as root:
        for case in cases:
            for arm in ('fixed', 'current'):
                if time.time() >= deadline:
                    raise RuntimeError('Experiment wall-clock deadline reached; no further case')
                run_case(Path(root) / case / arm, arm, case)
        for case in ('1-sequential', '3-diamond'):
            pair = [r for r in ROWS if r['case'] == case]
            assert pair[0]['finalTree'] == pair[1]['finalTree'], 'Arms produced different final workload trees'
        document = {'sourceRevision': args.source_revision, 'harness': 'THROWAWAY; real Git, controlled tracker and prototype ledger',
                    'deadlineUtc': args.deadline_utc, 'elapsedSeconds': time.monotonic()-start, 'cases': cases, 'observations': ROWS,
                    'notQualified': ['Production current-head admission', 'Real tracker guards', 'Dalph Journal crash recovery', 'Native executor Begin/restart', 'Concurrent uncooperative external processes']}
        Path(args.output).write_text(json.dumps(document, indent=2) + '\n')
        print(json.dumps({'pairedCases': len(cases), 'observations': len(ROWS), 'elapsedSeconds': document['elapsedSeconds'], 'output': args.output}))

if __name__ == '__main__':
    main()
