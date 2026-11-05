import { afterAll, beforeAll, expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { contextualNodeHistory } from '../fixtures/contextualNodeHistory.mjs'

targets('desktop')
const artifacts = shotDir('abele-node-context-refresh')

beforeAll(async () => {
  await evalLong(
    `(async () => {
    const api = window.__abeleTest;
    const namespace = 'sample-context-refresh-' + crypto.randomUUID();
    const fixture = window.__sampleContextRefresh = { namespace, times: [], stopped: false, presenters: [] };
    fixture.heapBeforeSeed = require('v8').getHeapStatistics().used_heap_size;
    const state = (${contextualNodeHistory.toString()})(true);
    fixture.nodeId = state.node_id = 'sample-node-' + crypto.randomUUID();
    for (const events of Object.values(state.events)) for (const event of events) event.node_id = fixture.nodeId;
    const heads = { ...state.cursors }, runs = {};
    for (const receipt of Object.values(state.results)) if (receipt.result?.run_id) runs[receipt.result.run_id] = receipt.result;
    const database = fixture.database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('abele-node-' + namespace, 3);
      request.onupgradeneeded = () => { request.result.createObjectStore('client'); request.result.createObjectStore('journal') };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['client', 'journal'], 'readwrite');
      const revisions = {};
      for (const [stream, events] of Object.entries(state.events)) {
        revisions[stream] = crypto.randomUUID(); tx.objectStore('journal').put(events, stream);
      }
      tx.objectStore('client').put(revisions, 'streams');
      tx.objectStore('client').put({ ...state, events: {} }, 'state');
      tx.objectStore('client').put('sample-legacy-revision', 'state-revision');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    database.close();
    const store = fixture.store = new api.NodeClientStore(namespace);
    await store.transaction(() => {});
    const client = { store, connected: true, target: { expected_node_id: fixture.nodeId },
      disconnect: async () => {}, onEvent: () => () => {},
      describe: async () => ({ capabilities: { capabilities: { command_context_v1: { status: 'supported' } } } }),
      head: async stream => heads[stream] || 0, cursor: async stream => heads[stream] || 0,
      subscribe: async () => {}, request: async (_method, params) => runs[params?.run_id] };
    fixture.connection = new api.NodeConnection(client, store);
    for (let i = 0; i < 4; i++) fixture.presenters.push(new api.NodeChatPresenter({
      kind: 'node-session', nodeId: fixture.nodeId, registrationId: 'sample-registration',
      sessionId: 'sample-session-' + i, title: 'Sample command conversation',
    }, fixture.connection));
    const refresh = async () => {
      const start = performance.now();
      await fixture.connection.refreshDelegations(false);
      for (const presenter of fixture.presenters) await presenter.refresh();
      fixture.times.push(performance.now() - start);
    };
    fixture.refresh = refresh;
    await refresh();
    fixture.writer = new api.NodeClientStore(namespace);
    await fixture.writer.transaction(() => {});
    await refresh();
    fixture.times = [];
    fixture.parses = 0; fixture.puts = 0; fixture.payloadGets = 0;
    const schema = fixture.schema = api.nodePromptAnswerSchema();
    fixture.originalParse = schema.safeParse;
    schema.safeParse = fixture.countedParse = function(...args) { fixture.parses++; return fixture.originalParse.apply(this, args) };
    fixture.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = fixture.countedPut = function(value, key) {
      if (this.transaction.db.name === 'abele-node-' + namespace && (key === 'state' || key === 'state-revision')) fixture.puts++;
      return fixture.originalPut.call(this, value, key);
    };
    fixture.originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = fixture.countedGet = function(key) {
      if (this.transaction.db.name === 'abele-node-' + namespace && (key === 'state' || String(key).startsWith('record:'))) fixture.payloadGets++;
      return fixture.originalGet.call(this, key);
    };
    const idle = async () => {
      if (fixture.stopped) return;
      try { await fixture.writer.transaction(s => { s.outbox = s.outbox.filter(() => true) }) }
      catch (error) { fixture.error = String(error) }
      if (!fixture.stopped) fixture.idleTimer = setTimeout(() => { fixture.idlePending = idle() }, 200);
    };
    const poll = async () => {
      if (fixture.stopped) return;
      try { await refresh() } catch (error) { fixture.error = String(error) }
      if (!fixture.stopped) fixture.timer = setTimeout(() => { fixture.pending = poll() }, 1000);
    };
    fixture.idlePending = idle(); fixture.pending = poll();
    return true;
  })()`,
    180000
  )
}, 190000)

afterAll(async () => {
  await evalLong(
    `(async () => {
    const fixture = window.__sampleContextRefresh;
    if (!fixture) return true;
    fixture.stopped = true;
    clearTimeout(fixture.timer); clearTimeout(fixture.idleTimer);
    await fixture.pending; await fixture.idlePending;
    if (fixture.schema && fixture.schema.safeParse === fixture.countedParse) fixture.schema.safeParse = fixture.originalParse;
    if (IDBObjectStore.prototype.put === fixture.countedPut) IDBObjectStore.prototype.put = fixture.originalPut;
    if (IDBObjectStore.prototype.get === fixture.countedGet) IDBObjectStore.prototype.get = fixture.originalGet;
    for (const presenter of fixture.presenters) presenter.destroy();
    fixture.connection?.destroy(); fixture.writer?.close(); fixture.store?.close(); fixture.database?.close();
    const agents = window.__abeleTest.AgentsService.getInstance();
    agents.nodeDelegations.delete(fixture.nodeId); agents.publish();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('abele-node-' + fixture.namespace);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
    delete window.__sampleContextRefresh;
    return true;
  })()`,
    30000
  )
})

it('refreshes contextual command history without reparsing, payload reads or heap churn', async () => {
  const report = JSON.parse(
    await evalLong(
      `(async () => {
    const fixture = window.__sampleContextRefresh;
    const debuggerApi = require('@electron/remote').getCurrentWebContents().debugger;
    const attached = debuggerApi.isAttached();
    if (!attached) debuggerApi.attach('1.3');
    const tasks = [], heap = [];
    let sampler;
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
    try {
      await debuggerApi.sendCommand('Performance.enable');
      const metrics = await debuggerApi.sendCommand('Performance.getMetrics');
      await debuggerApi.sendCommand('HeapProfiler.collectGarbage');
      const heapStart = require('v8').getHeapStatistics().used_heap_size;
      await debuggerApi.sendCommand('Profiler.enable');
      await debuggerApi.sendCommand('Profiler.setSamplingInterval', { interval: 500 });
      await debuggerApi.sendCommand('Profiler.start');
      const sample = () => heap.push(require('v8').getHeapStatistics().used_heap_size);
      sample(); sampler = setInterval(sample, 100);
      observer.observe({ type: 'longtask' });
      await new Promise(resolve => setTimeout(resolve, 24000));
      observer.disconnect(); clearInterval(sampler); sample();
      const { profile } = await debuggerApi.sendCommand('Profiler.stop');
      await debuggerApi.sendCommand('HeapProfiler.collectGarbage');
      const heapEnd = require('v8').getHeapStatistics().used_heap_size;
      const fs = require('fs'), directory = ${JSON.stringify(artifacts)};
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(directory + '/idle-profile.json', JSON.stringify({ profile, tasks, metrics }));
      return JSON.stringify({ tasks, heap, heapStart, heapEnd, heapBeforeSeed: fixture.heapBeforeSeed,
        parses: fixture.parses, puts: fixture.puts, payloadGets: fixture.payloadGets,
        refreshMs: fixture.times, error: fixture.error });
    } finally { observer.disconnect(); clearInterval(sampler); if (!attached) debuggerApi.detach() }
  })()`,
      45000
    )
  ) as {
    tasks: { duration: number }[]
    heap: number[]
    heapStart: number
    heapEnd: number
    parses: number
    puts: number
    payloadGets: number
    error?: string
    refreshMs: number[]
  }
  console.log('NODE_CONTEXT_REFRESH ' + JSON.stringify(report))
  expect(report.error).toBeUndefined()
  expect(report.parses).toBe(0)
  expect(report.puts).toBe(0)
  expect(report.payloadGets).toBe(0)
  expect(report.refreshMs.length).toBeGreaterThanOrEqual(15)
  expect(report.tasks.filter((task) => task.duration > 50)).toEqual([])
  expect(Math.max(...report.heap) - Math.min(...report.heap)).toBeLessThan(96 * 1024 * 1024)
  expect(report.heapEnd - report.heapStart).toBeLessThan(16 * 1024 * 1024)
}, 55000)

it('parses only the changed receipt after another handle writes it', async () => {
  const report = JSON.parse(
    await evalLong(
      `(async () => {
    const fixture = window.__sampleContextRefresh;
    fixture.stopped = true;
    clearTimeout(fixture.timer); clearTimeout(fixture.idleTimer);
    await fixture.pending; await fixture.idlePending;
    await fixture.writer.transaction(state => {
      state.results['sample-new-receipt'] = { result: { session_id: 'sample-session-0', sample: true } };
    });
    await fixture.pending;
    fixture.parses = 0; fixture.payloadGets = 0;
    await fixture.refresh();
    return JSON.stringify({ parses: fixture.parses, payloadGets: fixture.payloadGets });
  })()`,
      20000
    )
  ) as { parses: number; payloadGets: number }
  expect(report.parses).toBe(1)
  expect(report.payloadGets).toBe(1)
})
