/** Idempotent page-side job launch; abandoned results must not resurrect removed jobs. */
export function evalJobSource(id: string, code: string): string {
  return `(() => {
      const id = ${JSON.stringify(id)}
      const jobs = (window.__e2eJobs = window.__e2eJobs || {})
      if (jobs[id]) return id
      jobs[id] = { done: false }
      // Started from a timer, after this call has answered: begun in a microtask it could run
      // on before the answer went out, and the call waited for the script it was only to start.
      new Promise((ready) => setTimeout(ready, 0))
        .then(() => (${code}))
        .then(
          (v) => { if (!jobs[id]) return; jobs[id] = { done: true, out: v === undefined ? '(no output)' : '=> ' + (typeof v === 'string' ? v : JSON.stringify(v, null, 2)) } },
          (e) => { if (!jobs[id]) return; jobs[id] = { done: true, out: 'Error: ' + String((e && e.message) || e) } }
        )
      return id
    })()`
}
