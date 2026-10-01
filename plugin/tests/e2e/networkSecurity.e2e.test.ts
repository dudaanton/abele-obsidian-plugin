import { describe, expect, it } from 'vitest'
import { evalJson, evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')
const live = isObsidianRunning() && hasTestApi()
describe.skipIf(!live)('network security in the running app', () => {
  it('runs calculations in a real worker without network or generated code', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      const tool = window.__abeleTest.createAgentTools().find(t => t.name === 'eval_js')
      const run = async code => { try { return (await tool.execute('sample', {code})).content[0].text } catch(e) { return e.message } }
      return { calculation: await run('6*7'), globals: await run('[typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof Worker, typeof importScripts].join(",")'), generated: await run('Function("return fetch")()') }
    })()`)
    )
    expect(result.calculation).toBe('42')
    expect(result.globals).toBe('undefined,undefined,undefined,undefined,undefined')
    expect(result.generated).toMatch(/generation.*unavailable/i)
  })
  it('does not send a credential across an actual desktop redirect', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      const http = require('http')
      const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      let received = {}
      const target = http.createServer((req,res) => { received = req.headers; res.end('ok') })
      const source = http.createServer((req,res) => {
        if(req.url === '/large') { res.end('x'.repeat(1024)); return }
        res.writeHead(302, {Location: 'http://127.0.0.1:' + target.address().port + '/end'}); res.end()
      })
      await listen(target); await listen(source)
      try {
        const request = window.__abeleTest.networkSecurity.networkRequest
        const base = 'http://127.0.0.1:' + source.address().port
        await request({url: base + '/start', headers: {Authorization: 'Bearer sample-token', 'X-Sample': 'sample-extra'}, secretValues:['sample-extra']})
        let sizeError = ''
        try { await request({url: base + '/large', maxBytes: 128}) } catch(e) { sizeError = e.message }
        return { received, sizeError }
      } finally { source.closeAllConnections?.(); target.closeAllConnections?.(); await Promise.all([new Promise(r => source.close(r)), new Promise(r => target.close(r))]) }
    })()`)
    )
    expect(result.received.authorization).toBeUndefined()
    expect(result.received['x-sample']).toBeUndefined()
    expect(result.sizeError).toMatch(/too large/i)
  })
  it('rejects local and HTTP note map styles without changing the style setting', () => {
    const result = evalJson<boolean[]>(
      `['http://tiles.example/style.json','https://127.0.0.1/style.json','https://router.local/style.json'].map(style => 'error' in window.__abeleTest.networkSecurity.normalizeMapBlock({center:[10,20],style}))`
    )
    expect(result).toEqual([true, true, true])
  })
})
