/**
 * The iOS lab's server: builds the lab page (`lab.ts`) with the reader's own code, serves it and
 * a test book to Safari in the Simulator, keeps what the page reports in `/tmp/abele-ios/log.jsonl`
 * and hands the page the orders a test posts. Run with `node tests/ios/run.mjs` (bundles this file with the project's esbuild).
 */
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { buildRichEpub } from '../fixtures/books/richBook'

const HERE = process.env.LAB_DIR ?? __dirname
const SRC = resolve(HERE, '../../src')
const OUT = '/tmp/abele-ios'
const PORT = Number(process.env.LAB_PORT ?? 8787)
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'log.jsonl'), '')

await build({
  entryPoints: [join(HERE, 'lab.ts')],
  bundle: true,
  format: 'iife',
  target: 'safari17',
  outfile: join(OUT, 'lab.js'),
  alias: { '@': SRC, obsidian: join(HERE, 'obsidianStub.ts') },
  logLevel: 'warning',
})
const book = buildRichEpub()
const orders: unknown[] = []

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://lab')
  const send = (type: string, body: string | Uint8Array) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (url.pathname === '/log')
        for (const e of JSON.parse(body) as unknown[])
          appendFileSync(join(OUT, 'log.jsonl'), JSON.stringify(e) + '\n')
      if (url.pathname === '/order') orders.push(JSON.parse(body))
      send('text/plain', 'ok')
    })
    return
  }
  if (url.pathname === '/next')
    return send('application/json', JSON.stringify(orders.shift() ?? null))
  if (url.pathname === '/book.epub') return send('application/epub+zip', book)
  if (url.pathname === '/lab.js') return send('text/javascript', readFileSync(join(OUT, 'lab.js')))
  return send('text/html', readFileSync(join(HERE, 'index.html')))
}).listen(PORT, () => console.log(`lab on http://localhost:${PORT}`))
