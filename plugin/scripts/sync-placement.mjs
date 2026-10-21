/**
 * Plugin-only integration at the SDK core's placement boundaries. Installed bytes remain
 * unchanged. Fail closed on changed upstream boundaries; tests and the production bundle
 * use the same transform. These plugin integration hooks are not exported by the SDK.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const input = read(join(pluginRoot, 'scripts/sync-sdk-inputs.json'))
const pinnedVersion = input.version
const pinnedFiles = input.files
const digest = (code) => createHash('sha256').update(code).digest('hex')
const marker = '// abele-sync-placement-v1:'

function boundaryError(id, before, count, expected = '1') {
  return new Error(
    `Unsupported sync placement boundary in ${id}: ${JSON.stringify(before.slice(0, 100))}; found ${count}, expected ${expected}`
  )
}
function replaceBoundary(code, before, after, id) {
  const count = code.split(before).length - 1
  if (count !== 1) throw boundaryError(id, before, count)
  return code.replace(before, after)
}
const helper = `
async function coordinatePlacement(fs, paths, work, preserve = true) {
  const run = fs[Symbol.for('abele.sync.placement-v1')];
  return run ? run.call(fs, paths, work, preserve) : work();
}
async function* inventoryDirectories(fs) {
  const read = fs[Symbol.for('abele.sync.inventory-directories-v1')];
  if (read) yield* await read.call(fs, true);
  else yield* fs.listDirectories();
}
async function inventoryChildren(fs, parent, path) {
  const read = fs[Symbol.for('abele.sync.inventory-children-v1')];
  return read ? read.call(fs, parent, path) : fs.listChildren(parent);
}
`
export function syncPlacementPlugin() {
  return {
    name: 'abele-sync-placement',
    enforce: 'pre',
    transform(input, id) {
      const file = id.split('?')[0]
      if (!file.includes('/node_modules/@abele/sync-sdk/dist/internal/core/')) return null
      const packageRoot = file.slice(0, file.lastIndexOf('/dist/'))
      const installed = read(join(packageRoot, 'package.json'))
      if (installed.name !== '@abele/sync-sdk' || installed.version !== pinnedVersion)
        throw new Error(
          `installed @abele/sync-sdk ${installed.version} does not match the pinned ${pinnedVersion}; run npm ci (${id})`
        )
      const relative = file.slice(packageRoot.length + 1)
      if (!pinnedFiles[relative] || digest(readFileSync(file)) !== pinnedFiles[relative])
        throw new Error(`Installed @abele/sync-sdk/core integrity mismatch in ${id}; run npm ci`)
      if (input.startsWith(marker)) {
        const end = input.indexOf('\n')
        const body = input.slice(end + 1)
        if (end < 0 || input.slice(marker.length, end) !== `${relative}:${digest(body)}`)
          throw new Error(`Invalid sync placement marker in ${id}`)
        return { code: input, map: null }
      }
      const replaceOnce = (code, before, after) => replaceBoundary(code, before, after, id)
      let code = input
      if (file.endsWith('/cycle.js')) {
        code = replaceOnce(
          code,
          'this.scanFilter = opts.client.reportSizeRefusals ? localFilter : this.filter;',
          `const scanFilter = opts.client.reportSizeRefusals ? localFilter : this.filter;
          this.scanFilter = {
            excluded: (path, size) => scanFilter.excluded(path, size) ||
              opts.fs[Symbol.for('abele.sync.upload-owner-v1')]?.(path) === false,
          };`
        )
        code = replaceOnce(
          code,
          'async cycle() {',
          `async cycle() {
          const pass = this.ctx.opts.fs[Symbol.for('abele.sync.inventory-pass-v1')];
          const state = this.ctx.opts.state;
          const metadataPass = state[Symbol.for('abele.sync.normalization-pass-v1')];
          const run = () => metadataPass ? metadataPass.call(state, () => this.cycleUnlocked()) : this.cycleUnlocked();
          return pass ? pass.call(this.ctx.opts.fs, run) : run();
        }
        async cycleUnlocked() {`
        )
      } else if (file.endsWith('/pullRun.js')) {
        code = replaceOnce(code, 'const MANIFEST_PAGE = 1000;', 'const MANIFEST_PAGE = 5000;')
        code = replaceOnce(
          code,
          'seen.add(sha);',
          `const candidate = await this.placer.localSource(sha, change.size, local);
            if (candidate) { local.set(sha, candidate); continue; }
            seen.add(sha);`
        )
        code = replaceOnce(
          code,
          'async prefetch(changes, local) {',
          `async prefetch(changes, local) {
          if (this.fs.beginAtomicWrite && this.fs.reopenStage && this.client.openVersion) {
            const wanted = [];
            for (const change of changes) {
              if (change.sha === null || change.op === 'delete' || change.size === null ||
                  change.size > this.placer.budget.maxChunkBytes || this.passedOver(change)) continue;
              const entry = await this.state.byFileId(change.file_id);
              if (entry?.versionId === change.version_id || entry?.sha === change.sha ||
                  this.isDirty(change, entry)) continue;
              if (local.has(change.sha)) continue;
              // A missing receipt does not mean missing bytes. Let placement verify and adopt
              // an existing portable spelling before spending a content request on it.
              if (entry === null) {
                const inventory = await this.placer.paths(change.path);
                if (inventory.blocked(change.path)) continue;
                let target;
                try { target = inventory.resolve(change.path, 'file'); }
                catch { continue; }
                if (await this.fs.stat(target) !== null) continue;
              }
              if (await this.placer.localSource(change.sha, change.size, local)) continue;
              wanted.push(change);
            }
            const fetched = new Map();
            const prefetched = fetched[Symbol.for('abele.sync.prefetched-files-v1')] = new Set();
            // pool drains active workers after a failure; no source outlives the run.
            await pool(wanted, 8, async (change) => {
                const source = await this.client.openVersion(change.file_id, change.version_id,
                  { sha: change.sha, size: change.size });
                try {
                  source.signal?.throwIfAborted();
                  if (source.size !== change.size) throw new Error('invalid placement source size');
                  const bytes = change.size === 0 ? new Uint8Array() :
                    await source.read(0, change.size, source.signal);
                  await source.assertUnchanged();
                  if (bytes.length !== change.size || bytes.buffer.byteLength > 1024 * 1024 ||
                      await this.hash(bytes) !== change.sha) this.placer.disbelieve(change.sha);
                  else {
                    fetched.set(change.sha, bytes);
                    prefetched.add(change.file_id);
                  }
                } finally { await source.close(); }
            });
            return fetched;
          }`
        )
      } else if (file.endsWith('/scanner.js')) {
        code = replaceOnce(
          code,
          'const fingerprint = await fingerprintFile(fs, info.path, hash);',
          `const fresh = fs[Symbol.for('abele.sync.fingerprint-fresh-v1')];
            const fingerprint = fresh && (revalidate.has(wirePath) || opts.verifyPaths?.has(wirePath))
              ? await fresh.call(fs, info.path) : await fingerprintFile(fs, info.path, hash);`
        )
      } else if (file.endsWith('/localPaths.js')) {
        code = replaceOnce(
          code,
          'for await (const dir of fs.listDirectories())',
          'for await (const dir of inventoryDirectories(fs))'
        )
        code = replaceOnce(
          code,
          'await fs.listChildren(parent)',
          'await inventoryChildren(fs, parent, path)'
        )
      } else if (file.endsWith('/pullPlace.js')) {
        code = `import { receiveToStage as receivePlacementSource } from './streaming.js';\n` + code
        code = replaceOnce(
          code,
          'const state = await this.clear(target, from, change, sha);',
          `const state = await this.clear(target, from, change, sha,
            entry === null && from === null && firstTarget === null ? null : undefined);`
        )
        code = replaceOnce(
          code,
          'async clear(target, from, change, sha) {',
          'async clear(target, from, change, sha, knownAbsent) {'
        )
        code = replaceOnce(
          code,
          'const there = await this.fs.stat(target);',
          'const there = knownAbsent === null ? null : await this.fs.stat(target);'
        )
        code = replaceOnce(
          code,
          'if (!sameStat(beforeTarget, await this.fs.stat(target)))',
          `// A new target is checked after durable intent below, then published exclusively.
        const checkedTarget = entry === null && from === null && firstTarget === null && beforeTarget === null
          ? null : await this.fs.stat(target);
        if (!sameStat(beforeTarget, checkedTarget))`
        )
        code = replaceOnce(
          code,
          'const have = await this.fs.stat(target);',
          `const have = entry === null && from === null ? checkedTarget : await this.fs.stat(target);`
        )
        if (!code.includes('fingerprintFile(this.fs,'))
          throw boundaryError(id, 'fingerprintFile(this.fs,', 0, 'at least 1')
        code = code.replaceAll('fingerprintFile(this.fs,', 'fingerprintPlacementFile(this.fs,')
        code = replaceOnce(
          code,
          'settledStat(this.fs, target, sha, wrote, this.hash)',
          'settledPlacementStat(this.fs, target, sha, wrote, this.hash)'
        )
        code += `
        async function fingerprintPlacementFile(fs, path, hash) {
          const bounded = fs[Symbol.for('abele.sync.fingerprint-pull-v1')];
          return bounded ? bounded.call(fs, path) : fingerprintFile(fs, path, hash);
        }
        async function settledPlacementStat(fs, path, sha, wrote, hash) {
          const receipt = await fs[Symbol.for('abele.sync.written-stat-v1')]?.(path, wrote);
          if (receipt) return receipt;
          return settledStat({
            stat: (path) => fs.stat(path),
            fingerprint: (path) => fingerprintPlacementFile(fs, path, hash),
          }, path, sha, wrote, hash);
        }
        `
        code = replaceOnce(
          code,
          'const notWritten = async () => {',
          `// A still-owned private stage must finish through recovery, not be orphaned by adoption.
        if (pending.stageId !== undefined && this.fs[Symbol.for('abele.sync.recover-published-pull-v1')] &&
            await this.fs.stat(pending.stageId) !== null) return false;
        const notWritten = async () => {`
        )
        code = replaceOnce(
          code,
          'if (pending.stageId !== undefined)\n                return false;',
          `if (pending.stageId !== undefined || this.fs[Symbol.for('abele.sync.recover-published-pull-v1')])
                return false;`
        )
        code = replaceOnce(
          code,
          'if (pending?.stageId && this.fs.reopenStage && this.client.openVersion) {',
          'if (pending && this.fs.reopenStage && this.client.openVersion && change.size !== null) {'
        )
        code = replaceOnce(
          code,
          'const base = beforeTarget !== null',
          `
        const recoverPublished = this.fs[Symbol.for('abele.sync.recover-published-pull-v1')];
        if (pending && from !== null && beforeFrom !== null && caseKey(from) !== caseKey(target)) {
          this.opts.log?.('pull: holding ' + target + ': move source may have been recreated; interrupted intent cannot relocate it');
          return false;
        }
        const recovery = pending && recoverPublished
          ? await recoverPublished.call(this.fs, pending.stageId ?? null, target, change.mtime ?? 0, from) : null;
        if (recovery) {
          await this.pending.prepare(change, entry, target, from, recovery.id);
          try {
            const source = await this.client.openVersion(change.file_id, change.version_id, identity);
            await downloadToStage(source, recovery, identity, this.budget, undefined, async () => {
              if (!sameStat(beforeTarget, await this.fs.stat(target)) ||
                  !sameStat(beforeFrom, from === null ? null : await this.fs.stat(from)))
                throw new Error('pull target changed during recovery transfer');
              if (from !== null && beforeFrom !== null) await this.fs.move(from, target);
              this.opts.expected.expect(target, sha);
            });
            await this.remember(change, sha, target, { size: identity.size, mtime: change.mtime ?? 0 }, from);
            await recovery.discard();
            return true;
          } catch (error) {
            this.opts.expected.clear(target);
            throw error;
          }
        }
        const base = beforeTarget !== null`
        )
        code = replaceOnce(
          code,
          'await this.fs.reopenStage(pending.stageId)',
          `await (this.fs[Symbol.for('abele.sync.reopen-pull-stage-v1')]
            ? this.fs[Symbol.for('abele.sync.reopen-pull-stage-v1')](pending.stageId)
            : this.fs.reopenStage(pending.stageId))`
        )
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
          const observe = this.fs[Symbol.for('abele.sync.trace-pull-v1')];
          if (!observe) return this.placeObserved(change, sha, entry, fetched, local);
          const prefetched = fetched[Symbol.for('abele.sync.prefetched-files-v1')]?.has(change.file_id);
          const finish = observe.call(this.fs, change.size, change.path, prefetched ? 1 : 0);
          let complete = false;
          try {
            const result = await this.placeObserved(change, sha, entry, fetched, local);
            complete = result === true;
            return result;
          } finally { finish(complete); }
        }
        async localSource(sha, size, local) {
          const verify = async (path) => {
            try {
              const have = await fingerprintPlacementFile(this.fs, path, this.hash);
              return have.sha === sha && have.size === size ? { path } : null;
            } catch { return null; }
          };
          const known = local.get(sha);
          if (known) {
            const match = await verify(known.path);
            if (match) return match;
          }
          // Uncommitted first-upload files are absent from the ledger. Index sizes once,
          // then hash each possible source at most once in this puller, retaining only
          // identities. This avoids a whole-vault rehash for every incoming file.
          if (!this.localSizes) {
            this.localSizes = new Map();
            this.localHashes = new Map();
            for await (const file of this.fs.list()) {
              if (this.opts.filter.excluded(file.path)) continue;
              const paths = this.localSizes.get(file.size) ?? [];
              paths.push(file.path);
              this.localSizes.set(file.size, paths);
            }
          }
          for (const path of this.localHashes.get(sha) ?? []) {
            const match = await verify(path);
            if (match) return match;
          }
          const paths = this.localSizes.get(size) ?? [];
          while (paths.length) {
            const path = paths.pop();
            try {
              const have = await fingerprintPlacementFile(this.fs, path, this.hash);
              const copies = this.localHashes.get(have.sha) ?? [];
              copies.push(path);
              this.localHashes.set(have.sha, copies);
              if (have.sha === sha && have.size === size) return { path };
            } catch { /* An unreadable local candidate grants no placement authority. */ }
          }
          return null;
        }
        async placeObserved(change, sha, entry, fetched, local) {
          // An own commit may precede its local receipt. Verify and adopt existing bytes before
          // fetching them again, without settling an interrupted pull's retained write intent.
          if ((entry === null || entry.sha === sha && entry.wirePath === change.path) &&
              await this.pending.read(change.file_id) === null &&
              await this.adoptExisting(change, entry)) return true;
          // Downloads do not own paths. The original placer revalidates the source after waiting.
          // Keep the network source bounded and fetch it only once. The core's durable target
          // stage and local-edit checks still run under the placement lease.
          if (this.fs.beginAtomicWrite && this.fs.reopenStage && this.fs.openRead &&
              this.client.openVersion && change.size !== null) {
            const identity = { sha, size: change.size };
            const placeFrom = async (open, smallBytes) => {
              const prepared = Object.create(this);
              if (smallBytes && (entry === null || entry.size <= this.budget.maxChunkBytes)) prepared.fs = new Proxy(this.fs, {
                get: (target, key) => key === 'beginAtomicWrite' ? undefined
                  : typeof target[key] === 'function' ? target[key].bind(target) : target[key],
              });
              prepared.client = new Proxy(this.client, {
                get: (target, key) => key === 'openVersion'
                  ? open
                  : typeof target[key] === 'function' ? target[key].bind(target) : target[key],
              });
              return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
                () => prepared.placeUnlocked(change, sha, entry,
                  smallBytes ? new Map(fetched).set(sha, smallBytes) : fetched, local));
            };
            // The content index is only a hint: verify the current file, then keep using a
            // bounded local source with the same mutation checks as an HTTP source.
            const candidate = await this.localSource(sha, change.size, local);
            if (candidate) {
              let verified = false;
              try {
                const have = await fingerprintPlacementFile(this.fs, candidate.path, this.hash);
                verified = have.sha === sha && have.size === change.size;
              } catch { /* A removed or changed candidate falls back to the server. */ }
              if (verified) {
                if (change.size <= this.budget.maxChunkBytes) {
                  const bytes = await this.fs.read(candidate.path);
                  if (bytes.length === change.size && await this.hash(bytes) === sha)
                    return placeFrom(() => this.fs.openRead(candidate.path), bytes);
                } else return placeFrom(() => this.fs.openRead(candidate.path));
              }
            }
            // Small pulls fit in one transfer chunk. Avoid a second journal, copy and file
            // read per note, while still verifying the network source outside the lease.
            if (change.size <= this.budget.maxChunkBytes) {
              let bytes = fetched.get(sha), signal;
              if (!bytes) await this.budget.run(async () => {
                const source = await this.client.openVersion(change.file_id, change.version_id, identity);
                signal = source.signal;
                try {
                  signal?.throwIfAborted();
                  if (source.size !== change.size) throw new Error('invalid placement source size');
                  bytes = change.size === 0 ? new Uint8Array() : await source.read(0, change.size, signal);
                  await source.assertUnchanged();
                  const hashing = Date.now();
                  const valid = bytes.length === change.size && bytes.buffer.byteLength <= this.budget.maxChunkBytes &&
                      await this.hash(bytes) === sha;
                  this.fs[Symbol.for('abele.sync.diagnostic-v1')]?.('pull hash', hashing, valid ? 'complete' : 'failed');
                  if (!valid) throw new Error('placement source integrity mismatch');
                } finally { await source.close(); }
              });
              // close() disposes the HTTP source by aborting its private signal. The
              // verified local bytes no longer belong to that transport lifetime.
              return placeFrom(async () => ({
                size: bytes.length,
                read: async (offset, length) => bytes.slice(offset, offset + length),
                assertUnchanged: async () => {}, close: async () => {},
              }), bytes);
            }
            // Some hosts can append bounded chunks but cannot read a large local stage.
            // Use the core's direct network-to-target stream there, never a whole-file read.
            const replay = this.fs[Symbol.for('abele.sync.replay-stage-v1')];
            if (replay && !await replay.call(this.fs))
              return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
                () => this.placeUnlocked(change, sha, entry, fetched, local));
            const stagingFs = this.fs[Symbol.for('abele.sync.private-placement-stages-v1')] ?? this.fs;
            const sourceStage = await stagingFs.beginAtomicWrite(
              '.abele-sync/placement-inbox/' + crypto.randomUUID(), 0, null);
            const useSource = async () => { try {
              const source = await this.client.openVersion(change.file_id, change.version_id, identity);
              await receivePlacementSource(source, sourceStage, identity, this.budget);
              return await placeFrom(() => stagingFs.openRead(sourceStage.id));
            } finally {
              await sourceStage.discard();
            } };
            const retainSource = this.fs[Symbol.for('abele.sync.live-source-stage-v1')];
            return retainSource ? retainSource.call(this.fs, sourceStage.id, useSource) : useSource();
          }
          // A matching ledger hash does not prove that its local file still exists.
          // Populate even the fallback's cache before leasing either path.
          if (!fetched.has(sha)) {
            const candidate = await this.localSource(sha, change.size, local);
            if (candidate) local = new Map(local).set(sha, candidate);
            const bytes = await this.bytesOf(sha, fetched, local);
            if (!bytes) return false;
            fetched = new Map(fetched).set(sha, bytes);
          }
          return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
            () => this.placeUnlocked(change, sha, entry, fetched, local));
        }
        async placeUnlocked(change, sha, entry, fetched, local) {`
        )
      } else if (file.endsWith('/pullRecovery.js')) {
        code = replaceOnce(
          code,
          'await placer.adopt(change, entry);',
          `// A pending move cannot identify a recreated source. Preserve that path as an
        // independent local file; only an absent destination permits a fresh installation.
        if (client?.openVersion && fs[Symbol.for('abele.sync.recover-published-pull-v1')] &&
            entry !== null && intent.from === entry.path && normalisePath(intent.target) === change.path &&
            intent.from.normalize('NFC').toLowerCase() !== intent.target.normalize('NFC').toLowerCase()) {
            const separated = await coordinatePlacement(fs, [intent.from, intent.target], async () => {
                if (await fs.stat(intent.from) === null || await fs.stat(intent.target) !== null) return false;
                await state.transaction(async () => {
                    const occupant = await state.get(intent.target);
                    if (occupant !== null && occupant.fileId !== fileId)
                        throw new ExternalStateError('recovery-required');
                    if (await state.getMeta(\`pull-write:\${fileId}\`) !== raw ||
                        await placer.pending.matching(change, await state.byFileId(fileId)) === null)
                        throw new ExternalStateError('recovery-required');
                    const detached = { ...entry, path: intent.target, wirePath: intent.wirePath };
                    await state.delete(intent.from);
                    await state.put(detached);
                    await state.setMeta(\`pull-write:\${fileId}\`, JSON.stringify({ ...intent, from: null, base: detached }));
                });
                console.debug('[abele-sync] pull recovery', 'preserved independent move source; recovering into absent destination');
                return true;
            }, false);
            if (separated) {
                await recoverPendingPullWrites(fs, state, [fileId], client);
                continue;
            }
        }
        await placer.adopt(change, entry);`
        )
        code = replaceOnce(
          code,
          '{ expected: new ExpectedWrites(), dirty: new Set(), filter: { excluded: () => false } }',
          `{ expected: new ExpectedWrites(), dirty: new Set(), filter: { excluded: () => false },
             log: (line) => console.debug('[abele-sync] pull recovery', line) }`
        )
        code = replaceOnce(
          code,
          'if (intent.stageId !== undefined && (await state.getMeta?.(`pull-write:${fileId}`)) != null) {',
          `if ((intent.stageId !== undefined || fs[Symbol.for('abele.sync.recover-published-pull-v1')]) &&
              (await state.getMeta?.(\`pull-write:\${fileId}\`)) != null) {`
        )
      } else if (file.endsWith('/pushSources.js')) {
        code = replaceOnce(
          code,
          'return await fs.openRead(path);',
          `const upload = fs[Symbol.for('abele.sync.open-upload-v1')];
          return await (upload ? upload.call(fs, path) : fs.openRead(path));`
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
          'for await (const dir of this.fs.listDirectories())',
          'for await (const dir of inventoryDirectories(this.fs))'
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
          return coordinatePlacement(this.fs, [item.path, ...(previous ? [previous.localPath ?? previous.path] : [])], () => this.receiveUnlocked(item), false);
        }
        async receiveUnlocked(item) {`
        )
        code = replaceOnce(
          code,
          'await this.fs.removeDirectory(path, removal.identity);',
          'await coordinatePlacement(this.fs, [path], () => this.fs.removeDirectory(path, removal.identity));'
        )
      } else if (file.endsWith('/v2Client.js')) {
        // Multipart parts are private until complete. Hash that pass, including already
        // received parts on resume, rather than reading the entire source once more first.
        code = replaceOnce(
          code,
          'const first = incrementalSha256.create();',
          `if (expected.size <= Math.min(maxChunkBytes, this.http.simpleUploadBytes)) {
            const first = incrementalSha256.create();`
        )
        code = replaceOnce(
          code,
          'const path = `/v2/uploads/${expected.sha}`;',
          '}\n            const path = `/v2/uploads/${expected.sha}`;'
        )
        code = replaceOnce(
          code,
          `this.departed.delete(item.path);
        if (this.ports)
            await this.ports.state.setMeta('v2-departures', JSON.stringify([...this.departed]));`,
          `if (this.departed.delete(item.path) && this.ports) {
            if (this.manifestDepartures) this.manifestDepartures.changed = true;
            else await this.ports.state.setMeta('v2-departures', JSON.stringify([...this.departed]));
          }`
        )
        code = replaceOnce(
          code,
          `for (const item of page.items) {
            const file = await this.fileItem(item, page.cursor);
            if (file)
                items.push(file);
        }`,
          `const departures = this.manifestDepartures = { changed: false };
        try {
          for (const item of page.items) {
            const file = await this.fileItem(item, page.cursor);
            if (file) items.push(file);
          }
        } finally {
          this.manifestDepartures = null;
          if (departures.changed && this.ports)
            await this.ports.state.setMeta('v2-departures', JSON.stringify([...this.departed]));
        }`
        )
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
      const body = helper + code
      return { code: `${marker}${relative}:${digest(body)}\n${body}`, map: null }
    },
  }
}
