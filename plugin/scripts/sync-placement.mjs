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
// An additive replay needs tracked restore evidence, not discovery of unrelated new files.
// Destructive, restored and review-pending work retains the complete inventory path.
async function additiveReplayEntries(fs, state, scheduling = {}) {
  if (!fs.listChildren || !state.getMeta) return null;
  const journal = await state.getJournal();
  if (!journal?.ops.length || journal.ops.some(op =>
    !['create', 'modify'].includes(op.op) || op.prefer === 'mine')) return null;
  if (await state.getMeta('server-restore-reconciling')) return null;
  const raw = await state.getMeta('content-reconciliation');
  if (raw && JSON.parse(raw).phase !== 'complete') return null;
  const entries = [];
  const work = new ScanWork(scheduling);
  for await (const entry of state.all()) {
    entries.push(entry);
    await work.step();
  }
  return entries;
}
async function pairedBaseline(fs, state, entry) {
  if (!fs.fileIdentity || !state.getMeta) return null;
  const raw = await state.getMeta('paired-file:' + entry.path);
  if (!raw) return null;
  let saved;
  try { saved = JSON.parse(raw); } catch { return null; }
  if (!saved.identity || saved.sha !== entry.sha || saved.size !== entry.size || saved.mtime !== entry.mtime)
    return null;
  const info = await fs.stat(entry.path);
  return info && info.size === saved.size && info.mtime === saved.mtime &&
    await fs.fileIdentity(entry.path) === saved.identity ? saved : null;
}
async function recordPaired(fs, state, path, info, sha, beforeIdentity) {
  if (!beforeIdentity || !state.setMeta) return;
  const after = await fs.stat(path);
  const identity = await fs.fileIdentity?.(path);
  if (identity !== beforeIdentity || !after || after.size !== info.size || after.mtime !== info.mtime) return;
  await state.setMeta('paired-file:' + path, JSON.stringify({ identity, size: info.size, mtime: info.mtime, sha }));
}
async function coordinatePlacement(fs, paths, work, preserve = true) {
  const run = fs[Symbol.for('abele.sync.placement-v1')];
  return run ? run.call(fs, paths, work, preserve) : work();
}
async function* inventoryDirectories(fs) {
  const read = fs[Symbol.for('abele.sync.inventory-directories-v1')];
  if (read) yield* await read.call(fs, true);
  else yield* fs.listDirectories();
}
async function inventoryChildren(fs, parent, path, filesOnly = false) {
  const read = fs[Symbol.for('abele.sync.inventory-children-v1')];
  return read ? read.call(fs, parent, path, filesOnly) : fs.listChildren(parent);
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
          '        await this.scanWork(() => refreshLocalPaths(scanningFs, state, {',
          `        for (const row of this.retries.list()) {
          if (row.phase !== 'push' || row.local || !row.reason.startsWith('too_large:')) continue;
          if (this.unscanned || earlyPull?.bootstrapped || [...this.ctx.watch.reported].some(path =>
              row.path === path || row.path.startsWith(path + '/')))
            await this.retries.succeeded(row.path, 'push');
        }
        const localRevision = fs[Symbol.for('abele.sync.local-scan-revision-v1')]?.();
        const entryRevision = await state[Symbol.for('abele.sync.local-scan-state-revision-v1')]?.();
        const directoryRevision = await state.getMeta?.('v2-directories');
        const waiting = this.retries.list();
        const inspectionAge = this.ctx.now() - this.settledInspectionAt;
        const unchanged = localRevision !== undefined && entryRevision !== undefined &&
          Number.isFinite(inspectionAge) && inspectionAge >= 0 && inspectionAge < 60_000 &&
          priorSettledLocalRevision === localRevision && priorSettledEntryRevision === entryRevision && this.settledDirectoryRevision === directoryRevision;
        const sizeWait = row => row.phase === 'push' && !row.local && row.nextAt > 0 && row.reason.startsWith('too_large:');
        if (unchanged && localRevision === fs[Symbol.for('abele.sync.local-scan-revision-v1')]?.() &&
            this.ctx.watching() && !this.unscanned && !joining && !reconciling &&
            (!priorReconciliation || priorReconciliation.phase === 'complete') &&
            scope.recheck.size === 0 && earlyPull && !earlyPull.bootstrapped && earlyPull.held.length === 0 &&
            this.ctx.watch.noticed.size === 0 && this.ctx.watch.reported.size === 0 &&
            waiting.every(row => !this.retries.ready(row.path) || sizeWait(row)) &&
            [...this.kept].every(path => waiting.some(row => row.path === path))) {
          const empty = { ops: [], hashes: new Map(), infos: new Map(), diskPaths: new Map(), dirty: new Set(), skipped: [], collisions: [] };
          const sent = await push(client, fs, state, empty, common);
          this.ctx.set({ pending: this.kept.size, cursor: earlyPull.cursor });
          const deferred = await this.countStaged();
          if (localRevision === fs[Symbol.for('abele.sync.local-scan-revision-v1')]?.() &&
              this.ctx.watch.noticed.size === 0 && this.ctx.watch.reported.size === 0)
          {
            this.settledDirectoryRevision = await state.getMeta?.('v2-directories');
          this.settledLocalRevision = localRevision;
            this.settledEntryRevision = await state[Symbol.for('abele.sync.local-scan-state-revision-v1')]?.();
          }
          this.ctx.log('sync: local inventory unchanged; no filesystem scan');
          return { pull: earlyPull, push: sent, secondPull: null, collisions: this.settledCollisions ?? [], deferred, joined: false };
        }
        this.settledLocalRevision = undefined;
        await this.scanWork(() => refreshLocalPaths(scanningFs, state, {`
        )
        code = replaceOnce(
          code,
          '        return {\n            pull: before,',
          `        if (localRevision !== undefined && localRevision === fs[Symbol.for('abele.sync.local-scan-revision-v1')]?.() &&
            this.ctx.watch.noticed.size === 0 && this.ctx.watch.reported.size === 0) {
          this.settledDirectoryRevision = await state.getMeta?.('v2-directories');
          this.settledLocalRevision = localRevision;
          this.settledEntryRevision = await state[Symbol.for('abele.sync.local-scan-state-revision-v1')]?.();
          this.settledCollisions = found.collisions;
          // Only an ordinary inspection renews the deadline. Frequent feed/idle cycles
          // cannot extend trust in watcher coverage; a backwards clock expires it too.
          this.settledInspectionAt = this.ctx.now();
        }
        return {
            pull: before,`
        )
        code = replaceOnce(
          code,
          'const report = await pull(client, fs, state, {',
          `const report = await pull(client, fs, state, {
            [Symbol.for('abele.sync.cursor-committed-v1')]: cursor => this.ctx.set({ cursor }),`
        )
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
        async cycleUnlocked() {
          const priorSettledLocalRevision = this.settledLocalRevision;
          const priorSettledEntryRevision = this.settledEntryRevision;
          // Failure/cancellation cannot leave an earlier pass's proof reusable.
          this.settledLocalRevision = undefined;
          this.settledEntryRevision = undefined;`
        )
      } else if (file.endsWith('/pullWrite.js')) {
        code = replaceOnce(
          code,
          'async flushCleanup() {',
          'async flushCleanup(commitState = this.state) {'
        )
        code = replaceOnce(
          code,
          'if (!done.size)\n            return;\n        await commitAppliedSettlement(this.state,',
          'if (!done.size)\n            return;\n        await commitAppliedSettlement(commitState,'
        )
      } else if (file.endsWith('/pathOccupant.js')) {
        code = replaceOnce(
          code,
          'key = fs.pathKey.bind(fs);',
          `key = fs.pathKey.bind(fs);
          if (fs[Symbol.for('abele.sync.portable-candidates-v1')] === true)
            key[Symbol.for('abele.sync.portable-candidates-v1')] = true;`
        )
      } else if (file.endsWith('/deletes.js')) {
        // Both entry checks and operation partitioning can cover an entire vault. Keep the
        // synchronous public helper, but drive the same algorithm cooperatively in the cycle.
        code = `import { ScanWork } from './scanWork.js';\n` + code
        code = replaceOnce(
          code,
          'export function judgeDeletes(ops, entries, filter, confirmed, guard, context = {}) {',
          `function* judgeDeleteSteps(ops, entries, filter, confirmed, guard, context = {}) {`
        )
        code = replaceOnce(
          code,
          'for (const entry of entries) {',
          'for (const entry of entries) { yield;'
        )
        for (const [before, after] of [
          [
            "ops.filter((op) => op.op === 'delete' && !confirmed.has(op.file_id))",
            "(yield* deleteFilter(ops, (op) => op.op === 'delete' && !confirmed.has(op.file_id)))",
          ],
          [
            'unconfirmed.filter((op) => !sticky.has(op.file_id))',
            '(yield* deleteFilter(unconfirmed, (op) => !sticky.has(op.file_id)))',
          ],
          [
            'unconfirmed.filter((op) => sticky.has(op.file_id) || trips).map((op) => op.file_id)',
            '(yield* deleteMap((yield* deleteFilter(unconfirmed, (op) => sticky.has(op.file_id) || trips)), (op) => op.file_id))',
          ],
          [
            "ops.filter((op) => op.op !== 'delete' || !holding.has(op.file_id))",
            "(yield* deleteFilter(ops, (op) => op.op !== 'delete' || !holding.has(op.file_id)))",
          ],
          [
            `unconfirmed
            .filter((op) => holding.has(op.file_id))
            .map((op) => ({
            path: byId.get(op.file_id)?.wirePath ?? op.file_id,
            fileId: op.file_id,
        }))`,
            `(yield* deleteMap((yield* deleteFilter(unconfirmed, (op) => holding.has(op.file_id))), (op) => ({
            path: byId.get(op.file_id)?.wirePath ?? op.file_id, fileId: op.file_id,
          })))`,
          ],
        ])
          code = replaceOnce(code, before, after)
        code += `
function* deleteFilter(items, test) {
  const result = [];
  for (const item of items) { yield; if (test(item)) result.push(item); }
  return result;
}
function* deleteMap(items, map) {
  const result = [];
  for (const item of items) { yield; result.push(map(item)); }
  return result;
}
export function judgeDeletes(...args) {
  const steps = judgeDeleteSteps(...args);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}
export async function judgeDeletesCooperatively(args, scheduling) {
  const steps = judgeDeleteSteps(...args), work = new ScanWork(scheduling);
  for (;;) { const next = steps.next(); if (next.done) return next.value; await work.step(); }
}
`
      } else if (file.endsWith('/deleteGate.js')) {
        code = replaceOnce(code, 'judgeDeletes,', 'judgeDeletesCooperatively,')
        code = replaceOnce(
          code,
          'judgeDeletes(ops, entries, this.ctx.filter, confirmed, guard, {',
          'await judgeDeletesCooperatively([ops, entries, this.ctx.filter, confirmed, guard, {'
        )
        code = replaceOnce(
          code,
          'recent,\n        });',
          'recent,\n        }], scanScheduling(this.ctx.state));'
        )
        code = replaceOnce(
          code,
          'for await (const entry of this.ctx.state.all())',
          'if (ops.length) for await (const entry of this.ctx.state.all())'
        )
      } else if (file.endsWith('/pullRun.js')) {
        code =
          `import { PendingPullWrites } from './pullWrite.js';\nimport { notifyApplied } from './applied.js';\nimport { ScanWork, scanScheduling } from './scanWork.js';\n` +
          code
        code = replaceOnce(
          code,
          '            await publish?.(tx);\n        });\n    }',
          `            await publish?.(tx);
        });
        this.opts[Symbol.for('abele.sync.cursor-committed-v1')]?.(this.report.cursor);
    }`
        )
        code = replaceOnce(
          code,
          '        for (const change of wanted) {\n            checkCancellation(this.opts.signal);',
          `        const pendingWrites = this.state.metadataKeys && !this.stagedReplay
          ? new Set(await this.state.metadataKeys('pull-write:')) : null;
        const candidates = pendingWrites ? wanted.filter(change => change.op !== 'delete' && change.sha !== null &&
          !this.opts.recheck?.has(change.file_id) && !pendingWrites.has('pull-write:' + change.file_id) &&
          !this.placer.pending.cleanups.has(change.file_id) && !this.heldFiles.has(change.file_id) &&
          !this.refused.files.has(change.file_id)) : [];
        const feedEntries = this.state[Symbol.for('abele.sync.feed-entries-v1')];
        const echoEntries = new Map((await (feedEntries
          ? feedEntries.call(this.state, candidates.map(change => change.file_id), this.opts.signal)
          : Promise.all(candidates.map(change => this.state.byFileId(change.file_id)))))
          .filter(Boolean).map(entry => [entry.fileId, entry]));
        const echoWork = new ScanWork({ ...scanScheduling(this.state), signal: this.opts.signal });
        for (const change of wanted) {
            await echoWork.step();
            checkCancellation(this.opts.signal);
            const echo = echoEntries.get(change.file_id);
            if (!this.stagedReplay && pendingWrites && change.op !== 'delete' && change.sha !== null &&
                echo?.versionId === change.version_id && echo.sha === change.sha && echo.wirePath === change.path &&
                !this.opts.recheck?.has(change.file_id) && !pendingWrites.has('pull-write:' + change.file_id) &&
                !this.placer.pending.cleanups.has(change.file_id) && !this.heldFiles.has(change.file_id) &&
                !this.refused.files.has(change.file_id)) {
              this.report.skipped++;
              await finish(change);
              continue;
            }`
        )
        code = replaceOnce(
          code,
          'const local = await shaIndex(this.state);',
          'const local = this.opts.nativeBatchLocal ?? await shaIndex(this.state);'
        )
        const ordinaryStart = code.indexOf(
          '        const budget = this.opts.prefetchBytes ?? DEFAULT_PREFETCH_BYTES;'
        )
        const ordinaryEnd = code.indexOf(
          '\n        this.firstHeld = this.holds.earliest();\n    }\n    async retryFailure',
          ordinaryStart
        )
        if (ordinaryStart < 0 || ordinaryEnd < 0)
          throw boundaryError(id, 'ordinary placement body', 0)
        const ordinary = code.slice(ordinaryStart, ordinaryEnd)
        code =
          code.slice(0, ordinaryStart) +
          '        await this.placeTaking(taking, local, finish);' +
          code.slice(ordinaryEnd)
        code = replaceOnce(
          code,
          '    async retryFailure',
          `    async placeTaking(taking, local, finish) {\n${ordinary}\n    }\n    async retryFailure`
        )
        code = replaceOnce(
          code,
          'await this.placeTaking(taking, local, finish);',
          `
        const installBatch = this.fs[Symbol.for('abele.sync.install-batch-v1')];
        if (installBatch && this.opts.nativeBatch !== false &&
            this.state.externalDurability === 'durable') {
          let previousCleanup;
          const process = async (group) => {
            checkCancellation(this.opts.signal);
            const plans = [];
            const split = async () => {
              if (group.length === 1) return this.placeTaking(group, local, finish);
              const middle = Math.floor(group.length / 2);
              await process(group.slice(0, middle));
              await process(group.slice(middle));
            };
            const fallback = async () => {
              // A declined cohort often contains existing destinations. Preserve
              // their ordinary shared inspection/prefetch context, rather than
              // turning a populated-vault pull into one whole setup per file.
              const present = [];
              for (const plan of plans) present.push(await this.fs.stat(plan.path) !== null);
              if (present.every(Boolean)) return this.placeTaking(group, local, finish);
              if (!present.some(Boolean)) return split();
              for (let start = 0; start < group.length;) {
                let end = start + 1;
                while (end < group.length && present[end] === present[start]) end++;
                const run = group.slice(start, end);
                if (present[start]) await this.placeTaking(run, local, finish);
                else await process(run);
                start = end;
              }
            };
            let eligible = group.length > 0;
            try { for (const change of group) {
              if (!eligible) break;
              if (change.op !== 'create' || change.prev_path !== null || change.sha === null ||
                  change.size === null || this.isDirty(change, null) || this.isNoted(change, null) ||
                  await this.changeRefusal(change) ||
                  await this.state.byFileId(change.file_id) !== null ||
                  await this.placer.pending.read(change.file_id) !== null) { eligible = false; break; }
              const path = await this.placer.targetOf(change, null);
              plans.push({ path, sha: change.sha, size: change.size, mtime: change.mtime ?? 0 });
            } } catch { eligible = false; }
            if (!eligible) return split();
            const notifications = [], refused = {};
            let result;
            try {
              result = await installBatch.call(this.fs, plans, async (view, flush) => {
                const report = { applied: 0, skipped: 0, held: [], deferred: 0,
                  cursor: this.report.cursor, bootstrapped: this.report.bootstrapped };
                await this.state.transaction(async (tx) => {
                  // Prior aliases have already retired after their acknowledged
                  // commit. Retire their metadata in this cohort's same commit.
                  await previousCleanup?.flushCleanup(tx);
                  // Reuse all ordinary admission, content, ownership and settlement checks.
                  // Savepoints do not acknowledge cleanup until the outer host COMMIT.
                  const batch = new Puller(this.client, view, tx, { ...this.opts,
                    nativeBatch: false, nativeBatchLocal: local,
                    placementConcurrency: Math.min(16, this.opts.placementConcurrency ?? 1),
                    prefetchBytes: 0, onApplied: (change) => notifications.push(change),
                  }, report);
                  await batch.apply(group);
                  if (report.held.length || report.deferred || report.rejected?.length ||
                      report.applied + report.skipped !== group.length) throw refused;
                  await flush();
                });
                const cleanup = new PendingPullWrites(this.state, view, true, this.client, this.opts.signal);
                // This capability is the committed root, never an outer savepoint.
                await cleanup.recoverCleanup();
                previousCleanup = cleanup;
                return report;
              });
            } catch (error) { if (error !== refused) throw error; }
            if (!result) return fallback();
            this.report.applied += result.applied;
            this.report.skipped += result.skipped;
            for (const change of group) { this.resolve(change); await finish(change); }
            const delivery = new ScanWork({ ...scanScheduling(this.state), signal: this.opts.signal });
            for (const notification of notifications) {
              await delivery.step();
              if (!this.opts.signal?.aborted) await notifyApplied(this.opts, notification);
            }
          };
          for (let offset = 0; offset < taking.length;) {
            const group = [];
            let bytes = 0;
            while (offset < taking.length && group.length < 64) {
              const change = taking[offset], size = Math.max(0, change.size ?? 0);
              if (group.length && bytes + size > 16 * 1024 * 1024) break;
              group.push(change); bytes += size; offset++;
            }
            // Keep a tiny tail in a real cohort: 65 small files form 63 + 2,
            // rather than restoring the ordinary singleton's repeated barriers.
            if (taking.length - offset === 1 && group.length > 1 &&
                (group.at(-1).size ?? 0) + (taking[offset].size ?? 0) <= 16 * 1024 * 1024) {
              offset--;
              group.pop();
            }
            await process(group);
          }
          await previousCleanup?.flushCleanup();
        } else await this.placeTaking(taking, local, finish);`
        )
        code = replaceOnce(code, 'const MANIFEST_PAGE = 1000;', 'const MANIFEST_PAGE = 5000;')
        code = replaceOnce(
          code,
          'seen.add(sha);',
          `if (await this.placer.destinationMatches(change.path, sha, change.size)) continue;
            const candidate = await this.placer.localCandidate(sha, change.size, local);
            if (candidate) { local.set(sha, candidate); continue; }
            seen.add(sha);`
        )
        code = replaceOnce(
          code,
          'async prefetch(changes, local) {',
          `async prefetch(changes, local) {
          if (this.opts.prefetchBytes === 0) return new Map();
          // Reuse the input inventory, not receipts installed by earlier pages of this pull.
          this.placer.initialLocal ??= new Map(local);
          // Absence belongs to this batch: a later page may move the same id to local bytes.
          this.placer.adoptionCandidates = new Map();
          if (this.fs.beginAtomicWrite && this.fs.reopenStage && this.client.openVersion) {
            const wanted = [];
            const observations = new Map();
            const revision = this.fs[Symbol.for('abele.sync.local-change-revision-v1')];
            const siblings = new Map();
            for (const change of changes) {
              if (change.sha === null || change.op === 'delete' || change.size === null ||
                  change.size > this.placer.budget.maxChunkBytes || this.passedOver(change)) continue;
              const entry = await this.state.byFileId(change.file_id);
              if (entry?.versionId === change.version_id || entry?.sha === change.sha ||
                  this.isDirty(change, entry)) continue;
              // Pending publication owns its source and resume offset. Recovery
              // decides whether any bytes are missing; batch prefetch cannot.
              if (await this.placer.pending.read(change.file_id) !== null) continue;
              if (this.placer.initialLocal.has(change.sha)) continue;
              let observed;
              // A missing receipt does not mean missing bytes. Let placement verify and adopt
              // an existing portable spelling before spending a content request on it.
              {
                const inventory = await this.placer.paths(change.path);
                if (inventory.blocked(change.path)) continue;
                let target;
                try { target = inventory.resolve(change.path, 'file'); }
                catch { continue; }
                let exists;
                if (this.fs[Symbol.for('abele.sync.inventory-children-v1')]) {
                  const parent = target.slice(0, Math.max(0, target.lastIndexOf('/')));
                  let observation = siblings.get(parent);
                  if (!observation) {
                    // Reuse the pull's parent inventory once, rather than adding a bridge
                    // stat for every absent target. Placement still performs live checks.
                    const clock = revision?.call(this.fs);
                    const names = new Set((await inventoryChildren(this.fs, parent, target, true))
                      .map((child) => child.path.normalize('NFC').toLowerCase()));
                    observation = { names, clock };
                    siblings.set(parent, observation);
                  }
                  observed = observation.clock;
                  exists = observation.names.has(target.normalize('NFC').toLowerCase());
                } else {
                  observed = revision?.call(this.fs);
                  exists = await this.fs.stat(target) !== null;
                }
                this.placer.adoptionCandidates.set(change.file_id, exists);
                if (exists && (entry === null || await this.placer.destinationMatches(target, change.sha, change.size))) continue;
              }
              if (await this.placer.localCandidate(change.sha, change.size, local)) continue;
              wanted.push(change);
              observations.set(change, observed);
            }
            const fetched = new Map();
            const prefetched = fetched[Symbol.for('abele.sync.prefetched-files-v1')] = new Set();
            // pool drains active workers after a failure; no source outlives the run.
            await pool(wanted, 8, async (change) => {
                const destinationReady = async () => {
                  const inventory = await this.placer.paths(change.path);
                  if (inventory.blocked(change.path)) return false;
                  let target;
                  try { target = inventory.resolve(change.path, 'file'); }
                  catch { return false; }
                  if (!await this.placer.destinationMatches(target, change.sha, change.size)) return false;
                  // Placement repeats verification under its lease; a batch's old absence
                  // must not suppress adoption of bytes that arrived while prefetch awaited.
                  this.placer.adoptionCandidates.set(change.file_id, true);
                  return true;
                };
                // Event revisions are free; hosts without them use the failure fallback.
                const observed = observations.get(change);
                if (observed !== undefined && revision.call(this.fs, change.path) > observed &&
                    await destinationReady()) return;
                try {
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
                } catch (error) {
                  // A local writer may finish during a failed or cancelled content request.
                  if (!await destinationReady()) throw error;
                }
            });
            return fetched;
          }`
        )
      } else if (file.endsWith('/removalRetention.js')) {
        for (const declaration of [
          'export async function retentionSnapshot(fs) {',
          'export async function retainRemoval(fs, op, options = {}) {',
          'export async function captureRemoval(fs, state, base, authorize, now, capturedIdentity, expected = base, signal) {',
          'export async function retainPublishedVictim(fs, source, path, expected, publication) {',
          'export async function acknowledgePublication(fs, publication) {',
          'export async function recoverRemovals(fs, state, policy = {}, onlyPath) {',
        ])
          code = replaceOnce(
            code,
            declaration,
            declaration +
              `
          if (!fs[Symbol.for('abele.sync.private-removal-view-v1')])
            fs = fs[Symbol.for('abele.sync.private-removal-files-v1')]?.() ?? fs;`
          )
      } else if (file.endsWith('/reconciliation.js')) {
        code = replaceOnce(
          code,
          'for await (const info of fs.list()) {\n        await work.step();\n        disk.set(info.path, info);\n    }',
          `const replayEntries = retiredEntries ? null : await additiveReplayEntries(fs, state, scheduling);
    if (replayEntries === null) {
      for await (const info of fs.list()) {
        await work.step();
        disk.set(info.path, info);
      }
    } else {
      let next = 0;
      let failed = false;
      let failure;
      // Fixed workers overlap fresh guarded reads without waiting for an entire
      // batch's slowest read. Every worker drains before a failure is propagated.
      const readTracked = async () => {
        try {
          while (!failed && next < replayEntries.length) {
            const entry = replayEntries[next++];
            await work.step();
            if (failed) break;
            if (isEngineOwn(entry.wirePath) || filter.excluded(entry.wirePath, entry.size)) continue;
            const info = await fs.stat(entry.path);
            if (info) disk.set(entry.path, { ...info, path: entry.path });
          }
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      };
      await Promise.all(Array.from({ length: 32 }, readTracked));
      if (failed) throw failure;
    }`
        )

        code = replaceOnce(
          code,
          'const cached = !selected.has(path) ? await readScanHint(state, info, epoch) : null;',
          `const hostHash = changed ? await fs[Symbol.for('abele.sync.cached-scan-hash-v1')]?.(info.path) : null;
          const cached = hostHash?.size === info.size && hostHash?.mtime === info.mtime
            ? hostHash.sha : !selected.has(path) ? await readScanHint(state, info, epoch) : null;`
        )
        code = replaceOnce(
          code,
          'if (!selected.has(path) && !changed)',
          'if (!changed && (!selected.has(path) || await pairedBaseline(fs, state, entry)))'
        )
        code = replaceOnce(
          code,
          'const fingerprint = cached === null',
          'const beforeIdentity = await fs.fileIdentity?.(info.path);\n                const fingerprint = cached === null'
        )
        code = replaceOnce(
          code,
          'found.hashes.set(path, fingerprint.sha);',
          'if (cached === null) await recordPaired(fs, state, info.path, info, fingerprint.sha, beforeIdentity);\n                found.hashes.set(path, fingerprint.sha);'
        )
      } else if (file.endsWith('/scanner.js')) {
        code = replaceOnce(
          code,
          'export async function scan(fs, state, filter, opts = {}) {',
          `export async function scan(fs, state, filter, opts = {}) {
    try { return await scanWithUploads(fs, state, filter, opts); }
    finally { await fs[Symbol.for('abele.sync.finish-scan-uploads-v1')]?.(); }
}
async function scanWithUploads(fs, state, filter, opts = {}) {`
        )
        code = replaceOnce(
          code,
          `if (!entry) {
            fresh.push(wirePath);`,
          `if (!entry) {
            // Namespace discovery and collision checks have finished; immutable blobs
            // can travel now. Rename pairing and all commits still wait for the scan.
            if (!opts.readOnly)
                await fs[Symbol.for('abele.sync.prepare-scan-upload-v1')]?.(info.path, { sha, size: info.size }, opts.signal);
            fresh.push(wirePath);`
        )
        code = replaceOnce(
          code,
          'const fingerprint = await fingerprintFile(fs, info.path, hash, opts.signal);',
          `const beforeIdentity = await fs.fileIdentity?.(info.path);
            const fresh = fs[Symbol.for('abele.sync.fingerprint-fresh-v1')];
            const cached = opts.revalidate !== 'all' && !recreatedPaths.has(wirePath) && !revalidate.has(wirePath) && !opts.verifyPaths?.has(wirePath)
              ? await fs[Symbol.for('abele.sync.cached-scan-hash-v1')]?.(info.path) : null;
            const fingerprint = fresh && (revalidate.has(wirePath) || opts.verifyPaths?.has(wirePath))
              ? await fresh.call(fs, info.path, opts.signal) : cached ?? await fingerprintFile(fs, info.path, hash, opts.signal);
            if (!opts.readOnly) await recordPaired(fs, state, info.path, info, fingerprint.sha, beforeIdentity);`
        )
      } else if (file.endsWith('/localPaths.js')) {
        code = replaceOnce(
          code,
          'const inventory = await LocalPaths.read(fs, state, opts);\n    await inventory.rememberDirectories(state, opts);',
          `const replayEntries = await additiveReplayEntries(fs, state, opts);
    const inventory = replayEntries === null ? await LocalPaths.read(fs, state, opts) : new LocalPaths();
    if (replayEntries === null) await inventory.rememberDirectories(state, opts);
    else {
      const read = new Set();
      const work = new ScanWork(opts);
      for (const entry of replayEntries) {
        await work.step();
        const segments = wirePath(entry.wirePath).split('/');
        let parent = '';
        for (let n = 0; n < segments.length; n++) {
          if (!read.has(parent)) {
            // This inventory is shared by the pass; each physical sibling is added once.
            // Read complete directories, never a target-filtered host inventory.
            for (const child of await fs.listChildren(parent)) {
              inventory.add(child);
              await work.step();
            }
            read.add(parent);
          }
          const prefix = segments.slice(0, n + 1).join('/');
          const matches = inventory.entries.get(prefix) ?? [];
          if (matches.length !== 1 || matches[0].kind !== 'directory') break;
          parent = matches[0].path;
        }
      }
      await inventory.loadDirectoryHolds(state, opts);
    }`
        )

        code = replaceOnce(
          code,
          'for await (const dir of fs.listDirectories())',
          'for await (const dir of inventoryDirectories(fs))'
        )
        code = replaceOnce(
          code,
          'for (const child of await fs.listChildren(parent)) {\n                await work.step();\n                result.add(child);',
          'for (const child of await inventoryChildren(fs, parent, path)) {\n                await work.step();\n                result.add(child);'
        )
      } else if (file.endsWith('/pullPlace.js')) {
        code = replaceOnce(
          code,
          'this.lying = shared?.lying ?? new Set();',
          `this.lying = shared?.lying ?? new Set();
          this.initialLocal = shared?.initialLocal;
          this.adoptionCandidates = shared?.adoptionCandidates;`
        )

        code = replaceOnce(
          code,
          'const identity = { sha, size: change.size };',
          `const identity = { sha, size: change.size };
        const paired = entry && from !== null ? await pairedBaseline(this.fs, this.state, entry) : null;`
        )
        code = replaceOnce(
          code,
          '? { sha: entry.sha, size: entry.size, mtime: entry.mtime }',
          '? { sha: entry.sha, size: entry.size, mtime: entry.mtime, ...(paired ? { identity: paired.identity } : {}) }'
        )
        code = replaceOnce(
          code,
          '...(sourceIdentity === undefined ? {} : { identity: sourceIdentity }),',
          '...(paired?.identity === sourceIdentity && sourceIdentity !== undefined ? { identity: sourceIdentity } : {}),'
        )
        code = replaceOnce(
          code,
          'const stage = await this.fs.reopenStage(pending.stageId);',
          `let stage;
          try { stage = await this.fs.reopenStage(pending.stageId); }
          catch (error) { if (stageMissing(error)) {
            this.opts.log?.(\`pull: holding \${target}: pending stage lacks source publication authority\`);
            return false;
          } throw error; }`
        )
        code = replaceOnce(
          code,
          'async streamPlace(change, sha, entry, target, from, beforeTarget, beforeFrom, local) {',
          `async streamPlace(change, sha, entry, target, from, beforeTarget, beforeFrom, local) {
          const moveSource = (op) => this.fs[Symbol.for('abele.sync.stream-move-source-v1')]
            ? this.fs[Symbol.for('abele.sync.stream-move-source-v1')](op) : this.effect(op);`
        )
        code = replaceOnce(
          code,
          '!(await this.effect({\n                            path: from,',
          '!(await moveSource({\n                            path: from,'
        )
        code = replaceOnce(
          code,
          'const have = await settledStat(this.fs, target, sha, wrote, this.hash);',
          'const beforeIdentity = await this.fs.fileIdentity?.(target);\n        const have = await settledStat(this.fs, target, sha, wrote, this.hash);'
        )
        code = replaceOnce(
          code,
          'if (this.sequenceKnown)\n                await recordPull(tx, change);',
          'await recordPaired(this.fs, tx, target, have, sha, beforeIdentity);\n            if (this.sequenceKnown)\n                await recordPull(tx, change);'
        )
        code = replaceOnce(
          code,
          'if ((await fingerprintFile(this.fs, path, this.hash)).sha !== entry.sha)',
          `if (!(target !== entry.path && (
              await pairedBaseline(this.fs, this.state, { ...entry, path }) ||
              (this.fs[Symbol.for('abele.sync.stream-move-source-v1')] &&
                await this.fs[Symbol.for('abele.sync.replay-stage-v1')]?.() === false))) &&
            (await fingerprintFile(this.fs, path, this.hash)).sha !== entry.sha)`
        )
        code = `import { receiveToStage as receivePlacementSource } from './streaming.js';\n` + code
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
        if (this.fs[Symbol.for('abele.sync.recover-published-pull-v1')]) {
          if (pending.stageId !== undefined) return false;
          if (pending.receiptId === undefined ||
              await this.fs.installedFile?.(pending.receiptId, pending.target, change.sha) !== true) return false;
        }
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
          `beforeFrom !== null &&
                (!pending.sourceIdentity || (await this.fs.fileIdentity?.(from)) !== pending.sourceIdentity)`,
          `beforeFrom !== null &&
                // Same physical name uses host recovery, which retains uncertain bytes.
                // A distinct source still requires the original durable identity.
                !(this.fs[Symbol.for('abele.sync.recover-published-pull-v1')] &&
                  this.fs.pathKey && this.fs.pathKey(from) === this.fs.pathKey(target)) &&
                (!pending.sourceIdentity || (await this.fs.fileIdentity?.(from)) !== pending.sourceIdentity)`
        )
        code = replaceOnce(
          code,
          `if (entry !== null && (await this.edited(entry, target)))
            return false;
        const movedBase =`,
          `if (pending && !pending.stageId && this.fs[Symbol.for('abele.sync.recover-published-pull-v1')] && this.fs.reopenStage && this.client.openVersion && change.size !== null) {
          if (from !== null && beforeFrom !== null && caseKey(from) !== caseKey(target) &&
              (!pending.sourceIdentity || await this.fs.fileIdentity?.(from) !== pending.sourceIdentity)) return false;
          return this.streamPlace(change, sha, entry, target, from, firstTarget, beforeFrom, local);
        }
        if (entry !== null && (await this.edited(entry, target)))
            return false;
        const movedBase =`
        )
        code = replaceOnce(
          code,
          `if (!pending?.stageId)
            await this.pending.prepare(change, entry, target, from, undefined, undefined, sourceIdentity);
        const allocate = () => this.fs.beginAtomicWrite(target, change.mtime ?? 0, base, (id) => this.pending.prepare(change, entry, target, from, id, undefined, sourceIdentity));
        let stage;
        if (pending?.stageId !== undefined) {
            try {
                stage = await this.fs.reopenStage(pending.stageId);
            }
            catch (error) {
                if (!stageMissing(error))
                    throw error;
                // Intent is durable before allocation. Another participant can crash in
                // that interval, leaving an id with no stage. Reallocate under the same
                // exact version/base/source authority, never adopt public bytes or switch
                // to a buffered write. Conditional commit still checks the original base.
                stage = await allocate();
            }
        }
        else
            stage = await allocate();
        if (stage.id !== pending?.stageId)
            await this.pending.prepare(change, entry, target, from, stage.id, undefined, sourceIdentity);`,
          `const recoverHost = pending && this.fs[Symbol.for('abele.sync.recover-published-pull-v1')];
        const ownStage = (id) => this.pending.prepare(change, entry, target, from, id, pending?.receiptId, sourceIdentity);
        if (!pending?.stageId && !recoverHost)
            await this.pending.prepare(change, entry, target, from, undefined, undefined, sourceIdentity);
        const allocate = () => this.fs.beginAtomicWrite(target, change.mtime ?? 0, base, ownStage);
        let stage;
        if (recoverHost)
          stage = await recoverHost.call(this.fs, pending.stageId ?? null, target, change.mtime ?? 0, from, ownStage, base, pending.receiptId);
        else if (pending?.stageId !== undefined) {
          try {
            stage = await (this.fs[Symbol.for('abele.sync.reopen-pull-stage-v1')]
              ? this.fs[Symbol.for('abele.sync.reopen-pull-stage-v1')](pending.stageId)
              : this.fs.reopenStage(pending.stageId));
          } catch (error) {
            if (!stageMissing(error)) throw error;
            stage = await allocate();
          }
        } else stage = await allocate();
        if (stage.id !== pending?.stageId || recoverHost) await ownStage(stage.id);
        if (recoverHost) pending.stageId = stage.id;`
        )
        code = replaceOnce(
          code,
          `if (from !== null &&
                    beforeFrom !== null &&
                    (entry === null ||`,
          `if (from !== null &&
                    beforeFrom !== null &&
                    !(recoverHost && this.fs.pathKey && this.fs.pathKey(from) === this.fs.pathKey(target)) &&
                    (entry === null ||`
        )
        code = replaceOnce(
          code,
          'async localSource(sha, local) {',
          `async localSource(sha, local) {
          const replay = this.fs[Symbol.for('abele.sync.replay-stage-v1')];
          if (replay && !await replay.call(this.fs)) return null;
        `
        )
        for (const name of ['adopt', 'adoptExisting']) {
          const args = name === 'adoptExisting' ? 'change, entry, newest = false' : 'change, entry'
          const forward = name === 'adoptExisting' ? 'change, entry, newest' : 'change, entry'
          code = replaceOnce(
            code,
            `async ${name}(${args}) {`,
            `async ${name}(${args}) {
            // Adoption verifies existing bytes and records metadata; it never overwrites files.
            return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
              () => this.${name}Unlocked(${forward}), false);
          }
          async ${name}Unlocked(${args}) {
            ${
              name === 'adoptExisting'
                ? `if (this.fs[Symbol.for('abele.sync.recover-published-pull-v1')] &&
              await this.pending.matching(change, entry) !== null) return false;`
                : ''
            }`
          )
        }
        code = replaceOnce(
          code,
          'async drop(entry, change) {',
          `async drop(entry, change) {
          return coordinatePlacement(this.fs, [entry.path], async () => {
            if (await this.edited(entry)) return false;
            return this.dropUnlocked(entry, change);
          });
        }
        async dropUnlocked(entry, change) {`
        )
        code = replaceOnce(
          code,
          'async place(change, sha, entry, fetched, local) {',
          `async place(change, sha, entry, fetched, local) {
          const pass = this.fs[Symbol.for('abele.sync.operation-pass-v1')];
          const run = () => this.placeWithTrace(change, sha, entry, fetched, local);
          return pass ? pass.call(this.fs, run) : run();
        }
        async placeWithTrace(change, sha, entry, fetched, local) {
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
        async localCandidate(sha, size, local) {
          const verify = async (path) => {
            try {
              const have = await fingerprintPlacementFile(this.fs, path, this.hash);
              return have.sha === sha && have.size === size ? { path } : null;
            } catch { return null; }
          };
          this.initialLocal ??= new Map(local);
          const known = this.initialLocal.get(sha);
          if (known) {
            const match = await verify(known.path);
            if (match) return match;
          }
          // Discovering unknown hashes belongs to the scanner. A pull must not wait
          // for unrelated files merely because their sizes match the remote content.
          return null;
        }
        async editedMoveDestination(change, entry) {
          if (!entry || entry.wirePath === change.path || await this.fs.stat(entry.path) !== null)
            return false;
          let target;
          try { target = await resolveLocalFile(this.fs, this.state, change.path); }
          catch { return true; }
          if (await this.fs.stat(target) === null) return false;
          try { return (await fingerprintPlacementFile(this.fs, target, this.hash)).sha !== entry.sha; }
          catch { return true; }
        }
        async destinationMatches(path, sha, size) {
          try {
            const have = await fingerprintPlacementFile(this.fs, path, this.hash);
            return have.sha === sha && have.size === size;
          } catch { return false; }
        }
        async placeObserved(change, sha, entry, fetched, local) {
          // Interrupted intents own recovery. Ordinary offline-edit preflight must
          // not bypass their stage verification, preservation or case-only moves.
          const pendingPlacement = await this.pending.matching(change, entry);
          const recovering = pendingPlacement !== null;
          // A complete readable private stage already owns the immutable bytes.
          // Publication authenticates it again under the lease; do not prefetch it.
          const replayStage = this.fs[Symbol.for('abele.sync.replay-stage-v1')];
          if (pendingPlacement?.stageId && this.fs.reopenStage && replayStage &&
              await replayStage.call(this.fs)) {
            let complete = false;
            try { complete = (await this.fs.reopenStage(pendingPlacement.stageId)).offset === change.size; }
            catch (error) { if (!stageMissing(error)) throw error; }
            if (complete)
              return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
                () => this.placeUnlocked(change, sha, entry, fetched, local));
          }
          // Preflight avoids unnecessary transfers; the lease repeats this content check.
          if (!recovering && ((entry !== null && await this.edited(entry, change.path)) ||
              await this.editedMoveDestination(change, entry)))
            return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
              async () => false);
          // An own commit may precede its local receipt. Verify and adopt existing bytes before
          // fetching them again, without settling an interrupted pull's retained write intent.
          if (change.op !== 'move' && this.adoptionCandidates?.get(change.file_id) !== false &&
              (entry === null || entry.sha === sha && entry.wirePath === change.path) &&
              await this.pending.read(change.file_id) === null &&
              await coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
                () => this.adoptExistingUnlocked(change, entry))) return true;
          // Placement must still validate a move's source, but it needs no body transfer
          // when the destination already contains the immutable remote bytes.
          if (!recovering && this.adoptionCandidates?.get(change.file_id) !== false &&
              await this.destinationMatches(change.path, sha, change.size))
            return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
              () => this.placeUnlocked(change, sha, entry, fetched, local));
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
            const replay = this.fs[Symbol.for('abele.sync.replay-stage-v1')];
            const canReplay = (this.opts.prefetchBytes !== 0 && change.size <= this.budget.maxChunkBytes) || !replay || await replay.call(this.fs);
            const candidate = canReplay && change.op !== 'move' && await this.pending.read(change.file_id) === null
              ? await this.localCandidate(sha, change.size, local) : null;
            if (candidate) {
              let verified = false;
              try {
                const have = await fingerprintPlacementFile(this.fs, candidate.path, this.hash);
                verified = have.sha === sha && have.size === change.size;
              } catch { /* A removed or changed candidate falls back to the server. */ }
              if (verified) {
                if (this.opts.prefetchBytes !== 0 && change.size <= this.budget.maxChunkBytes) {
                  const bytes = await this.fs.read(candidate.path);
                  if (bytes.length === change.size && await this.hash(bytes) === sha)
                    return placeFrom(() => this.fs.openRead(candidate.path), bytes);
                } else return placeFrom(() => this.fs.openRead(candidate.path));
              }
            }
            // Small pulls fit in one transfer chunk. Avoid a second journal, copy and file
            // read per note, while still verifying the network source outside the lease.
            if (this.opts.prefetchBytes !== 0 && change.size <= this.budget.maxChunkBytes) {
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
            if (!canReplay)
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
            const candidate = await this.localCandidate(sha, change.size, local);
            if (candidate) local = new Map(local).set(sha, candidate);
            const bytes = await this.bytesOf(sha, fetched, local);
            if (!bytes) return false;
            fetched = new Map(fetched).set(sha, bytes);
          }
          return coordinatePlacement(this.fs, [change.path, ...(entry ? [entry.path] : [])],
            () => this.placeUnlocked(change, sha, entry, fetched, local));
        }
        async placeUnlocked(change, sha, entry, fetched, local) {
          if (await this.pending.matching(change, entry) === null &&
              await this.editedMoveDestination(change, entry)) return false;
`
        )
      } else if (file.endsWith('/pullRecovery.js')) {
        code = `import { EngineError } from './errors.js';\n` + code
        code = replaceOnce(
          code,
          'checkCancellation(opts.signal);\n            if (!opts.retries',
          `checkCancellation(opts.signal);
            if (error instanceof EngineError && error.code === 'conflict')
              error = new ExternalStateError('recovery-required', { cause: error });
            if (!opts.retries`
        )
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
                await state.transaction(async (tx) => {
                    const occupant = await tx.get(intent.target);
                    if (occupant !== null && occupant.fileId !== fileId)
                        throw new ExternalStateError('recovery-required');
                    if (await tx.getMeta(\`pull-write:\${fileId}\`) !== raw ||
                        await new PendingPullWrites(tx).matching(change, await tx.byFileId(fileId)) === null)
                        throw new ExternalStateError('recovery-required');
                    const detached = { ...entry, path: intent.target, wirePath: intent.wirePath };
                    await tx.delete(intent.from);
                    await tx.put(detached);
                    await tx.setMeta(\`pull-write:\${fileId}\`, JSON.stringify({ ...intent, from: null, base: detached }));
                });
                console.debug('[abele-sync] pull recovery', 'preserved independent move source; recovering into absent destination');
                return true;
            }, false);
            if (separated) {
                await recoverPendingPullWrites(fs, state, [fileId], client);
                continue;
            }
        }
        const adopted = await placer.adopt(change, entry);
        // The SDK below already places staged intents and moves. Only its legacy
        // stage-less, non-move lane needs host publication recovery here.
        if (!adopted && intent.stageId === undefined && intent.from === null &&
            client?.openVersion && fs[Symbol.for('abele.sync.recover-published-pull-v1')] &&
            await new PendingPullWrites(state).matching(change, entry) !== null)
            await placer.place(change, change.sha, entry, new Map(), new Map());`
        )
      } else if (file.endsWith('/pushSources.js')) {
        code = replaceOnce(
          code,
          `const inventory = await LocalPaths.read(fs, state);
    for (const [sha, local] of paths) {
        await work.step();
        paths.set(sha, await resolveLocalFile(fs, state, local.normalize('NFC'), local, inventory));
    }
    return sourcesAt(fs, paths);`,
          `if (!fs.listChildren) {
      const inventory = await LocalPaths.read(fs, state);
      for (const [sha, local] of paths) {
        await work.step();
        paths.set(sha, await resolveLocalFile(fs, state, local.normalize('NFC'), local, inventory));
      }
      return sourcesAt(fs, paths);
    }
    return sourcesAt(fs, paths, local => resolveLocalFile(fs, state, local.normalize('NFC'), local));`
        )
        code = replaceOnce(
          code,
          'const sourcesAt = (fs, paths) => ({',
          'const sourcesAt = (fs, paths, resolve = async path => path) => ({'
        )
        for (const spaces of [16, 8]) {
          const indent = ' '.repeat(spaces)
          code = replaceOnce(
            code,
            indent + 'const path = paths.get(sha);',
            indent +
              'const requested = paths.get(sha);\n' +
              indent +
              'const path = requested === undefined ? undefined : await resolve(requested);'
          )
        }

        code = replaceOnce(
          code,
          'return fs.openRead(path);',
          `const upload = fs[Symbol.for('abele.sync.open-upload-v1')];
          return await (upload ? upload.call(fs, path) : fs.openRead(path));`
        )
      } else if (file.endsWith('/pusher.js')) {
        code = replaceOnce(
          code,
          'await this.uploadOne(sha, sources);',
          `await this.uploadOne(sha, sources);
                // Publish each completed refusal before waiting for other uploads in the pool.
                const refused = this.refused.get(sha) ?? this.waiting.get(sha);
                if (refused && this.state[Symbol.for('abele.sync.push-refusal-v1')])
                    for (const op of ops)
                        if ('sha' in op && op.sha === sha)
                            await rejectedOp(this.state, op, refused, this.opts.maxFileBytes);`
        )
        code = replaceOnce(
          code,
          `let current = false;
            await transact(this.state, async (tx) => {
                current = await receiptStillCurrent(this.fs, tx, row);`,
          `let current = false;
            const receiptPaths = [row.path, ...(previous ? [previous.path] : [])];
            if (row.result.status !== 'rejected') {
              receiptPaths.push(row.result.path);
              if (row.result.status === 'conflict') receiptPaths.push(row.result.conflict_path);
            }
            await coordinatePlacement(this.recorder.fs, receiptPaths, () => transact(this.state, async (tx) => {
                current = await receiptStillCurrent(this.fs, tx, row);`
        )
        code = replaceOnce(
          code,
          `await this.opts.retries?.succeeded(key, 'recovery', tx);
            });
            await this.opts.retries?.load();
            const result = row.result;`,
          `await this.opts.retries?.succeeded(key, 'recovery', tx);
            }));
            await this.opts.retries?.load();
            const result = row.result;`
        )
        code = replaceOnce(
          code,
          `await transact(this.state, async (tx) => {
                const recorder = this.recorder.withState(tx);
                for (const [k, run] of verdicts.runs.entries()) {`,
          `const preparedRuns = verdicts.runs.length ? verdicts.runs : [[]];
          for (const [k, run] of preparedRuns.entries()) {`
        )
        code = replaceOnce(
          code,
          'await this.planner.fetchRun(run, verdicts, tx);',
          'await this.planner.fetchRun(run, verdicts, this.state);'
        )
        code = replaceOnce(
          code,
          `if (k > 0) {
                        if (this.opts.signal?.aborted) {
                            interrupted = true;
                            return;`,
          `if (k > 0) {
                        if (this.opts.signal?.aborted) {
                            interrupted = true;
                            break;`
        )
        code = replaceOnce(
          code,
          `if (!this.opts.signal?.aborted)
                                throw error;
                            interrupted = true;
                            return;`,
          `if (!this.opts.signal?.aborted)
                                throw error;
                            interrupted = true;
                            break;`
        )
        code = replaceOnce(
          code,
          `                    for (const at of run) {
                        // Commit completed ledger entries`,
          `const placementPaths = [], preservationPaths = [];
        for (const at of run) {
          const op = sending[at];
          if (!op) continue;
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
        await coordinatePlacement(this.recorder.fs, placementPaths, () => transact(this.state, async (tx) => {
                const recorder = this.recorder.withState(tx);
                    for (const at of run) {
                        // Commit completed ledger entries`
        )
        code = replaceOnce(
          code,
          `                }
                await this.opts.onCommitted?.(sending, tx);
                await tx.setJournal(null);
            });`,
          `                if (!interrupted && k === preparedRuns.length - 1) {
                  await this.opts.onCommitted?.(sending, tx);
                  await tx.setJournal(null);
                }
            }), preservationPaths);
            for (const change of applied.splice(0)) await notifyApplied(this.opts, change);
            if (interrupted) break;
          }`
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
          'async receive(item, seq) {',
          `async receive(item, seq) {
          if (!this.includes(item.path)) return;
          const previous = (await this.read()).directories.find(one => one.file_id === item.file_id);
          // mkdir refuses an occupied file and never rewrites descendants. Keep the lease,
          // but do not recursively archive a directory that this receipt cannot overwrite.
          return coordinatePlacement(this.fs, [item.path, ...(previous ? [previous.localPath ?? previous.path] : [])], () => this.receiveUnlocked(item, seq), false);
        }
        async receiveUnlocked(item, seq) {`
        )
        code = replaceOnce(
          code,
          'await this.fs.removeDirectory(path, removal.identity);',
          'await coordinatePlacement(this.fs, [path], () => this.fs.removeDirectory(path, removal.identity));'
        )
      } else if (file.endsWith('/departureMarks.js')) {
        code = `import { ScanWork } from './scanWork.js';\n` + code
        code = replaceOnce(
          code,
          'export async function loadDepartureMarks(state, prefix, paths) {',
          `export async function loadDepartureMarks(state, prefix, paths) {
    const read = state[Symbol.for('abele.sync.metadata-prefix-v1')];
    if (read) {
        const rows = await read.call(state, prefix);
        state = { getMeta: async key => rows.get(key) ?? null };
    }
    const work = new ScanWork();`
        )
        code = replaceOnce(
          code,
          '        const path = decodeURIComponent(key.slice(prefix.length + 2));',
          '        await work.step();\n        const path = decodeURIComponent(key.slice(prefix.length + 2));'
        )
        code = replaceOnce(
          code,
          '    while (path !== null) {',
          '    const work = new ScanWork();\n    while (path !== null) {\n        await work.step();'
        )
      } else if (file.endsWith('/departureSettlement.js')) {
        code = replaceOnce(
          code,
          '        for (const membership of memberships) {',
          `        await tx[Symbol.for('abele.sync.feed-metadata-v1')]?.([
          DEPARTURE_MARK + 'index',
          ...memberships.flatMap(row => [completedKey(row.event.file_id), membershipKey(row.event.file_id),
            DEPARTURE_MARK + 'p:' + encodeURIComponent(row.event.path)])
        ]);
        for (const membership of memberships) {`
        )
      } else if (file.endsWith('/v2Client.js')) {
        code = replaceOnce(
          code,
          'async fileItem(item, seq) {',
          'async fileItem(item, seq, proofState) {'
        )
        code = replaceOnce(
          code,
          'await predatesDeparture(this.ports.state, item.file_id, seq,',
          'await predatesDeparture(proofState ?? this.ports.state, item.file_id, seq,'
        )
        code = replaceOnce(
          code,
          '        const departing = new Map();',
          `        const metadata = await this.ports?.state[Symbol.for('abele.sync.feed-metadata-v1')]?.(
          page.items.filter(row => row.type === 'content').map(row => 'settlement-departure:completed:' + encodeURIComponent(row.file_id)));
        const proofState = metadata ? { getMeta: async key => metadata.get(key) ?? null } : undefined;
        const departing = new Map();`
        )
        code = replaceOnce(
          code,
          'this.fileItem(event.item, event.cursor)',
          'this.fileItem(event.item, event.cursor, proofState)'
        )
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
          "if (digest(first) !== expected.sha)\n                throw new AbeleError('hash_mismatch', 'source content changed');",
          "if (digest(first) !== expected.sha)\n                throw new AbeleError('hash_mismatch', 'source content changed');\n            }"
        )
      } else if (relative === 'dist/internal/core/state.js') {
        code = replaceOnce(
          code,
          '    transactionScoped = true;',
          `    transactionScoped = true;
    scanEntryRevision = 0;
    [Symbol.for('abele.sync.local-scan-state-revision-v1')]() { return this.scanEntryRevision; }`
        )
        code = replaceOnce(
          code,
          '        if (map === this.entries) {',
          '        if (map === this.entries) {\n            this.scanEntryRevision++;'
        )
      } else if (file.endsWith('/fileRetry.js')) {
        code = replaceOnce(
          code,
          'if (!row.quarantined) {',
          `if (!row.quarantined && !(row.phase === 'push' && !row.local && row.nextAt > 0 && row.reason.startsWith('too_large:'))) {`
        )
      } else if (file.endsWith('/stateTransaction.js')) {
        code = replaceOnce(
          code,
          '    close() {',
          `    [Symbol.for('abele.sync.push-refusal-v1')](row, scoped = this) {
        this.check();
        return this.parent[Symbol.for('abele.sync.push-refusal-v1')]?.(row, scoped);
    }
    close() {`
        )
      } else if (file.endsWith('/pushRefusal.js')) {
        code = replaceOnce(code, '    return {', '    const row = {')
        code = replaceOnce(
          code,
          '    };\n}',
          `    };
    await state[Symbol.for('abele.sync.push-refusal-v1')]?.(row);
    return row;
}`
        )
      } else return null
      const body = helper + code
      return { code: `${marker}${relative}:${digest(body)}\n${body}`, map: null }
    },
  }
}
