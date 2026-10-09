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
            return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
              () => this.${name}Unlocked(change, entry));
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
          return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
            () => this.placeUnlocked(change, sha, entry, fetched, local));
        }
        async placeUnlocked(change, sha, entry, fetched, local) {`
        )
      } else if (file.endsWith('/pusher.js')) {
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
          'await this.state.setJournal(null);\n        }));'
        )
      } else return null
      return { code: helper + code, map: null }
    },
  }
}
