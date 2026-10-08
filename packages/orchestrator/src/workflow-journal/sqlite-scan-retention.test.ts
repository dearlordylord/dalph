/* eslint-disable import/no-nodejs-modules -- A child exposes GC only to observe completed native scan ownership. */
import { execFileSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

it("retains repeated payload strings once without merging distinct scanned Runs", () => {
  const moduleUrl = new URL("../../dist/src/index.js", import.meta.url)
  const publicationUrl = new URL("../../dist/test/support/direct-publication.js", import.meta.url)
  const code = `
    import { mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Effect } from 'effect';
    import { RunId } from '@dalph/contracts';
    import { JournalStore } from ${JSON.stringify(new URL("workflow-journal/store.js", moduleUrl).href)};
    import { sqliteJournalTestLayer } from ${JSON.stringify(new URL("workflow-journal/adapters/sqlite-store.js", moduleUrl).href)};
    import { JournalDatabaseLocator } from ${JSON.stringify(new URL("workflow-journal/identity.js", moduleUrl).href)};
    import { FixtureTarget } from ${JSON.stringify(new URL("authorities/task-tracker/fixture/target.js", moduleUrl).href)};
    import { InitialControlPolicy } from ${JSON.stringify(new URL("control/policy.js", moduleUrl).href)};
    import { TaskWorkCapacity } from ${JSON.stringify(new URL("coordination/admission/capacity.js", moduleUrl).href)};
    import { remotePublicationTargetForTest } from ${JSON.stringify(publicationUrl.href)};
    const count = 128;
    const target = FixtureTarget.make('repeated-payload-' + 'x'.repeat(256 * 1024));
    const directory = mkdtempSync(join(tmpdir(), 'dalph-payload-retention-'));
    const filename = JournalDatabaseLocator.make(join(directory, 'journal.sqlite'));
    const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) });
    try {
      await Effect.runPromise(Effect.gen(function* () {
        const store = yield* JournalStore;
        for (let index = 0; index < count; index++)
          yield* store.beginRun(RunId.make('payload-retention-' + index), target, policy, remotePublicationTargetForTest);
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename }))));
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
      const before = process.memoryUsage().heapUsed;
      const result = await Effect.runPromise(Effect.gen(function* () {
        const store = yield* JournalStore;
        const scan = yield* store.scanHot();
        if (scan.issues.length !== 0 || scan.runs.length !== count ||
            new Set(scan.runs.map(run => run.runId)).size !== count ||
            scan.runs.some(run => run.records.length !== 1 || run.records[0].event.target !== target))
          throw new Error('Expected every distinct Run and its unchanged payload');
        yield* Effect.promise(() => new Promise(resolve => setImmediate(resolve)));
        global.gc();
        return { runs: scan.runs.length, retainedGrowthBytes: process.memoryUsage().heapUsed - before };
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename }))));
      process.stdout.write(JSON.stringify(result));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  `
  const result = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "--eval", code], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf8",
    timeout: 10000
  })
  const observed: { readonly runs: number; readonly retainedGrowthBytes: number } = JSON.parse(result)
  const maximumRetainedGrowthBytes = 16 * 1024 * 1024
  expect(observed.runs).toBe(128)
  expect(observed.retainedGrowthBytes).toBeLessThan(maximumRetainedGrowthBytes)
}, 15000)

it.each(["scanHot", "auditAll"])("releases completed %s history while its SQLite store stays open", (operation) => {
  const moduleUrl = new URL("../../dist/src/index.js", import.meta.url)
  const publicationUrl = new URL("../../dist/test/support/direct-publication.js", import.meta.url)
  const code = `
    import { Effect } from 'effect';
    import { RunId } from '@dalph/contracts';
    import { JournalStore } from ${JSON.stringify(new URL("workflow-journal/store.js", moduleUrl).href)};
    import { sqliteJournalTestLayer } from ${JSON.stringify(new URL("workflow-journal/adapters/sqlite-store.js", moduleUrl).href)};
    import { JournalDatabaseLocator } from ${JSON.stringify(new URL("workflow-journal/identity.js", moduleUrl).href)};
    import { FixtureTarget } from ${JSON.stringify(new URL("authorities/task-tracker/fixture/target.js", moduleUrl).href)};
    import { InitialControlPolicy } from ${JSON.stringify(new URL("control/policy.js", moduleUrl).href)};
    import { TaskWorkCapacity } from ${JSON.stringify(new URL("coordination/admission/capacity.js", moduleUrl).href)};
    import { remotePublicationTargetForTest } from ${JSON.stringify(publicationUrl.href)};
    const scanWeakly = (store) => Effect.gen(function* () {
      const scan = yield* store[${JSON.stringify(operation)}]();
      if (scan.issues.length !== 0 || scan.runs.length !== 1 || scan.runs[0].records.length !== 1)
        throw new Error('Expected one complete persisted Run beginning');
      return [new WeakRef(scan), new WeakRef(scan.runs[0].records), new WeakRef(scan.runs[0].records[0].event)];
    });
    const retained = await Effect.runPromise(Effect.gen(function* () {
      const store = yield* JournalStore;
      yield* store.beginRun(RunId.make('scan-retention'), FixtureTarget.make('scan-retention-target'),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }), remotePublicationTargetForTest);
      const references = yield* scanWeakly(store);
      yield* Effect.promise(() => new Promise(resolve => setImmediate(resolve)));
      global.gc();
      return references.map(reference => reference.deref() !== undefined);
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(':memory:') }))));
    process.stdout.write(JSON.stringify(retained));
  `
  const result = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "--eval", code], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf8",
    timeout: 5000
  })
  expect(JSON.parse(result)).toEqual([false, false, false])
})

it("releases the first reopened read array while retaining the current SQLite checkpoint", () => {
  const moduleUrl = new URL("../../dist/src/index.js", import.meta.url)
  const publicationUrl = new URL("../../dist/test/support/direct-publication.js", import.meta.url)
  const code = `
    import { mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Effect } from 'effect';
    import { RunId } from '@dalph/contracts';
    import { JournalStore } from ${JSON.stringify(new URL("workflow-journal/store.js", moduleUrl).href)};
    import { sqliteJournalTestLayer } from ${JSON.stringify(new URL("workflow-journal/adapters/sqlite-store.js", moduleUrl).href)};
    import { JournalDatabaseLocator, JournalRecordKey } from ${JSON.stringify(new URL("workflow-journal/identity.js", moduleUrl).href)};
    import { FixtureTarget } from ${JSON.stringify(new URL("authorities/task-tracker/fixture/target.js", moduleUrl).href)};
    import { InitialControlPolicy } from ${JSON.stringify(new URL("control/policy.js", moduleUrl).href)};
    import { TaskWorkCapacity } from ${JSON.stringify(new URL("coordination/admission/capacity.js", moduleUrl).href)};
    import { OperationId } from ${JSON.stringify(new URL("workflow/identity.js", moduleUrl).href)};
    import { WorkflowOperation } from ${JSON.stringify(new URL("workflow/registry/operation.js", moduleUrl).href)};
    import { taskTrackerReadIntent } from ${JSON.stringify(new URL("workflow/registry/event.js", moduleUrl).href)};
    import { remotePublicationTargetForTest } from ${JSON.stringify(publicationUrl.href)};
    const readWeakly = (store, runId) => Effect.gen(function* () {
      const records = yield* store.read(runId);
      if (records.length !== 1) throw new Error('Expected one cold Run beginning');
      return [new WeakRef(records), new WeakRef(records[0])];
    });
    const root = mkdtempSync(join(tmpdir(), 'dalph-cold-read-retention-'));
    const filename = JournalDatabaseLocator.make(join(root, 'journal.sqlite'));
    const runId = RunId.make('cold-read-retention');
    const target = FixtureTarget.make('cold-read-retention-target');
    await Effect.runPromise(Effect.gen(function* () {
      const store = yield* JournalStore;
      yield* store.beginRun(runId, target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }), remotePublicationTargetForTest);
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename }))));
    const retained = await Effect.runPromise(Effect.gen(function* () {
      const store = yield* JournalStore;
      const references = yield* readWeakly(store, runId);
      yield* store.append(runId, JournalRecordKey.make('successor'), taskTrackerReadIntent(
        WorkflowOperation.cases.ReadTrackerGraph.make({ cause: { _tag: 'WorkflowEstablishment' },
          operationId: OperationId.make('successor'), predecessorOperationIds: [],
          readShape: { _tag: 'CompleteTargetClosure', explicitlyCoveredTaskIds: [] }, target })));
      const current = yield* store.read(runId);
      if (current.length !== 2 || current[0].event._tag !== 'WorkflowRunBegan')
        throw new Error('Current checkpoint lost its original event');
      yield* Effect.promise(() => new Promise(resolve => setImmediate(resolve)));
      global.gc();
      return references.map(reference => reference.deref() !== undefined);
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename }))));
    rmSync(root, { recursive: true, force: true });
    process.stdout.write(JSON.stringify(retained));
  `
  const result = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "--eval", code], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf8",
    timeout: 5000
  })
  expect(JSON.parse(result)).toEqual([false, false])
})
