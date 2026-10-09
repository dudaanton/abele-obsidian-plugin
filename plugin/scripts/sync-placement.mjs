/**
 * Plugin-only integration at the pinned core's placement boundaries. Archive bytes and
 * provenance remain unchanged. Fail closed on changed upstream boundaries; tests and the
 * production bundle use the same transform. The core has no placement hook in this pin.
 */
function replaceOnce(code, before, after) {
  if (code.split(before).length !== 2) throw new Error('Unsupported sync placement boundary')
  return code.replace(before, after)
}
const helper = `
async function coordinatePlacement(fs, paths, work) {
  const run = fs[Symbol.for('abele.sync.placement-v1')];
  return run ? run(paths, work) : work();
}
async function withDeliveryBytes(placer, change, work) {
  if (!placer.opts.onPersonalNoteApplied || change.kind !== 'note' || !change.sha) return work();
  const bytes = await placer.client.getBlob(change.sha);
  const cache = placer.placementDelivery ??= new Map();
  const held = cache.get(change.sha) ?? { bytes, users: 0 };
  held.users++; cache.set(change.sha, held);
  try { return await work(); }
  finally { if (--held.users === 0) cache.delete(change.sha); }
}
`
export function syncPlacementPlugin() {
  return {
    name: 'abele-sync-placement',
    enforce: 'pre',
    transform(input, id) {
      const file = id.split('?')[0]
      if (!file.includes('/node_modules/@abele/sync-core/dist/')) return null
      let code = input
      if (file.endsWith('/pullPlace.js')) {
        for (const name of ['adopt', 'adoptExisting']) {
          code = replaceOnce(
            code,
            `async ${name}(change, entry) {`,
            `async ${name}(change, entry) {
            return withDeliveryBytes(this, change, () => coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
              () => this.${name}Unlocked(change, entry)));
          }
          async ${name}Unlocked(change, entry) {`
          )
        }
        code = replaceOnce(
          code,
          'async drop(entry) {',
          `async drop(entry) {
          return coordinatePlacement(this.fs, [entry.path], async () => {
            if (await this.edited(entry)) return false;
            return this.dropUnlocked(entry);
          });
        }
        async dropUnlocked(entry) {`
        )
        code = replaceOnce(
          code,
          'async place(change, sha, entry, fetched, local) {',
          `async place(change, sha, entry, fetched, local) {
          // Downloads do not own paths. The original placer revalidates the source after waiting.
          if ((!entry || entry.sha !== sha) && !fetched.has(sha)) {
            const bytes = await this.bytesOf(sha, fetched, local);
            if (!bytes) return false;
            fetched = new Map(fetched).set(sha, bytes);
          }
          return withDeliveryBytes(this, change, () => coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
            () => this.placeUnlocked(change, sha, entry, fetched, local)));
        }
        async placeUnlocked(change, sha, entry, fetched, local) {`
        )
        code = replaceOnce(
          code,
          'const exact = event ? await this.client.getBlob(sha) : null;',
          'const exact = event ? this.placementDelivery?.get(sha)?.bytes ?? null : null;'
        )
      } else if (file.endsWith('/pusher.js')) {
        code = replaceOnce(
          code,
          'await this.planner.fetchRun(run, verdicts);',
          'await loadRun(run);'
        )
        code = replaceOnce(
          code,
          'const verdicts = await this.planner.plan(sending, results);',
          `const verdicts = await this.planner.plan(sending, results);
        const stagedDownloads = new Map();
        const stagingRoot = '.abele-sync/placement-outbox/' + await sha256(new TextEncoder().encode(key));
        const stage = async (sha, bytes) => {
          if (!bytes || await this.hash(bytes) !== sha) throw new EngineError('protocol', 'placement download integrity mismatch');
          const path = stagingRoot + '/' + sha;
          await this.recorder.fs.writeAtomic(path, bytes, 0);
          stagedDownloads.set(sha, path);
        };
        for (const [index, run] of verdicts.runs.entries()) {
          if (index > 0) await this.planner.fetchRun(run, verdicts);
          for (const [sha, bytes] of verdicts.fetched) await stage(sha, bytes);
        }
        if (this.opts.onSettled) for (const result of results) {
          if (result.status !== 'rejected' && result.sha && !stagedDownloads.has(result.sha))
            await stage(result.sha, await this.client.getBlob(result.sha));
        }
        const readStaged = async (sha) => {
          const path = stagedDownloads.get(sha);
          if (!path) return null;
          const bytes = await this.recorder.fs.read(path);
          if (await this.hash(bytes) !== sha) throw new EngineError('protocol', 'staged placement integrity mismatch');
          return bytes;
        };
        const loadRun = async (run) => {
          verdicts.fetched.clear();
          for (const at of run) {
            const sha = verdicts.writes.get(at);
            if (sha && stagedDownloads.has(sha) && !verdicts.fetched.has(sha))
              verdicts.fetched.set(sha, await readStaged(sha));
          }
        };
        await loadRun(verdicts.runs[0] ?? []);
        const placementClient = new Proxy(this.client, { get(target, key) {
          if (key === 'getBlob') return readStaged;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        } });`
        )
        code = replaceOnce(
          code,
          'await settleOwnerUnit(this.client, journal, sending, results, this.opts.onSettled, hookIndices, outcome.body.creation_outcomes);',
          'await settleOwnerUnit(placementClient, journal, sending, results, this.opts.onSettled, hookIndices, outcome.body.creation_outcomes);'
        )
        code = replaceOnce(
          code,
          'await this.state.transaction(async () => {',
          `const placementPaths = [];
        for (const op of sending) {
          if (op.op === 'create') placementPaths.push(op.path);
          else { const old = await this.state.byFileId(op.file_id); if (old) placementPaths.push(old.path); }
          if (op.op === 'move') placementPaths.push(op.to_path);
        }
        for (const result of results) if (result.status !== 'rejected') {
          placementPaths.push(result.path);
          if (result.status === 'conflict') placementPaths.push(result.conflict_path);
        }
        await coordinatePlacement(this.recorder.fs, placementPaths, () => this.state.transaction(async () => {`
        )
        code = replaceOnce(
          code,
          'await this.state.setJournal(null);\n        });',
          'await this.state.setJournal(null);\n        }));\n        for (const path of stagedDownloads.values()) await this.recorder.fs.remove(path);'
        )
      } else return null
      return { code: helper + code, map: null }
    },
  }
}
