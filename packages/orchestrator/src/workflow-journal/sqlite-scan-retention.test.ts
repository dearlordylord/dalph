/* eslint-disable import/no-nodejs-modules -- A child exposes GC only to observe completed native scan ownership. */
import { execFileSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

it.each(["scanHot", "auditAll"])("releases completed %s history while its SQLite store stays open", (operation) => {
  const moduleUrl = new URL("../../dist/src/index.js", import.meta.url)
  const publicationUrl = new URL("../../dist/test/support/direct-publication.js", import.meta.url)
  const code = `
    import { Effect } from 'effect';
    import { RunId } from '@dalph/contracts';
    import { JournalStore, sqliteJournalTestLayer, JournalDatabaseLocator, FixtureTarget, InitialControlPolicy, TaskWorkCapacity } from ${JSON.stringify(moduleUrl.href)};
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
