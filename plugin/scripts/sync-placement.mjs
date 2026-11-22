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
// A restored file is a new local intention even when its bytes and timestamps
// match the old baseline. Keep that fact across retirement and process cuts.
async function protectRestoredJournalDeletes(fs, state, journal) {
  if (!fs) return;
  for (const op of journal.ops) {
    if (op.op !== 'delete') continue;
    const entry = await state.byFileId(op.file_id);
    if (!entry) continue;
    const confirm = fs[Symbol.for('abele.sync.confirm-missing-v1')];
    if (confirm ? await confirm.call(fs, entry.path) : await fs.stat(entry.path) === null) continue;
    await state.setMeta('restored-delete-protection:' + entry.fileId,
      JSON.stringify({ entry, journalKey: journal.idempotencyKey }));
  }
}
// Keep replay batches small even on hosts where a time-based checkpoint is coarse.
function replayWork(options) {
  const work = new ScanWork(options);
  let remaining = 64;
  return {
    step() {
      if (--remaining === 0) {
        remaining = 64;
        return work.yield();
      }
      return work.step();
    }
  };
}
// An additive replay needs tracked restore evidence, not discovery of unrelated new files.
// Destructive, restored and review-pending work retains the complete inventory path.
async function additiveReplayEntries(fs, state, scheduling = {}) {
  if (!fs.listChildren || !state.getMeta) return null;
  const journal = await state.getJournal();
  if (!journal?.ops.length) return null;
  const work = replayWork(scheduling);
  for (const op of journal.ops) {
    const checkpoint = work.step();
    if (checkpoint) await checkpoint;
    if (!['create', 'modify'].includes(op.op) || op.prefer === 'mine') return null;
  }
  if (await state.getMeta('server-restore-reconciling')) return null;
  const raw = await state.getMeta('content-reconciliation');
  if (raw && JSON.parse(raw).phase !== 'complete') return null;
  const entries = [];
  for await (const entry of state.all()) {
    entries.push(entry);
    const checkpoint = work.step();
    if (checkpoint) await checkpoint;
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
      if (file.endsWith('/engine.js')) {
        code = replaceOnce(
          code,
          '            const report = await this.cycle.cycle();',
          `            const report = await this.cycle.cycle();
            const inventoryClock = this.opts.fs[Symbol.for('abele.sync.local-scan-revision-v1')];
            const inventoryRevision = this.cycle.inspectedLocalRevision;
            // Finish this pass even under continuous edits. Queue at most one
            // ordinary follow-up; the scheduler preserves pause/stop ownership.
            if (inventoryRevision !== undefined && inventoryRevision !== inventoryClock.call(this.opts.fs))
              this.trigger('inventory changed');`
        )
        code = replaceOnce(
          code,
          '    trigger(why) {',
          `    trigger(why) {
        // An active exchange already polls the remote head. The periodic timer
        // must not enqueue redundant reconciliation behind a long transfer.
        if (why === 'fallback' && this.running !== null) return;`
        )
        code = replaceOnce(
          code,
          '    /* ── Status ──────────────────────────────────────────────────────────── */',
          `    async [Symbol.for('abele.sync.fresh-inspection-v1')]() {
          // Idle is published before the run's final bookkeeping promise settles.
          // Drain that tail rather than queueing another cycle behind a completed proof.
          if (this.current.state === 'idle' && this.running !== null && this.queued === null)
            await this.running.catch(noop);
          if (this.running !== null || !this.started || this.paused || this.halted ||
              this.current.state !== 'idle' || this.current.lastError ||
              this.current.pending || this.current.deferred || this.current.heldDeletes) {
            this.log('sync: inspection proof unavailable ' + JSON.stringify({ running: this.running !== null, started: this.started, paused: this.paused, halted: this.halted, state: this.current.state, pending: this.current.pending, deferred: this.current.deferred, held: this.current.heldDeletes }));
            return false;
          }
          const poll = this.opts.fs[Symbol.for('abele.sync.inspect-polled-v1')];
          if (typeof poll !== 'function' || !await poll.call(this.opts.fs)) return false;
          if (!await this.cycle.freshInspection()) return false;
          const remote = this.opts.client[Symbol.for('abele.sync.inspect-remote-head-v1')];
          try {
            if (typeof remote !== 'function' ||
                !await remote.call(this.opts.client, this.current.cursor, this.cancellation.signal)) return false;
          } catch { return false; }
          return await this.cycle.freshInspection() && this.running === null &&
            this.current.state === 'idle' && !this.paused && !this.halted;
        }
    /* ── Status ──────────────────────────────────────────────────────────── */`
        )
        code = replaceOnce(
          code,
          'sync() {',
          `sync(reason = 'direct') {
          const caller = new Error().stack?.split('\\n').slice(2, 7).join(' <- ') ?? 'unknown';
          const request = reason + ' caller: ' + caller;
          (this.cycleRequests ??= []).push(request);
          this.log('sync: request ' + request + (this.running !== null ? ' (queued)' : ''));`
        )
        code = replaceOnce(
          code,
          'beginRun() {',
          `beginRun() {
          const requests = this.cycleRequests?.splice(0) ?? [];
          this.log('sync: cycle ' + (requests.map(request => request.split(' caller: ')[0]).join(', ') || 'internal') +
            ' caller: ' + (requests.join(' | ') || new Error().stack));`
        )
        code = replaceOnce(
          code,
          'this.log(`sync: ${why}`);\n        void this.sync().catch(noop);',
          'this.log(`sync: ${why}`);\n        void this.sync(why).catch(noop);'
        )
      } else if (file.endsWith('/watchReports.js')) {
        code = replaceOnce(
          code,
          `return (await fingerprintFile(this.ctx.fs, path, sha256)).sha;`,
          `const fresh = this.ctx.fs[Symbol.for('abele.sync.fingerprint-fresh-v1')];
            return (fresh ? await fresh.call(this.ctx.fs, path) : await fingerprintFile(this.ctx.fs, path, sha256)).sha;`
        )
      } else if (file.endsWith('/scope.js')) {
        code = replaceOnce(
          code,
          `            const entries = await this.entries(opts);
            const raw = this.state.getMeta ? await this.state.getMeta(SCOPE_KEY) : null;
            const previous = raw === null ? null : parseRecord(raw);`,
          `            const raw = this.state.getMeta ? await this.state.getMeta(SCOPE_KEY) : null;
            const previous = raw === null ? null : parseRecord(raw);
            // An unchanged host scope needs no constructor/start inventory. The cycle
            // still repairs every mark after preparing the server and before effects.
            if (opts.signal === undefined && previous !== null &&
                canonical(previous) === canonical(scope) &&
                this.state[Symbol.for('abele.sync.defer-unchanged-scope-v1')] === true)
              return;
            const entries = await this.entries(opts);`
        )
        code = replaceOnce(
          code,
          `record(fs, scope, filter, opts = {}) {
        return serially(this.state, async () => {`,
          `record(fs, scope, filter, opts = {}) {
        const run = async () => {`
        )
        code = replaceOnce(
          code,
          `            await this.state.setMeta?.(SCOPE_KEY, JSON.stringify(scope));
        });`,
          `            await this.state.setMeta?.(SCOPE_KEY, JSON.stringify(scope));
        };
        const pass = fs[Symbol.for('abele.sync.operation-pass-v1')];
        return serially(this.state, () => typeof pass === 'function' ? pass.call(fs, run) : run());`
        )
        code = replaceOnce(
          code,
          `return serially(this.state, () => this.reviewNow(fs, filter, opts));`,
          `const pass = fs[Symbol.for('abele.sync.operation-pass-v1')];
        return serially(this.state, () => typeof pass === 'function'
          ? pass.call(fs, () => this.reviewNow(fs, filter, opts)) : this.reviewNow(fs, filter, opts));`
        )
        code = replaceOnce(
          code,
          `async entries(opts) {
        const entries = [];`,
          `async entries(opts) {
        checkCancellation(opts.signal);
        const clock = this.state[Symbol.for('abele.sync.scope-state-revision-v1')];
        const revision = typeof clock === 'function' ? await clock.call(this.state) : undefined;
        if (revision !== undefined && this.scopeEntries?.revision === revision)
          return this.scopeEntries.rows;
        this.scopeEntries = undefined;
        const entries = [];`
        )
        code = replaceOnce(
          code,
          `        return entries;
    }
    /** Read afresh each time:`,
          `        if (revision !== undefined && revision === await clock.call(this.state))
          this.scopeEntries = { revision, rows: entries };
        return entries;
    }
    /** Read afresh each time:`
        )
      } else if (file.endsWith('/cycle.js')) {
        code = `import { heldDirectoryPaths } from './v2Directories.js';\n` + code
        code = replaceOnce(
          code,
          'await recoverPendingPullWrites(fs, state, await work.collect(pendingFiles), client, {\n            log,',
          'await recoverPendingPullWrites(fs, state, await work.collect(pendingFiles), client, {\n            filter: this.filter,\n            log,'
        )
        code = replaceOnce(
          code,
          '    async pull(dirty, recheck, noted) {',
          `    async pull(dirty, recheck, noted) {
        const restoreState = this.ctx.opts.state;
        const ownedRestores = JSON.parse(await restoreState.getMeta?.('held-restore-paths') ?? '[]');
        const restores = ownedRestores.filter(row => !this.filter.excluded(row.wirePath ?? row.path, row.size ?? 0));
        if (restores.length !== ownedRestores.length)
          await restoreState.setMeta?.('held-restore-paths', restores.length ? JSON.stringify(restores) : null);
        if (restores.length) {
          recheck = new Set([...(recheck ?? []), ...restores.map(row => row.fileId)]);
          // A restart between frontier publication and restore cleanup still owns
          // an unfinished snapshot. Resume its checkpoint or re-establish coverage.
          if (await restoreState.getCursor() > 0 && !await restoreState.getMeta?.('pull-manifest-progress')) {
            const outstanding = [];
            const restoreWork = new ScanWork({ signal: this.ctx.signal?.(), yieldTask: this.ctx.opts.yieldTask });
            for (const row of restores) {
              const checkpoint = restoreWork.step();
              if (checkpoint) await checkpoint;
              const entry = await restoreState.byFileId(row.fileId);
              if (!entry || await this.ctx.opts.fs.stat(entry.path) === null) outstanding.push(row);
            }
            if (outstanding.length) await restoreState.setCursor(0);
          }
        }`
        )
        code = replaceOnce(
          code,
          '        const inspection = await this.scanWork',
          `        if (reconciling || (priorReconciliation && priorReconciliation.phase !== 'complete')) {
          const beforeReview = await state.getMeta?.('v2-directories');
          await client[Symbol.for('abele.sync.review-directory-evidence-v1')]?.();
          const afterReview = await state.getMeta?.('v2-directories');
          if (beforeReview !== afterReview) {
            invalidateInventory();
            const retained = new Set((JSON.parse(afterReview ?? '{}').refused ?? []).map(row => row.path));
            for (const row of JSON.parse(beforeReview ?? '{}').refused ?? []) {
              if (!row.evidence || retained.has(row.path)) continue;
              await this.retries.succeeded(row.path, 'push');
              this.kept.delete(row.path);
            }
          }
        }
        const inspection = await this.scanWork`
        )
        code = replaceOnce(
          code,
          'const unresolved = this.retries.list().length > 0 ||',
          'const unresolved = found.complete === false || inspection.found.complete === false || this.retries.list().length > 0 ||'
        )
        // Only directory review may unblock an explicit additive restore early.
        // Ordinary bounded discovery retains its hold and queued decision until
        // complete; recursing there would reset the cold-file budget mid-sync.
        code = replaceOnce(
          code,
          "if (filed?.decision.kind === 'restore' && found.complete !== false)",
          `if (filed?.decision.kind === 'restore' && (found.complete !== false ||
            (!found[Symbol.for('abele.sync.discovery-pending-v1')] && found.skipped.length > 0 &&
              found.skipped.every(row => row.reason === 'directory move evidence is ambiguous') &&
              (await heldDirectoryPaths(state)).size > 0)))`
        )
        code = replaceOnce(
          code,
          'await client.prepare?.(fs, state,',
          `await client.prepare?.(fs[Symbol.for('abele.sync.local-scan-revision-v1')]?.() !== undefined ? scanningFs : fs, state,`
        )
        code = replaceOnce(
          code,
          '    async countStaged() {',
          `    async freshInspection() {
          const { fs, state } = this.ctx.opts;
          const local = fs[Symbol.for('abele.sync.local-scan-revision-v1')];
          const epoch = fs[Symbol.for('abele.sync.watch-epoch-v1')]?.();
          const age = this.ctx.now() - this.settledInspectionAt;
          if (typeof local !== 'function' || !Number.isFinite(age) || age < 0 || age >= 300_000 ||
              this.settledLocalRevision === undefined || this.settledEntryRevision === undefined ||
              epoch === undefined || epoch !== this.settledWatchEpoch ||
              this.unscanned || this.rewind || !this.ctx.watching() ||
              this.ctx.watch.noticed.size || this.ctx.watch.reported.size ||
              this.kept.size || this.unsettled.size || this.retries.list().length ||
              local.call(fs) !== this.settledLocalRevision) {
            this.ctx.log('sync: inspection proof unavailable ' + JSON.stringify({ age, local: typeof local === 'function' ? local.call(fs) : undefined, settled: this.settledLocalRevision, unscanned: this.unscanned, rewind: this.rewind, watching: this.ctx.watching(), noticed: this.ctx.watch.noticed.size, reported: this.ctx.watch.reported.size, kept: this.kept.size, unsettled: this.unsettled.size, retries: this.retries.list().length }));
            return false;
          }
          const entry = await state[Symbol.for('abele.sync.local-scan-state-revision-v1')]?.();
          const directories = await state.getMeta?.('v2-directories');
          return entry === this.settledEntryRevision && directories === this.settledDirectoryRevision &&
            local.call(fs) === this.settledLocalRevision && epoch === fs[Symbol.for('abele.sync.watch-epoch-v1')]?.() &&
            this.ctx.watch.noticed.size === 0 && this.ctx.watch.reported.size === 0;
        }
    async countStaged() {`
        )
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
        // Incoming writes before inspection are already part of this inventory.
        this.inspectedLocalRevision = localRevision;
        const entryRevision = await state[Symbol.for('abele.sync.local-scan-state-revision-v1')]?.();
        const directoryRevision = await state.getMeta?.('v2-directories');
        const waiting = this.retries.list();
        const inspectionAge = this.ctx.now() - this.settledInspectionAt;
        const unchanged = localRevision !== undefined && entryRevision !== undefined &&
          Number.isFinite(inspectionAge) && inspectionAge >= 0 && inspectionAge < 300_000 &&
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
          `        // A directory commit can advance the consumed feed beyond the file batch head.
        this.ctx.set({ headSeq: Math.max(this.ctx.status().headSeq ?? 0, (secondPull ?? before).cursor) });
        // A stable inventory clock says nothing about cold files deferred by a
        // bounded scan. Policy holds have their own retries; unread content must
        // remain discoverable on the next ordinary pass.
        const settledScan = result => !result[Symbol.for('abele.sync.discovery-pending-v1')] &&
          result.skipped.every(skipped => this.retries.list().some(row =>
            row.path === skipped.path.normalize('NFC') && row.phase === 'push' &&
            !row.local && row.reason.startsWith('too_large:')));
        if (settledScan(found) && settledScan(inspection.found) &&
            localRevision !== undefined && localRevision === fs[Symbol.for('abele.sync.local-scan-revision-v1')]?.() &&
            this.ctx.watch.noticed.size === 0 && this.ctx.watch.reported.size === 0 &&
            !client[Symbol.for('abele.sync.deferred-directory-deletes-v1')]?.()) {
          this.settledDirectoryRevision = await state.getMeta?.('v2-directories');
          this.settledLocalRevision = localRevision;
          this.settledWatchEpoch = fs[Symbol.for('abele.sync.watch-epoch-v1')]?.();
          this.settledEntryRevision = await state[Symbol.for('abele.sync.local-scan-state-revision-v1')]?.();
          this.settledCollisions = found.collisions;
          // Only an ordinary inspection renews the deadline. Frequent feed/idle cycles
          // cannot extend trust in watcher coverage; a backwards clock expires it too.
          this.settledInspectionAt = this.ctx.now();
        }
        return {
            pull: before,`
        )
        // A child delete ACK removes the guard which deferred its parent earlier
        // in this cycle. Finish that work before the ordinary post-push pull.
        code = replaceOnce(
          code,
          '        await this.staging.afterPush(judged);',
          `        await this.staging.afterPush(judged);
        const completingParents = !this.ctx.stopping() && pushed.committed !== null &&
          client[Symbol.for('abele.sync.deferred-directory-deletes-v1')]?.();
        if (completingParents) {
          this.ctx.log('sync: finishing deferred parent deletions after child acknowledgements');
          await client.syncDirectories?.();
        }`
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
          this.inspectedLocalRevision = undefined;
          const priorSettledLocalRevision = this.settledLocalRevision;
          const priorSettledEntryRevision = this.settledEntryRevision;
          // Failure/cancellation cannot leave an earlier pass's proof reusable.
          this.settledLocalRevision = undefined;
          this.settledEntryRevision = undefined;`
        )
      } else if (file.endsWith('/scanSnapshot.js')) {
        code = replaceOnce(
          code,
          'const snapshots = new Map();',
          'const snapshots = new Map();\n    let revision;'
        )
        code = replaceOnce(
          code,
          'let snapshot = snapshots.get(key);',
          `const clock = fs[Symbol.for('abele.sync.local-scan-revision-v1')];
                    const current = typeof clock === 'function' ? clock.call(fs) : undefined;
                    if (revision !== current) { snapshots.clear(); revision = current; }
                    let snapshot = snapshots.get(key);`
        )
        code = replaceOnce(
          code,
          'for (const item of await snapshot) {',
          `const rows = await snapshot;
                    if (current !== (typeof clock === 'function' ? clock.call(fs) : undefined)) {
                      snapshots.clear();
                    }
                    for (const item of rows) {`
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
      } else if (file.endsWith('/deleteGate.js')) {
        code = replaceOnce(
          code,
          '        let dropped = 0;',
          `        // Keep file identities as durable directory-absence proof until
        // the manifest records their replacement receipts. Retiring ledger entries
        // must not turn their still-populated remote parent into an empty folder.
        const restoringFiles = new Map(JSON.parse(await this.ctx.state.getMeta?.('held-restore-paths') ?? '[]')
          .map(row => [row.fileId, row]));
        for (const fileId of decision.fileIds) {
          const checkpoint = work.step();
          if (checkpoint) await checkpoint;
          const entry = await this.ctx.state.byFileId(fileId);
          if (entry && await this.ctx.fs.stat(entry.path) === null)
            restoringFiles.set(fileId, { fileId, path: entry.path, wirePath: entry.wirePath, size: entry.size });
        }
        if (restoringFiles.size)
          await this.ctx.state.setMeta?.('held-restore-paths', JSON.stringify([...restoringFiles.values()]));
        let dropped = 0;`
        )
        // Restoring held files explicitly chooses their original source paths.
        // An older directory-move nomination must not keep that replay blocked.
        code = replaceOnce(
          code,
          '        // Only the files decided about leave the hold;',
          `        const selected = new Set(decision.fileIds);
        const restoring = new Set();
        for (const held of await this.ctx.holds.list()) {
          const checkpoint = work.step();
          if (checkpoint) await checkpoint;
          if (selected.has(held.fileId) && await this.ctx.fs.stat(held.path) === null) {
            let parent = held.path;
            while (parent.includes('/')) {
              parent = parent.slice(0, parent.lastIndexOf('/'));
              restoring.add(parent);
            }
          }
        }
        const rawDirectories = await this.ctx.state.getMeta?.('v2-directories');
        if (rawDirectories && restoring.size) {
          const directories = JSON.parse(rawDirectories);
          const sources = new Set();
          for (const row of directories.refused ?? []) {
            const checkpoint = work.step();
            if (checkpoint) await checkpoint;
            const source = row.source ?? row.path;
            if (row.evidence && restoring.has(source))
              sources.add(source);
          }
          if (sources.size) {
            directories.refused = await work.collect(directories.refused ?? [], row =>
              !row.evidence || !sources.has(row.source ?? row.path));
            await this.ctx.state.setMeta('v2-directories', JSON.stringify(directories));
            this.ctx.log('sync: resolving directory move evidence for held-file restoration');
          }
        }
        // Only the files decided about leave the hold;`
        )
        // The SDK drives delete judging cooperatively; only skip an empty ledger pass.
        code = replaceOnce(
          code,
          'for await (const entry of this.ctx.state.all())',
          'if (ops.length) for await (const entry of this.ctx.state.all())'
        )
      } else if (file.endsWith('/pullRun.js')) {
        code = replaceOnce(
          code,
          '    async changeRefusal(change) {',
          `    async changeRefusal(change) {
        if (change.op !== 'delete' && this.fs.pathKey) {
          const occupant = await pathOccupant(this.fs, this.state, change.path, change.file_id);
          if (occupant && occupant.fileId !== change.file_id && occupant.path !== change.path)
            return { code: 'invalid_path', message: 'unsupported-host-name: Name collides with ' + occupant.path };
        }`
        )
        code = replaceOnce(
          code,
          '        if (wanted.length === 0)\n            return;',
          `        this.restoreTombstones ??= new Set();
        for (const change of wanted) {
          if (change.sha === null || change.op === 'delete') this.restoreTombstones.add(change.file_id);
          else this.restoreTombstones.delete(change.file_id);
        }
        if (wanted.length === 0)
            return;`
        )
        code = replaceOnce(
          code,
          `        if (this.opts.protectMissing && (await this.state.getMeta?.('pull-rewind-frontier')) != null)
            await this.state.setMeta?.('pull-rewind-frontier', null);
        this.syncHeld();`,
          `        if (this.opts.protectMissing && (await this.state.getMeta?.('pull-rewind-frontier')) != null)
            await this.state.setMeta?.('pull-rewind-frontier', null);
        const restores = JSON.parse(await this.state.getMeta?.('held-restore-paths') ?? '[]');
        if (restores.length) {
          const pending = [], restoreWork = new ScanWork({ ...scanScheduling(this.state), signal: this.opts.signal });
          for (const row of restores) {
            const checkpoint = restoreWork.step();
            if (checkpoint) await checkpoint;
            const entry = await this.state.byFileId(row.fileId);
            const restored = entry && await this.fs.stat(entry.path) !== null;
            const gone = this.inventoryComplete &&
              ((this.report.bootstrapped && !this.seen.has(row.fileId)) || this.restoreTombstones?.has(row.fileId));
            if (!restored && !gone) pending.push(row);
          }
          if (pending.length !== restores.length)
            await this.state.setMeta?.('held-restore-paths', pending.length ? JSON.stringify(pending) : null);
        }
        this.syncHeld();`
        )
        code = replaceOnce(
          code,
          '            if (base)\n                bases.push(base);',
          `            if (base && !this.passedOver(change) &&
                !this.opts.filter.excluded(base.wirePath ?? base.path, base.size))
                bases.push(base);`
        )
        // The pinned SDK already imports ScanWork and scanScheduling.
        code =
          `import { PendingPullWrites } from './pullWrite.js';\nimport { notifyApplied } from './applied.js';\n` +
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
          `const local = this.opts.nativeBatchLocal ?? await shaIndex(this.state);
        // Each page has a fresh committed source index. Share it rather than
        // retaining the previous page's hints or copying the inventory again.
        // Reuse still fingerprints the current source before publication.
        this.placer.initialLocal = local;`
        )
        // The plugin prefetches small streamed bodies too. Count those bytes even
        // when the host has no conditionalFile or the budget is smaller than a chunk.
        code = replaceOnce(
          code,
          '(!this.fs.conditionalFile || (change.size ?? 0) > Math.min(MAX_CHUNK_BYTES, budget))',
          '(budget === 0 || (change.size ?? 0) > MAX_CHUNK_BYTES)'
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
        let ordinary = code
          .slice(ordinaryStart, ordinaryEnd)
          .replace(
            'this.opts.prefetchBytes ?? DEFAULT_PREFETCH_BYTES',
            'this.opts.prefetchBytes ?? Math.min(DEFAULT_PREFETCH_BYTES, 8 * 1024 * 1024)'
          )
        ordinary = replaceOnce(
          ordinary,
          '                    await finish(change);',
          `                    // Settlement has published the ledger. Keep only a source hint;
                    // localCandidate fingerprints it again before any later reuse.
                    const remaining = (remainingSources.get(change.sha) ?? 1) - 1;
                    if (remaining) remainingSources.set(change.sha, remaining);
                    else remainingSources.delete(change.sha);
                    if (report.applied && change.sha !== null && remaining > 0) {
                      const installed = await this.state.byFileId(change.file_id);
                      if (installed?.sha === change.sha) {
                        local.set(change.sha, installed);
                        this.placer.initialLocal?.set(change.sha, installed);
                      }
                    }
                    await finish(change);`
        )
        code =
          code.slice(0, ordinaryStart) +
          '        await this.placeTaking(taking, local, finish);' +
          code.slice(ordinaryEnd)
        code = replaceOnce(
          code,
          '    async retryFailure',
          `    async placeTaking(taking, local, finish) {
        // Retain new source hints only for repeated content, not every installed file.
        const remainingSources = new Map();
        const sourceWork = new ScanWork({ ...scanScheduling(this.state), signal: this.opts.signal });
        for (const change of taking) {
          const pause = sourceWork.step();
          if (pause) await pause;
          if (change.sha !== null)
            remainingSources.set(change.sha, (remainingSources.get(change.sha) ?? 0) + 1);
        }
${ordinary}\n    }\n    async retryFailure`
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
            // Cohort staging cannot replay a public local source. Keep local
            // content on the ordinary verified reuse path instead of fetching it.
            if (group.some(change => local.has(change.sha)))
              return this.placeTaking(group, local, finish);
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
            } } catch (error) {
              console.debug('[abele-sync] native cohort preflight unavailable', { files: group.length, error });
              eligible = false;
            }
            if (!eligible) return split();
            // Preserve rollback identity through the host's placement/error boundary.
            const notifications = [], refused = new Error('Native cohort requires ordinary placement');
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
                      report.applied + report.skipped !== group.length) {
                    console.debug('[abele-sync] native cohort requires ordinary placement', {
                      files: group.length, report,
                    });
                    throw refused;
                  }
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
          // Sources are hints only; reuse always verifies their current bytes.
          this.placer.initialLocal ??= new Map(local);
          // Absence belongs to this batch: a later page may move the same id to local bytes.
          this.placer.adoptionCandidates = new Map();
          if (this.fs.beginAtomicWrite && this.fs.reopenStage && this.client.openVersion) {
            const wanted = [];
            const wantedHashes = new Set();
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
              // Every destination observation may discover a concurrent local write.
              // Deduplicate only the network work, after those live checks.
              if (wantedHashes.has(change.sha)) continue;
              wanted.push(change);
              wantedHashes.add(change.sha);
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
          'export async function retentionSnapshot(fs, options = {}) {',
          'export async function prepareRemovalCohort(fs, items, options = {}) {',
          'export async function retainRemovals(fs, operations, options = {}) {',
          'export async function prepareCaptureCohort(fs, state, bases, policy = {}) {',
          'export async function retainRemoval(fs, op, options = {}) {',
          'export async function captureRemoval(fs, state, base, authorize, now, capturedIdentity, expected = base, signal, cohort) {',
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
        code = `import { heldDirectoryPaths } from './v2Directories.js';\n` + code
        code = replaceOnce(
          code,
          '        await tx.setMeta(`reconciliation-journal:${journal.idempotencyKey}`, JSON.stringify(journal));',
          `        await protectRestoredJournalDeletes(fs, tx, journal);
        await tx.setMeta(\`reconciliation-journal:\${journal.idempotencyKey}\`, JSON.stringify(journal));`
        )
        code = replaceOnce(
          code,
          'if (active && found.skipped.length > 0)',
          `// A deliberate directory barrier is review-pending work, not failed I/O.
    // Its subtree remains excluded from scans and refused by every pull placement.
    const directoryHolds = active && found.skipped.length ? await heldDirectoryPaths(state) : new Set();
    if (active && found.skipped.some(row => row.reason !== 'directory move evidence is ambiguous' ||
        !directoryHolds.has(row.path)))`
        )
        code = replaceOnce(
          code,
          'for await (const info of fs.list()) {\n        const checkpoint = work.step();\n        if (checkpoint)\n            await checkpoint;\n        disk.set(info.path, info);\n    }',
          `const replayEntries = retiredEntries ? null : await additiveReplayEntries(fs, state, scheduling);
    if (replayEntries === null) {
      for await (const info of fs.list()) {
        const checkpoint = work.step();
        if (checkpoint) await checkpoint;
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
          'const cached = fresh ? null : await readScanHint(state, info, epoch);',
          `const hostHash = !fresh && changed ? await fs[Symbol.for('abele.sync.cached-scan-hash-v1')]?.(info.path) : null;
          const cached = fresh ? null : hostHash?.size === info.size && hostHash?.mtime === info.mtime
            ? hostHash.sha : await readScanHint(state, info, epoch);`
        )
        code = replaceOnce(
          code,
          'if (!selected.has(path) && !changed)',
          'if (!changed && (!selected.has(path) || (!proofRequired && await pairedBaseline(fs, state, entry))))'
        )
        code = replaceOnce(
          code,
          'const fingerprint = cached !== null',
          'const beforeIdentity = await fs.fileIdentity?.(info.path);\n                const fingerprint = cached !== null'
        )
        code = replaceOnce(
          code,
          'found.hashes.set(path, fingerprint.sha);',
          'if (cached === null) await recordPaired(fs, state, info.path, info, fingerprint.sha, beforeIdentity);\n                found.hashes.set(path, fingerprint.sha);'
        )
      } else if (file.endsWith('/scanner.js')) {
        // A read/list race is ordinary per-file retry work even when its error
        // was generated by the scanner rather than tagged by the filesystem.
        code = replaceOnce(
          code,
          "            if (isFileFailure(error))\n                await opts.retries?.failed(wirePath, 'scan', error);",
          "            await opts.retries?.failed(wirePath, 'scan', error);"
        )
        // Keep discovery incompleteness distinct from directory-only review.
        // The private non-enumerable observation does not change the public scan image.
        code = replaceOnce(
          code,
          `    return { ops, hashes, diskPaths, infos, verified, dirty, skipped, collisions,
        complete: !unreadCandidate && skipped.length === 0 };`,
          `    const result = { ops, hashes, diskPaths, infos, verified, dirty, skipped, collisions,
        complete: !unreadCandidate && skipped.length === 0 };
    Object.defineProperty(result, Symbol.for('abele.sync.discovery-pending-v1'), { value: unreadCandidate });
    return result;`
        )
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
          `const fingerprint = opts.revalidate === 'all'
                    ? await freshFingerprintFile(fs, info.path, hash, opts.signal)
                    : typeof opts.revalidate === 'number' && revalidate.has(wirePath)
                        ? await sweepFingerprintFile(fs, info.path, info.size, hash, opts.signal)
                        : await fingerprintFile(fs, info.path, hash, opts.signal);`,
          `const beforeIdentity = await fs.fileIdentity?.(info.path);
            const proof = opts.revalidate === 'all' || opts.verifyPaths?.has(wirePath);
            const cached = !proof && !recreatedPaths.has(wirePath) && !revalidate.has(wirePath)
              ? await fs[Symbol.for('abele.sync.cached-scan-hash-v1')]?.(info.path) : null;
            const fingerprint = proof ? await freshFingerprintFile(fs, info.path, hash, opts.signal)
              : revalidate.has(wirePath) ? await sweepFingerprintFile(fs, info.path, info.size, hash, opts.signal)
              : cached ?? await fingerprintFile(fs, info.path, hash, opts.signal);
            if (!opts.readOnly) await recordPaired(fs, state, info.path, info, fingerprint.sha, beforeIdentity);`
        )
      } else if (file.endsWith('/localPaths.js')) {
        code = replaceOnce(
          code,
          '    const work = new ScanWork(opts);\n    const inventory =',
          '    const work = replayWork(opts);\n    const inventory ='
        )
        code = replaceOnce(
          code,
          '    static async forPath(fs, path, state) {',
          `    static async forPath(fs, path, state) {
        // A sibling may create a parent between index absence and live lstat.
        // Retry only a read-only collision against a changed host revision; all
        // physical spelling and identity checks run again before any effect.
        const revision = fs[Symbol.for('abele.sync.local-change-revision-v1')];
        const before = revision?.call(fs);
        try { return await LocalPaths.forPathOnce(fs, path, state); }
        catch (error) {
          if (!(error instanceof AbeleError) || error.code !== 'path_taken' ||
              before === undefined || revision.call(fs) === before) throw error;
          return LocalPaths.forPathOnce(fs, path, state);
        }
    }
    static async forPathOnce(fs, path, state) {`
        )
        code = replaceOnce(
          code,
          'const inventory = await LocalPaths.read(fs, state, opts);\n    await inventory.rememberDirectories(state, opts);',
          `const replayEntries = await additiveReplayEntries(fs, state, opts);
    const inventory = replayEntries === null ? await LocalPaths.read(fs, state, opts) : new LocalPaths();
    if (replayEntries === null) await inventory.rememberDirectories(state, opts);
    else {
      const read = new Set();
      const work = replayWork(opts);
      for (const entry of replayEntries) {
        const checkpoint = work.step();
        if (checkpoint) await checkpoint;
        const segments = wirePath(entry.wirePath).split('/');
        let parent = '';
        for (let n = 0; n < segments.length; n++) {
          const candidateKey = JSON.stringify([parent, segments[n]]);
          if (!read.has(parent) && !read.has(candidateKey)) {
            // Indexed buckets include every canonical alias. Unsupported paths
            // retain complete physical sibling enumeration and collision checks.
            const candidates = await fs.trustedPathCandidates?.lookup(parent, segments[n]);
            for (const child of candidates ?? await fs.listChildren(parent)) {
              inventory.add(child);
              const checkpoint = work.step();
              if (checkpoint) await checkpoint;
            }
            read.add(candidates === undefined ? parent : candidateKey);
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
          'const children = candidates ?? (await fs.listChildren(parent));',
          // An indexed port's undefined answer requires the physical fallback, not
          // another host-index shortcut. Hosts without the port keep their existing path.
          'const children = candidates ?? (await (indexed ? fs.listChildren(parent) : inventoryChildren(fs, parent, path)));'
        )
      } else if (file.endsWith('/pullPlace.js')) {
        code = replaceOnce(
          code,
          '    async refusal(change, entry) {',
          `    async refusal(change, entry) {
        if (change.op !== 'delete' && this.fs.pathKey) {
          const occupant = await pathOccupant(this.fs, this.state, change.path, change.file_id);
          if (occupant && occupant.fileId !== change.file_id && occupant.path !== change.path)
            return { code: 'invalid_path', message: 'unsupported-host-name: Name collides with ' + occupant.path };
        }`
        )
        code = replaceOnce(
          code,
          '    async drop(entry, change) {',
          `    async drop(entry, change) {
        const restoredProtection = await this.state.getMeta?.('restored-delete-protection:' + entry.fileId);
        if (restoredProtection && JSON.parse(restoredProtection).entry.versionId === entry.versionId) {
          const confirm = this.fs[Symbol.for('abele.sync.confirm-missing-v1')];
          if (!(confirm ? await confirm.call(this.fs, entry.path) : await this.fs.stat(entry.path) === null)) {
            if (change && (change.op === 'delete' || change.sha === null)) {
              if (await this.pending.refused(entry.fileId, [change.path, change.prev_path], entry)) return false;
              await this.settlement();
              let kept = false;
              await commitAppliedSettlement(this.state, async () => ({ reached: await this.state.getCursor(), firstUnresolved: null }), async tx => {
                const current = await tx.byFileId(entry.fileId);
                if (current?.path !== entry.path || current.versionId !== entry.versionId ||
                    await tx.getMeta?.('restored-delete-protection:' + entry.fileId) !== restoredProtection) return;
                if (await new PendingPullWrites(tx, this.fs, this.sequenceKnown, this.client).refused(entry.fileId, [change.path, change.prev_path], entry)) return;
                // Acknowledge the old identity's tombstone without touching disk.
                // The restored bytes become an ordinary create, durably surviving
                // a crash before the scanner or uploader can run.
                await tx.delete(entry.path);
                await recordPull(tx, change, true);
                await tx.setMeta?.(scanHintKey(entry.path), null);
                await new PendingPullWrites(tx, this.fs, this.sequenceKnown, this.client).clear(entry.fileId);
                await tx.setMeta?.('restored-delete-protection:' + entry.fileId, null);
                kept = true;
              });
              if (kept) this.opts.log?.('pull: keeping restored file for upload: ' + entry.wirePath);
              return kept;
            }
            this.opts.log?.('pull: holding deletion of a restored file for review: ' + entry.wirePath);
            return false;
          }
        }`
        )
        code = replaceOnce(
          code,
          '            await tx.delete(entry.path);\n            await commitRemoval(tx, entry, this.fs);',
          `            await tx.delete(entry.path);
            await tx.setMeta?.('restored-delete-protection:' + entry.fileId, null);
            await commitRemoval(tx, entry, this.fs);`
        )
        code = replaceOnce(
          code,
          '            if (this.sequenceKnown)\n                await recordPull(tx, change);',
          `            // The receipt ends this file's restore authority in the same
            // durable transaction. Later offline deletion is a new local intent.
            const restores = JSON.parse(await tx.getMeta?.('held-restore-paths') ?? '[]');
            const pendingRestores = restores.filter(row => row.fileId !== change.file_id);
            if (pendingRestores.length !== restores.length)
              await tx.setMeta?.('held-restore-paths', pendingRestores.length ? JSON.stringify(pendingRestores) : null);
            if (this.sequenceKnown)
                await recordPull(tx, change);`
        )
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
          'const have = verifiedObservation?.size',
          'const beforeIdentity = await this.fs.fileIdentity?.(target);\n        const have = verifiedObservation?.size'
        )
        code = replaceOnce(
          code,
          'if (this.sequenceKnown)\n                await recordPull(tx, change);',
          'await recordPaired(this.fs, tx, target, have, sha, beforeIdentity);\n            if (this.sequenceKnown)\n                await recordPull(tx, change);'
        )
        code =
          `import { settledStat } from './apply.js';\nimport { receiveToStage as receivePlacementSource } from './streaming.js';\n` +
          code
        code = replaceOnce(
          code,
          '            : wrote;',
          '            : await settledPlacementStat(this.fs, target, sha, wrote, this.hash);'
        )
        code += `
        async function fingerprintPlacementFile(fs, path, hash, expected) {
          return pullFingerprintFile(fs, path, expected, hash);
        }
        async function settledPlacementStat(fs, path, sha, wrote, hash) {
          const receipt = await fs[Symbol.for('abele.sync.written-stat-v1')]?.(path, wrote);
          if (receipt) return receipt;
          return settledStat(fs, path, sha, wrote, hash);
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
          `if (entry !== null && (await this.edited(entry, target))) {
            // A recreated source still needs its original ledger so scan can classify
            // the offline move and the independent create. Do not split that evidence.`,
          `if (pending && !pending.stageId && this.fs[Symbol.for('abele.sync.recover-published-pull-v1')] && this.fs.reopenStage && this.client.openVersion && change.size !== null) {
          if (from !== null && beforeFrom !== null && caseKey(from) !== caseKey(target) &&
              (!pending.sourceIdentity || await this.fs.fileIdentity?.(from) !== pending.sourceIdentity)) return false;
          return this.streamPlace(change, sha, entry, target, from, firstTarget, beforeFrom, local);
        }
        if (entry !== null && (await this.edited(entry, target))) {
            // A recreated source still needs its original ledger so scan can classify
            // the offline move and the independent create. Do not split that evidence.`
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
          'async localSource(sha, local, size, verifyKnown = true) {',
          `async localSource(sha, local, size, verifyKnown = true) {
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
              await this.pending.matching(change, entry) !== null) return false;
              if (entry && entry.wirePath === change.path &&
                  (entry.sha !== change.sha || entry.size !== change.size) &&
                  await this.fs.verifiedInstallation?.(entry.path, entry)) return false;`
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
              const have = await fingerprintPlacementFile(this.fs, path, this.hash, { sha, size });
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
          try { return (await fingerprintPlacementFile(this.fs, target, this.hash, entry)).sha !== entry.sha; }
          catch { return true; }
        }
        async destinationMatches(path, sha, size, base) {
          try {
            const there = await this.fs.stat(path);
            if (!there || there.size !== size) return false;
            const known = base ?? await this.state.get(path);
            if (known && (known.sha !== sha || known.size !== size) &&
                await this.fs.verifiedInstallation?.(path, known)) return false;
            const have = await fingerprintPlacementFile(this.fs, path, this.hash, { sha, size });
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
              await this.destinationMatches(change.path, sha, change.size, entry))
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
                const have = await fingerprintPlacementFile(this.fs, candidate.path, this.hash, { sha, size: change.size });
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
        code = replaceOnce(
          code,
          'filter: { excluded: () => false },',
          'filter: opts.filter ?? { excluded: () => false },'
        )
        code = replaceOnce(
          code,
          '            const intent = decodePullIntent(raw, fileId);',
          `            const intent = decodePullIntent(raw, fileId);
            // Exclusion removes publication authority, not ownership of private
            // bytes. Keep the exact stage and intent for a later included run.
            if (opts.filter?.excluded(intent.wirePath, intent.size) ||
                opts.filter?.excluded(intent.target, intent.size)) continue;`
        )
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
                await recoverPendingPullWrites(fs, state, [fileId], client, opts);
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
        // Scan source indexing is lazy and cooperative in the SDK.
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
        // A saved batch is not evidence that its commit was sent. Persist the
        // publication phase separately from upload preparation, under the same key.
        code = replaceOnce(
          code,
          '        await this.state.setJournal(journal);\n        await this.upload(ops, sources);',
          `        const publicationKey = 'push-publication:' + key;
        let publication = startedAt === undefined ? { phase: 'prepared' } :
          JSON.parse(await this.state.getMeta(publicationKey) ?? '{"phase":"uncertain"}');
        if (startedAt === undefined) await transact(this.state, async tx => {
          await tx.setMeta(publicationKey, JSON.stringify(publication));
          await tx.setJournal(journal);
        });
        if (publication.phase !== 'prepared' && publication.ops && JSON.stringify(publication.ops) !== JSON.stringify(ops))
          throw new EngineError('protocol', 'push publication does not match its journal');
        const retireRestoredDeletion = async () => {
          if (publication.phase === 'prepared' || publication.outcome) return false;
          for (const op of ops) if (op.op === 'delete') {
            const entry = await this.state.byFileId(op.file_id);
            const confirm = this.fs[Symbol.for('abele.sync.confirm-missing-v1')];
            if (entry && (confirm ? await confirm.call(this.fs, entry.path) : await this.fs.stat(entry.path) === null)) continue;
            // An old key could publish for the first time. Retire the whole immutable
            // request, preserving its evidence, and reconcile current server/disk state
            // rather than replaying it or blocking unrelated work indefinitely.
            const reason = 'uncertain deletion has a restored path; reconciling current state';
            await transact(this.state, async tx => {
              await protectRestoredJournalDeletes(this.fs, tx, journal);
              await requestReconciliation(tx, reason);
              await tx.setMeta('reconciliation-journal:' + key, JSON.stringify(journal));
              await tx.setMeta('reconciliation-publication:' + key, JSON.stringify(publication));
              await tx.setJournal(null);
              await tx.setMeta(publicationKey, null);
            });
            this.opts.log?.('push: ' + reason);
            if (entry) this.report.kept.push(entry.wirePath);
            this.report.reconciliationRequired = true;
            return true;
          }
          return false;
        };
        if (await retireRestoredDeletion()) return;
        if (!publication.outcome) await this.upload(ops, sources);
        if (await retireRestoredDeletion()) return;`
        )
        code = replaceOnce(
          code,
          '        const sending = await this.sendable(ops, false);',
          `        const candidates = publication.phase === 'prepared' ? await this.sendable(ops, false) : ops;
        const sending = [];
        for (const op of candidates) {
          if (publication.phase === 'prepared' && op.op === 'delete') {
            const entry = await this.state.byFileId(op.file_id);
            const confirm = this.fs[Symbol.for('abele.sync.confirm-missing-v1')];
            const absent = entry && entry.versionId === op.base_version_id &&
              (confirm ? await confirm.call(this.fs, entry.path) : await this.fs.stat(entry.path) === null);
            if (!absent) {
              this.opts.log?.('push: holding deletion whose path is no longer confirmed missing');
              if (entry) this.report.kept.push(entry.wirePath);
              continue;
            }
          }
          sending.push(op);
        }`
        )
        code = replaceOnce(
          code,
          '        if (sending.length !== ops.length)\n            await this.state.setJournal({ ...journal, ops: sending });',
          `        if (publication.phase === 'prepared') {
          publication = { phase: 'uncertain', ops: sending };
          await transact(this.state, async tx => {
            await tx.setJournal({ ...journal, ops: sending });
            await tx.setMeta(publicationKey, JSON.stringify(publication));
          });
        }`
        )
        code = replaceOnce(
          code,
          '            outcome = await this.client.commitRaw(sending, key);',
          `            outcome = publication.outcome ?? await this.client.commitRaw(sending, key);
            // Save the receipt before any local verdict work. A crash after this
            // point settles the receipt without another destructive publication.
            await this.state.setMeta(publicationKey, JSON.stringify({ ...publication, outcome }));`
        )
        code = replaceOnce(
          code,
          `        if (sending.length === 0) {
            await this.state.setJournal(null);`,
          `        if (sending.length === 0) {
            await transact(this.state, async tx => {
              await tx.setJournal(null);
              await tx.setMeta(publicationKey, null);
            });`
        )
        code = replaceOnce(
          code,
          `            await this.state.setJournal(null);
            return;
        }
        this.report.committed`,
          `            await transact(this.state, async tx => {
              await tx.setJournal(null);
              await tx.setMeta(publicationKey, null);
            });
            return;
        }
        this.report.committed`
        )
        // The SDK yields during source indexing and unchanged-entry refresh.
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
                  await tx.setMeta(publicationKey, null);
                }
            }), preservationPaths);
            for (const change of applied.splice(0)) await notifyApplied(this.opts, change);
            if (interrupted) break;
          }`
        )
      } else if (file.endsWith('/v2Directories.js')) {
        code = replaceOnce(
          code,
          '    async scan() {',
          '    async scan(reviewOnly = false) {\n        this.deferredDeletion = false;'
        )
        // Recovery can corroborate a tree restored at its original path without
        // replaying or publishing directory operations while reconciliation waits.
        code = replaceOnce(
          code,
          '        let doc = await this.read();\n        if (await this.retireRecreatedDelete(doc))',
          `        let doc = await this.read();
        const restoringFiles = JSON.parse(await this.state.getMeta('held-restore-paths') ?? '[]');
        if (restoringFiles.length) {
          const restoreWork = new ScanWork({ ...scanScheduling(this.state), signal: this.signal });
          const pendingRestores = [];
          for (const row of restoringFiles) {
            const checkpoint = restoreWork.step();
            if (checkpoint) await checkpoint;
            const entry = await this.state.byFileId(row.fileId);
            if (!entry || await this.fs.stat(entry.path) === null) pendingRestores.push(row);
          }
          if (pendingRestores.length !== restoringFiles.length)
            await this.state.setMeta('held-restore-paths', pendingRestores.length ? JSON.stringify(pendingRestores) : null);
          if (pendingRestores.length) { this.deferredDeletion = true; return; }
        }
        if (reviewOnly && (doc.pending || !doc.refused?.some(row => row.evidence))) return;
        if (await this.retireRecreatedDelete(doc))`
        )
        code = replaceOnce(
          code,
          'if (doc.incoming?.length) {',
          'if (!reviewOnly && doc.incoming?.length) {'
        )
        code = replaceOnce(
          code,
          '...evidenceRows.values()];',
          '...(reviewOnly ? previousEvidence : evidenceRows.values())];'
        )
        code = replaceOnce(
          code,
          '            const retained = doc.refused;',
          `            if (reviewOnly && (!moved || wirePath(moved.path) !== old.path)) continue;
            const retained = doc.refused;`
        )
        code = replaceOnce(
          code,
          '        const published = new Set(doc.directories.map((dir) => dir.path));',
          `        if (reviewOnly) return;
        const published = new Set(doc.directories.map((dir) => dir.path));`
        )

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
              if (children) { this.deferredDeletion = true; continue; }
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
          '    syncDirectories() {',
          `    [Symbol.for('abele.sync.review-directory-evidence-v1')]() {
          return this.directories?.scan(true);
        }
    [Symbol.for('abele.sync.deferred-directory-deletes-v1')]() {
          return this.directories?.deferredDeletion === true;
        }
    syncDirectories() {`
        )

        code = replaceOnce(
          code,
          '    async state() {',
          `    async [Symbol.for('abele.sync.inspect-remote-head-v1')](cursor, signal) {
          const before = JSON.stringify(this.connectionInfo);
          const generation = this.http.generation;
          // Read-only head probe: no feed decoding, cursor advancement or ownership effects.
          const info = await this.http.json(V2ConnectionSchema, 'GET', '/v2/connection', { signal });
          const feed = await this.http.json(V2ChangesSchema, 'GET', '/v2/changes', {
            query: { since: Number.MAX_SAFE_INTEGER, limit: 1 }, signal,
          });
          return info.status === 'active' && before === JSON.stringify(info) &&
            generation === this.http.observedGeneration && feed.cursor === cursor &&
            feed.items.length === 0 && feed.next === null;
        }
    async state() {`
        )
        code = replaceOnce(
          code,
          'async fileItem(item, seq, readback) {',
          'async fileItem(item, seq, readback, proofState) {'
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
          'this.fileItem(event.item, event.cursor, readback)',
          'this.fileItem(event.item, event.cursor, readback, proofState)'
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
