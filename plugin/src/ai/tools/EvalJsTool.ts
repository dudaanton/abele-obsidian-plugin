import type { AgentTool } from '../client'

const EVAL_TIMEOUT = 10_000 // 10 seconds

export function createEvalJsTool(): AgentTool {
  return {
    name: 'eval_js',
    label: 'Evaluate JavaScript',
    description:
      'Execute JavaScript code in a sandboxed environment. Use for calculations, data processing, string manipulation, JSON parsing, etc. No access to files, network, or DOM. Returns the last expression value (or console output) as a string.',
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

function runInWorker(code: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Wrap code to capture the result: last expression value + console output
    const wrappedCode = `
      const __logs = [];
      const console = {
        log: (...args) => __logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        error: (...args) => __logs.push('ERROR: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args) => __logs.push('WARN: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      };
      try {
        const __result = eval(${JSON.stringify(code)});
        const output = __logs.length ? __logs.join('\\n') + '\\n' : '';
        const resultStr = __result !== undefined
          ? (typeof __result === 'object' ? JSON.stringify(__result, null, 2) : String(__result))
          : '';
        postMessage({ ok: true, value: output + resultStr });
      } catch (e) {
        const output = __logs.length ? __logs.join('\\n') + '\\n' : '';
        postMessage({ ok: false, value: output + (e.message || String(e)) });
      }
    `

    const blob = new Blob([wrappedCode], { type: 'application/javascript' })
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
