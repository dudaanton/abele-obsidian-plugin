import type { AgentTool } from '../client'
import { javascriptLanguage } from '@codemirror/lang-javascript'

const EVAL_TIMEOUT = 10_000 // 10 seconds

export function createEvalJsTool(): AgentTool {
  return {
    name: 'eval_js',
    label: 'Evaluate JavaScript',
    description:
      'Execute JavaScript code in a sandboxed environment. Use for calculations, data processing, string manipulation, JSON parsing, etc. No access to files, network, storage, other workers or DOM. Imports and runtime code generation (eval, Function, string timers) are unavailable. Stops after 10 seconds. Returns the last expression value (or console output) as a string.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['code'],
    },
    execute: async (_id, params) => {
      const code = params.code as string
      if (!code) throw new Error('Missing required parameter: code')

      const result = await runInWorker(code, EVAL_TIMEOUT)
      return { content: [{ type: 'text', text: result }] }
    },
  }
}

export function refusalFor(code: string): string | null {
  // import() is syntax, not a replaceable global. Generated code is disabled below.
  // Parse tokens rather than rejecting ordinary strings and comments containing this word.
  const cursor = javascriptLanguage.parser.parse(code).cursor()
  let refused = false
  do {
    if (cursor.name === 'import' || (cursor.type.isError && /\bimport\b/.test(code))) refused = true
  } while (!refused && cursor.next())
  return refused ? 'eval_js cannot use import; inline the required code.' : null
}

/** Compile once, after removing network capabilities and runtime code generation. */
export function buildWorkerSource(code: string): string {
  return `
(() => {
  'use strict';
  const g = self;
  const post = g.postMessage.bind(g);
  const run = g.eval;
  const logs = [];
  const show = a => typeof a === 'object' ? JSON.stringify(a) : String(a);
  const scrub = (target, name) => {
    for (let o = target; o; o = Object.getPrototypeOf(o)) {
      if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
      try { delete o[name]; } catch {}
      if (Object.prototype.hasOwnProperty.call(o, name)) {
        Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false });
      }
    }
    Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false });
  };
  try {
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport',
      'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'indexedDB', 'IDBFactory',
      'caches', 'CacheStorage', 'BroadcastChannel', 'RTCPeerConnection', 'webkitRTCPeerConnection',
      'RTCDataChannel', 'webkitRequestFileSystem', 'webkitRequestFileSystemSync',
      'require', 'process', 'module', 'Buffer', 'global']) scrub(g, name);
    if (g.navigator) for (const name of ['storage', 'locks', 'sendBeacon', 'serviceWorker']) scrub(g.navigator, name);
    const refuse = function () { throw new EvalError('Runtime code generation is unavailable'); };
    for (const f of [function(){}, async function(){}, function*(){}, async function*(){}]) {
      Object.defineProperty(Object.getPrototypeOf(f), 'constructor', { value: refuse, writable: false, configurable: false });
    }
    scrub(g, 'eval');
    Object.defineProperty(g, 'Function', { value: refuse, writable: false, configurable: false });
    for (const name of ['setTimeout', 'setInterval']) {
      const original = g[name];
      if (!original) continue;
      Object.defineProperty(g, name, { value: (handler, ...args) => {
        if (typeof handler !== 'function') throw new EvalError('Timers require functions');
        return original.call(g, handler, ...args);
      }, writable: false, configurable: false });
    }
    g.console = {
      log: (...args) => logs.push(args.map(show).join(' ')),
      warn: (...args) => logs.push('WARN: ' + args.map(show).join(' ')),
      error: (...args) => logs.push('ERROR: ' + args.map(show).join(' ')),
    };
    const result = run(${JSON.stringify(code)});
    post({ ok: true, value: (logs.length ? logs.join('\\n') + '\\n' : '') +
      (result === undefined ? '' : typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)) });
  } catch (e) {
    post({ ok: false, value: (logs.length ? logs.join('\\n') + '\\n' : '') + (e.message || String(e)) });
  }
})();`
}

function runInWorker(code: string, timeout: number): Promise<string> {
  const refusal = refusalFor(code)
  if (refusal) return Promise.reject(new Error(refusal))
  return new Promise((resolve, reject) => {
    const blob = new Blob([buildWorkerSource(code)], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)

    const timer = window.setTimeout(() => {
      worker.terminate()
      URL.revokeObjectURL(url)
      reject(new Error(`Execution timed out after ${timeout / 1000}s`))
    }, timeout)

    worker.onmessage = (e) => {
      window.clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      const { ok, value } = e.data
      if (ok) {
        resolve(value || '(no output)')
      } else {
        reject(new Error(value))
      }
    }

    worker.onerror = (e) => {
      window.clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      reject(new Error(e.message || 'Worker error'))
    }
  })
}
