/**
 * A GitHub Enterprise Server on 127.0.0.1, answering what a GitHub tab asks for `acme/widgets`:
 * the REST API under `/api/v3`, GraphQL at `/api/graphql`, from `fakeGithubRepo.ts`.
 *
 * Run as its own process (`startFakeGithub` in `githubLive.ts` bundles and spawns it): the test
 * worker blocks its event loop on every `obsidian eval`, and a server inside it would leave the
 * app's requests waiting on the very call that waits for them.
 *
 * Every request is logged to stdout as `GET <path>`, so a test can tell which were made.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  DISCUSSION,
  HEAD_SHA,
  ISSUE,
  OWNER,
  PULL,
  REPO,
  filesAt,
  fixtures,
  tarball,
} from './fakeGithubRepo'

const port = Number(process.argv[2] ?? 0)

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  const bytes = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': String(bytes.length) })
  res.end(bytes)
}

const notFound = (res: ServerResponse) =>
  send(res, 404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' })

/** A list is served whole on its first page, as a short page that says it is the last. */
const page = (url: URL, items: unknown[]) =>
  Number(url.searchParams.get('page') ?? 1) > 1 ? [] : items

function rest(req: IncomingMessage, res: ServerResponse, url: URL, web: string) {
  const f = fixtures(web)
  const accept = String(req.headers.accept ?? '')
  const prefix = `/api/v3/repos/${OWNER}/${REPO}`
  if (!url.pathname.startsWith(prefix)) return notFound(res)
  const path = decodeURIComponent(url.pathname.slice(prefix.length))

  if (path === '') return send(res, 200, f.repo)
  if (path === `/pulls/${PULL}`) return send(res, 200, f.pull)
  if (path === `/issues/${PULL}`) return send(res, 200, { ...f.pull, pull_request: {} })
  if (path === `/issues/${PULL}/comments`) return send(res, 200, page(url, f.pullComments))
  if (path === `/pulls/${PULL}/reviews`) return send(res, 200, page(url, f.reviews))
  if (path === `/pulls/${PULL}/comments`) return send(res, 200, page(url, f.reviewComments))
  if (path === `/pulls/${PULL}/files`) return send(res, 200, page(url, f.files))
  if (path === `/pulls/${PULL}/commits`) return send(res, 200, page(url, f.commits))
  if (path === `/issues/${ISSUE}`) return send(res, 200, f.issue)
  if (path === `/issues/${ISSUE}/comments`) return send(res, 200, page(url, f.issueComments))

  let m = /^\/commits\/(.+)$/.exec(path)
  if (m) {
    const ref = m[1]
    if (accept.includes('vnd.github.sha')) {
      return filesAt(ref)
        ? send(res, 200, ref === 'main' ? HEAD_SHA : ref, 'text/plain')
        : notFound(res)
    }
    const detail = f.commitDetail(ref === 'main' ? HEAD_SHA : ref)
    return detail ? send(res, 200, detail) : notFound(res)
  }

  m = /^\/contents\/(.+)$/.exec(path)
  if (m) {
    const files = filesAt(url.searchParams.get('ref') ?? 'main')
    const file = m[1]
    if (!files) return notFound(res)
    if (file in files) return send(res, 200, files[file], 'text/plain; charset=utf-8')
    const inside = Object.keys(files).filter((p) => p.startsWith(`${file}/`))
    if (!inside.length) return notFound(res)
    return send(
      res,
      200,
      inside.map((p) => ({ name: p, path: p, type: 'file', _links: {} }))
    )
  }

  m = /^\/git\/trees\/(.+)$/.exec(path)
  if (m) {
    const files = filesAt(m[1])
    if (!files) return notFound(res)
    const tree = Object.entries(files).map(([p, text]) => ({
      path: p,
      type: 'blob',
      size: Buffer.byteLength(text),
    }))
    return send(res, 200, { sha: m[1], tree, truncated: false })
  }

  m = /^\/tarball\/(.+)$/.exec(path)
  if (m) {
    const files = filesAt(m[1])
    if (!files) return notFound(res)
    return send(
      res,
      200,
      tarball(files, `${OWNER}-${REPO}-${m[1].slice(0, 7)}`),
      'application/gzip'
    )
  }

  return notFound(res)
}

async function graphql(req: IncomingMessage, res: ServerResponse, web: string) {
  let raw = ''
  for await (const chunk of req) raw += String(chunk)
  const { query, variables } = JSON.parse(raw || '{}') as {
    query?: string
    variables?: Record<string, unknown>
  }
  if (query?.includes('discussion(number') && variables?.number === DISCUSSION)
    return send(res, 200, { data: { repository: { discussion: fixtures(web).discussion } } })
  return send(res, 200, { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }] })
}

const server = createServer((req, res) => {
  const host = req.headers.host ?? `127.0.0.1:${port}`
  const url = new URL(req.url ?? '/', `http://${host}`)
  const web = `http://${host}`
  console.log(`${req.method} ${url.pathname}${url.search}`)
  if (req.method === 'POST' && url.pathname === '/api/graphql') {
    graphql(req, res, web).catch((e) => send(res, 500, { message: String(e) }))
    return
  }
  if (req.method !== 'GET') return notFound(res)
  rest(req, res, url, web)
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  console.log(`listening ${typeof address === 'object' && address ? address.port : port}`)
})
