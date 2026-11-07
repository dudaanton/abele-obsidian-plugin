import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { chatScrollMatrixSuite } from './helpers/chatScrollMatrixSuite'
import { idleStoreJournal } from '../fixtures/idleStoreJournal.mjs'
import { largeMutationHistory } from '../fixtures/largeMutationHistory.mjs'
import { shotDir } from './helpers/shots'
import { stopScrollProfilers } from './helpers/stopScrollProfilers.mjs'

targets('desktop')
const artifacts = shotDir('abele-node-store-refresh')
// Allocation sampling changes allocation cost and GC timing. Use a separate diagnostic
// run for it; qualification retains CPU/long-task evidence and the same frame budget.
const allocationsEnabled = process.env.ABELE_SCROLL_ALLOCATIONS === '1'

beforeEach(async (context) => {
  if (!context.task.name.startsWith('wheel / long')) return
  await evalLong(
    `(async () => {
    const fixture = window.__sampleNodeRefresh;
    const debuggerApi = require('@electron/remote').getCurrentWebContents().debugger;
    fixture.profileAttached = debuggerApi.isAttached();
    if (!fixture.profileAttached) debuggerApi.attach('1.3');
    await debuggerApi.sendCommand('Profiler.enable');
    await debuggerApi.sendCommand('Profiler.setSamplingInterval', { interval: 500 });
    await debuggerApi.sendCommand('Profiler.start');
    fixture.allocationsEnabled = ${JSON.stringify(allocationsEnabled)};
    if (fixture.allocationsEnabled) await debuggerApi.sendCommand('HeapProfiler.startSampling', {
      samplingInterval: 32768,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true
    });
    await debuggerApi.sendCommand('Performance.enable');
    fixture.profileMetrics = await debuggerApi.sendCommand('Performance.getMetrics');
    fixture.heapWindows = [];
    fixture.heapObserver = new MutationObserver(records => {
      const box = records.find(record => record.type === 'childList' &&
        record.target.classList?.contains('abele-ai-chat__messages'))?.target;
      if (!box) return;
      const rows = box.querySelectorAll('[data-message-id]');
      // Numeric/string evidence only: never retain a detached message in this probe.
      fixture.heapWindows.push({ at: performance.now(), usedHeap: performance.memory?.usedJSHeapSize,
        mounted: rows.length, first: rows[0]?.dataset.messageId, last: rows[rows.length - 1]?.dataset.messageId });
    });
    fixture.heapObserver.observe(document.body, { childList: true, subtree: true });
    fixture.longTasks = [];
    fixture.observer = new PerformanceObserver(list => fixture.longTasks.push(...list.getEntries().map(
      entry => ({ start: entry.startTime, duration: entry.duration })
    )));
    fixture.observer.observe({ type: 'longtask' });
    return true;
  })()`,
    20000
  )
})

afterEach(async (context) => {
  if (!context.task.name.startsWith('wheel / long')) return
  const report = await evalLong(
    `(async () => {
    const fixture = window.__sampleNodeRefresh;
    if (!fixture?.observer) return '{}';
    const debuggerApi = require('@electron/remote').getCurrentWebContents().debugger;
    try {
      const { profile, allocations, timings, metricsAfter } = await (${stopScrollProfilers.toString()})(debuggerApi, fixture.allocationsEnabled);
      const fs = require('fs'), directory = ${JSON.stringify(artifacts)};
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(directory + '/scroll-profile.json', JSON.stringify({ profile, tasks: fixture.longTasks, metrics: fixture.profileMetrics, metricsAfter, timings, allocationsEnabled: fixture.allocationsEnabled }));
      fs.writeFileSync(directory + '/scroll-allocations.json', JSON.stringify(allocations));
      fs.writeFileSync(directory + '/scroll-heap-windows.json', JSON.stringify(fixture.heapWindows));
      // Other matrix files use the same case name. Preserve this run's trace
      // beside its profile before a later suite can overwrite the shared artifact.
      const frames = ${JSON.stringify(shotDir('abele-phone') + '/wheel-long-idle-frames.json')};
      if (fs.existsSync(frames)) fs.copyFileSync(frames, directory + '/scroll-frames.json');
      return JSON.stringify({ tasks: fixture.longTasks, refreshMs: fixture.times, error: fixture.error });
    } finally {
      fixture.observer.disconnect();
      fixture.heapObserver.disconnect();
      if (!fixture.profileAttached) debuggerApi.detach();
    }
  })()`,
    30000
  )
  console.log('NODE_SCROLL_PROFILE ' + report)
})

beforeAll(async () => {
  await evalLong(
    `(async () => {
    const api = window.__abeleTest;
    const namespace = 'sample-refresh-' + crypto.randomUUID();
    const store = new api.NodeClientStore(namespace);
    const runs = {}, heads = {};
    const fixture = window.__sampleNodeRefresh = { store, namespace, times: [], stopped: false };
    try {
      // Start with the legacy single-blob shape, not already-separated rows.
      const legacy = await new Promise((resolve, reject) => {
        const request = indexedDB.open('abele-node-' + namespace, 3);
        request.onupgradeneeded = () => { request.result.createObjectStore('client'); request.result.createObjectStore('journal') };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        // Keep the seed in this short-lived executor. The polling closures below
        // share the enclosing scope and would retain its original file images.
        const history = (${largeMutationHistory.toString()})();
        const tx = legacy.transaction('client', 'readwrite');
        tx.objectStore('client').put({ cursors: {}, events: {}, results: {}, outbox: [], chatMutations: history }, 'state');
        tx.objectStore('client').put('sample-legacy-revision', 'state-revision');
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
      legacy.close();
      await store.transaction(state => {
        state.node_id = fixture.nodeId = 'sample-node-' + crypto.randomUUID();
        state.managerOperations = {};
        for (let i = 0; i < 3000; i++) {
          const id = 'sample-operation-' + i;
          state.results[id] = { error: 'outcome_unknown' };
          state.managerOperations[id] = { parent: 'sample-parent-' + i % 10, method: 'command.v1.run', params: {} };
        }
        for (let i = 0; i < 100; i++) {
          const id = 'sample-operation-' + i;
          const run = { run_id: id, prompt_id: 'sample-prompt-' + i, session_id: 'sample-session-' + i,
            method: 'command.v1.run', state: i === 0 ? 'running' : 'exited', stdout: '', stderr: '', stdout_truncated: false, stderr_truncated: false };
          runs[id] = run;
          state.results[id] = { result: run };
          state.managerOperations[id].run = run;
        }
        for (let i = 0; i < 10; i++) {
          const stream = 'sample-session-' + i;
          heads[stream] = 300;
          state.cursors[stream] = 300;
          state.events[stream] = (${idleStoreJournal.toString()})(300).map(event => ({ ...event, stream_id: stream }));
        }
      });
      const subscriptions = new Set();
      const client = { store, connected: true, disconnect: async () => {}, head: async stream => heads[stream] || 0, cursor: async stream => heads[stream] || 0,
        subscribe: async session => { subscriptions.add(session) },
        request: async (_method, params) => runs[params.run_id] };
      const connection = fixture.connection = new api.NodeConnection(client, store);
      const tick = async () => {
        const start = performance.now();
        await connection.refreshDelegations(false);
        fixture.times.push(performance.now() - start);
      };
      await tick();
      if (subscriptions.size !== 100) throw new Error('Stub sessions did not finish reconnect recovery');
      fixture.times = [];
      const idleStore = fixture.idleStore = new api.NodeClientStore(namespace);
      await idleStore.transaction(() => {});
      fixture.metadataPuts = 0;
      const originalPut = fixture.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = fixture.countedPut = function(value, key) {
        if (this.transaction.db.name === 'abele-node-' + namespace && (key === 'state' || key === 'state-revision')) fixture.metadataPuts++;
        return originalPut.call(this, value, key);
      };
      const idle = async () => {
        if (fixture.stopped) return;
        try { await idleStore.transaction(state => { state.outbox = state.outbox.filter(() => true) }) }
        catch (error) { fixture.error = String(error) }
        if (!fixture.stopped) fixture.idleTimer = setTimeout(() => { fixture.idlePending = idle() }, 200);
      };
      fixture.idlePending = idle();
      const poll = async () => {
        if (fixture.stopped) return;
        try { await tick() } catch (error) { fixture.error = String(error) }
        if (!fixture.stopped) fixture.timer = setTimeout(() => { fixture.pending = poll() }, 1000);
      };
      fixture.pending = poll();
      return true;
    } catch (error) { store.close(); throw error }
  })()`,
    120000
  )
}, 130000)

afterAll(async () => {
  await evalLong(
    `(async () => {
    const fixture = window.__sampleNodeRefresh;
    if (!fixture) return;
    fixture.stopped = true;
    clearTimeout(fixture.timer);
    clearTimeout(fixture.idleTimer);
    await fixture.pending;
    await fixture.idlePending;
    if (fixture.originalPut && IDBObjectStore.prototype.put === fixture.countedPut) IDBObjectStore.prototype.put = fixture.originalPut;
    fixture.idleStore?.close();
    fixture.connection?.destroy();
    if (fixture.nodeId) {
      const agents = window.__abeleTest.AgentsService.getInstance();
      agents.nodeDelegations.delete(fixture.nodeId); agents.publish();
    }
    fixture.store.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('abele-node-' + fixture.namespace);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
    delete window.__sampleNodeRefresh;
    return true;
  })()`,
    30000
  )
})

it('profiles eight seconds of large-history refresh without main-thread long tasks', async () => {
  const report = JSON.parse(
    await evalLong(
      `(async () => {
    const fixture = window.__sampleNodeRefresh;
    const debuggerApi = require('@electron/remote').getCurrentWebContents().debugger;
    const attached = debuggerApi.isAttached();
    const tasks = [];
    const observer = new PerformanceObserver(list => {
      tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })));
    });
    if (!attached) debuggerApi.attach('1.3');
    try {
      await debuggerApi.sendCommand('Performance.enable');
      const { metrics } = await debuggerApi.sendCommand('Performance.getMetrics');
      const navigationStart = metrics.find(metric => metric.name === 'NavigationStart').value;
      await debuggerApi.sendCommand('Profiler.enable');
      await debuggerApi.sendCommand('Profiler.setSamplingInterval', { interval: 500 });
      await debuggerApi.sendCommand('Profiler.start');
      observer.observe({ type: 'longtask' });
      await new Promise(resolve => setTimeout(resolve, 8000));
      const { profile } = await debuggerApi.sendCommand('Profiler.stop');
      return JSON.stringify({ tasks, refreshMs: fixture.times, error: fixture.error, metadataPuts: fixture.metadataPuts,
        profileStartTime: profile.startTime, navigationStart, profileNodes: profile.nodes, samples: profile.samples, timeDeltas: profile.timeDeltas });
    } finally {
      observer.disconnect();
      if (!attached) debuggerApi.detach();
    }
  })()`,
      20000
    )
  ) as {
    tasks: { start: number; duration: number }[]
    refreshMs: number[]
    error?: string
    metadataPuts: number
  }
  // Keep the complete sampled stacks in the test log for attribution of any failure.
  console.log('NODE_REFRESH_PROFILE ' + JSON.stringify(report))
  expect(report.error).toBeUndefined()
  expect(report.metadataPuts).toBe(0)
  expect(report.refreshMs.length).toBeGreaterThanOrEqual(5)
  expect(report.tasks.filter((task) => task.duration > 50)).toEqual([])
})

// The same continuous native-wheel path used by the scroll qualification, with the
// large connected stub's ordinary controller/store refresh running throughout.
chatScrollMatrixSuite('wheel/long/idle', 90, 8000)
