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
async function coordinatePlacement(fs, paths, work, preserve = true) {
  const run = fs[Symbol.for('abele.sync.placement-v1')];
  return run ? run(paths, work, preserve) : work();
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
        code = `import { receiveToStage as receivePlacementSource } from './streaming.js';\n` + code
        for (const name of ['adopt', 'adoptExisting']) {
          code = replaceOnce(
            code,
            `async ${name}(change, entry) {`,
            `async ${name}(change, entry) {
            // Adoption verifies existing bytes and records metadata; it never overwrites files.
            return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
              () => this.${name}Unlocked(change, entry), false);
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
          // Keep the network source bounded and fetch it only once. The core's durable target
          // stage and local-edit checks still run under the placement lease.
          if (this.fs.beginAtomicWrite && this.fs.reopenStage && this.fs.openRead &&
              this.client.openVersion && change.size !== null) {
            const identity = { sha, size: change.size };
            const stagingFs = this.fs[Symbol.for('abele.sync.private-placement-stages-v1')] ?? this.fs;
            const sourceStage = await stagingFs.beginAtomicWrite(
              '.abele-sync/placement-inbox/' + crypto.randomUUID(), 0, null);
            try {
              const source = await this.client.openVersion(change.file_id, change.version_id, identity);
              await receivePlacementSource(source, sourceStage, identity, this.budget);
              const prepared = Object.create(this);
              prepared.client = new Proxy(this.client, {
                get: (target, key) => key === 'openVersion'
                  ? () => stagingFs.openRead(sourceStage.id)
                  : typeof target[key] === 'function' ? target[key].bind(target) : target[key],
              });
              return await coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
                () => prepared.placeUnlocked(change, sha, entry, fetched, local));
            } finally {
              await sourceStage.discard();
            }
          }
          // A matching ledger hash does not prove that its local file still exists.
          // Populate even the fallback's cache before leasing either path.
          if (!fetched.has(sha)) {
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
          'await this.planner.fetchRun(run, verdicts);',
          'await loadRun(run);'
        )
        code = replaceOnce(
          code,
          'const verdicts = await this.planner.plan(sending, results);',
          `const verdicts = await this.planner.plan(sending, results);
        const stagedDownloads = new Map();
        const stagingFs = this.recorder.fs[Symbol.for('abele.sync.private-placement-stages-v1')] ?? this.recorder.fs;
        const stagingRoot = '.abele-sync/placement-outbox/' + await sha256(new TextEncoder().encode(key));
        const stage = async (sha, bytes) => {
          if (!bytes || await this.hash(bytes) !== sha) throw new EngineError('protocol', 'placement download integrity mismatch');
          const path = stagingRoot + '/' + sha;
          await stagingFs.writeAtomic(path, bytes, 0);
          stagedDownloads.set(sha, path);
        };
        for (const [index, run] of verdicts.runs.entries()) {
          if (index > 0) await this.planner.fetchRun(run, verdicts);
          for (const [sha, bytes] of verdicts.fetched) await stage(sha, bytes);
        }
        const readStaged = async (sha) => {
          const path = stagedDownloads.get(sha);
          if (!path) return null;
          const bytes = await stagingFs.read(path);
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
`
        )
        code = replaceOnce(
          code,
          'await this.state.transaction(async () => {',
          `const placementPaths = [], preservationPaths = [];
        for (const [at, op] of sending.entries()) {
          const paths = [];
          if (op.op === 'create') paths.push(op.path);
          else { const old = await this.state.byFileId(op.file_id); if (old) paths.push(old.path); }
          if (op.op === 'move') paths.push(op.to_path);
          const result = results[at];
          let mutates = true;
          if (result.status === 'rejected') mutates = op.op === 'move';
          else {
            paths.push(result.path);
            if (result.status === 'conflict') paths.push(result.conflict_path);
            // An unchanged acknowledgement records metadata. It cannot overwrite local bytes.
            if (result.status === 'applied' && op.op === 'delete') mutates = false;
            else if (result.status === 'applied' && 'sha' in op && result.sha === op.sha) {
              const previous = await this.state.byFileId(result.file_id);
              const target = await this.recorder.disk.targetOf(result.path, result.file_id);
              if (previous === null || previous.path === target) mutates = false;
            }
          }
          placementPaths.push(...paths);
          if (mutates) preservationPaths.push(...paths);
        }
        await coordinatePlacement(this.recorder.fs, placementPaths, () => this.state.transaction(async () => {`
        )
        code = replaceOnce(
          code,
          'await this.state.setJournal(null);\n        });',
          'await this.state.setJournal(null);\n        }), preservationPaths);\n        for (const path of stagedDownloads.values()) await stagingFs.remove(path);'
        )
      } else if (file.endsWith('/v2Directories.js')) {
        code = replaceOnce(
          code,
          `const local = [];
        for await (const dir of this.fs.listDirectories())
            local.push(dir);
        const identity = local.find((d) => d.path === item.path).identity;`,
          `const identify = this.fs[Symbol.for('abele.sync.directory-identity-v1')];
        let identity;
        if (identify) identity = await identify(item.path);
        else {
          for await (const dir of this.fs.listDirectories())
            if (dir.path === item.path) { identity = dir.identity; break; }
          if (!identity) throw new Error('Received directory identity is unavailable');
        }`
        )
        code = replaceOnce(
          code,
          'const op = moved\n',
          `// A recursive server delete must not bypass the ordinary file delete guard.
            // Settle tracked children (or hold/restore them) before deleting their parent.
            if (!moved) {
              let children = false;
              for await (const entry of this.state.all()) {
                if ((entry.wirePath ?? entry.path).startsWith(old.path + '/')) { children = true; break; }
              }
              if (children) continue;
            }
            const op = moved\n`
        )
        code = replaceOnce(
          code,
          'async receive(item) {',
          `async receive(item) {
          if (!this.includes(item.path)) return;
          const previous = (await this.read()).directories.find(one => one.file_id === item.file_id);
          // mkdir refuses an occupied file and never rewrites descendants. Keep the lease,
          // but do not recursively archive a directory that this receipt cannot overwrite.
          return coordinatePlacement(this.fs, [item.path, ...(previous ? [previous.path] : [])], () => this.receiveUnlocked(item), false);
        }
        async receiveUnlocked(item) {`
        )
        code = replaceOnce(
          code,
          'await this.fs.removeDirectory(path);',
          'await coordinatePlacement(this.fs, [path], () => this.fs.removeDirectory(path));'
        )
      } else if (file.endsWith('/v2Client.js')) {
        code = replaceOnce(
          code,
          "if (event.type === 'removal') {",
          "if (event.type === 'removal') { await coordinatePlacement(this.ports.fs, [event.path], async () => {"
        )
        code = replaceOnce(
          code,
          'continue;\n                }\n                if (!entry)',
          '}); continue;\n                }\n                if (!entry)'
        )
      } else return null
      return { code: helper + code, map: null }
    },
  }
}
