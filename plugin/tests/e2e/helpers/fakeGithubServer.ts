/**
 * A GitHub Enterprise Server on 127.0.0.1, answering what a GitHub tab asks for `acme/widgets`:
 * the REST API under `/api/v3`, GraphQL at `/api/graphql`, from `fakeGithubRepo.ts`.
 *
 * Run as its own process (`startFakeGithub` in `githubLive.ts` bundles and spawns it): the test
 * worker blocks its event loop on every `obsidian eval`, and a server inside it would leave the
 * app's requests waiting on the very call that waits for them.
 *
 * Every request is logged to stdout as `GET <path>`, so a test can tell which were made.
 *
 * Started with `legacy` as its second argument it is an older Enterprise Server: it knows only
 * the long-standing media types. `raw+json` and `sha` fall through to the default answer — for a
 * file the contents API's JSON object with the file in base64, for a commit the whole commit —
 * and a file over `LEGACY_LARGE` bytes stands for one past the contents API's 1 MB: its object
 * carries no content, and only the git blobs API has it. `no-raw` is the same server ignoring
 * every raw type as well, so that the client's own decoding is what shows the file.
 */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { deflateSync } from 'node:zlib'
import {
  BASE_FILES,
  DISCUSSION,
  HEAD_FILES,
  HEAD_SHA,
  ISSUE,
  OWNER,
  PEOPLE,
  PULL,
  REPO,
  SLASHED_BRANCH,
  FIRST_SHA,
  filesAt,
  fixtures,
  foldersOf,
  tarball,
} from './fakeGithubRepo'

const port = Number(process.argv[2] ?? 0)
const mode = process.argv[3] ?? ''
const legacy = mode === 'legacy' || mode === 'no-raw'
/** The size that stands for the contents API's 1 MB in legacy mode: `src/long.ts` is over it. */
const LEGACY_LARGE = 10_000

/** The media types asked for, without their parameters. */
const mediaTypes = (accept: string) => accept.split(',').map((t) => t.split(';')[0].trim())
const RAW_TYPES: string[] =
  mode === 'no-raw'
    ? []
    : legacy
      ? ['application/vnd.github.raw', 'application/vnd.github.v3.raw']
      : [
          'application/vnd.github.raw',
          'application/vnd.github.v3.raw',
          'application/vnd.github.raw+json',
        ]

/** Git's own name for a file's contents. */
const blobSha = (text: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0${text}`)
    .digest('hex')

/** GitHub wraps its base64 at 60 columns. */
const base64 = (text: string) =>
  Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/(.{60})/g, '$1\n')

/** The contents API's default answer for a file. */
function contentsObject(path: string, text: string, web: string) {
  const size = Buffer.byteLength(text)
  const large = legacy && size > LEGACY_LARGE
  return {
    type: 'file',
    name: path.split('/').pop(),
    path,
    sha: blobSha(text),
    size,
    url: `${web}/api/v3/repos/${OWNER}/${REPO}/contents/${path}`,
    html_url: `${web}/${OWNER}/${REPO}/blob/main/${path}`,
    git_url: `${web}/api/v3/repos/${OWNER}/${REPO}/git/blobs/${blobSha(text)}`,
    download_url: null,
    encoding: large ? 'none' : 'base64',
    content: large ? '' : base64(text),
    _links: {},
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  const bytes = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': String(bytes.length) })
  res.end(bytes)
}

const notFound = (res: ServerResponse) =>
  send(res, 404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' })

/** The words of a search, without its qualifiers (`repo:…`, `in:title`). */
const searchWords = (q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !w.includes(':'))

const titleMatches = (title: string, q: string) => {
  const words = searchWords(q)
  return words.length > 0 && words.every((w) => title.toLowerCase().includes(w))
}

/** GitHub's issue search, over the one pull request and the one issue there are. */
function searchIssues(res: ServerResponse, url: URL, web: string) {
  const f = fixtures(web)
  const q = url.searchParams.get('q') ?? ''
  const items = [{ ...f.pull, pull_request: { merged_at: null } }, { ...f.issue }].filter((i) =>
    titleMatches(i.title, q)
  )
  return send(res, 200, { total_count: items.length, incomplete_results: false, items })
}

/** A list is served whole on its first page, as a short page that says it is the last. */
const page = (url: URL, items: unknown[]) =>
  Number(url.searchParams.get('page') ?? 1) > 1 ? [] : items

/** CRC-32, for the chunks of a PNG. */
function crc32(bytes: Buffer): number {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** A square PNG of one colour — a person's picture, told apart from the others by its colour. */
function avatarPng(login: string): Buffer {
  const hue = [...login].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7)
  const [r, g, b] = [0, 120, 240].map((shift) =>
    Math.round(127 + 100 * Math.cos(((hue + shift) * Math.PI) / 180))
  )
  const size = 40
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())])
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function rest(req: IncomingMessage, res: ServerResponse, url: URL, web: string) {
  const f = fixtures(web)
  const accept = String(req.headers.accept ?? '')
  if (url.pathname === '/api/v3/search/issues') return searchIssues(res, url, web)
  const profile = /^\/api\/v3\/users\/([^/]+)$/.exec(url.pathname)
  if (profile) {
    const login = decodeURIComponent(profile[1])
    if (!(login in PEOPLE)) return notFound(res)
    return send(res, 200, { login, name: PEOPLE[login], avatar_url: `${web}/avatars/u/${login}` })
  }
  const picture = /^\/avatars\/u\/([^/]+)$/.exec(url.pathname)
  if (picture) return send(res, 200, avatarPng(picture[1]), 'image/png')
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
  if (path === '/branches')
    return send(
      res,
      200,
      ['main', 'loader', SLASHED_BRANCH].map((name) => ({ name }))
    )

  let m = /^\/commits\/(.+)$/.exec(path)
  if (m) {
    // A short SHA is the commit it starts, as GitHub reads one.
    const ref = /^[0-9a-f]{7,39}$/.test(m[1])
      ? ([HEAD_SHA, FIRST_SHA].find((sha) => sha.startsWith(m![1])) ?? m[1])
      : m[1]
    if (accept.includes('vnd.github.sha') && !legacy) {
      return filesAt(ref)
        ? send(res, 200, ref === 'main' ? HEAD_SHA : ref, 'text/plain')
        : notFound(res)
    }
    const detail = f.commitDetail(ref === 'main' ? HEAD_SHA : ref)
    if (detail) return send(res, 200, detail)
    // An older server answers the `sha` type with the commit; this one has only its SHA to give.
    if (legacy && filesAt(ref)) return send(res, 200, { sha: ref === 'main' ? HEAD_SHA : ref })
    return notFound(res)
  }

  m = /^\/contents(?:\/(.*))?$/.exec(path)
  if (m) {
    const files = filesAt(url.searchParams.get('ref') ?? 'main')
    const file = (m[1] ?? '').replace(/\/$/, '')
    if (!files) return notFound(res)
    if (file in files) {
      if (mediaTypes(accept).some((t) => RAW_TYPES.includes(t)))
        return send(res, 200, files[file], 'application/vnd.github.raw; charset=utf-8')
      return send(res, 200, contentsObject(file, files[file], web))
    }
    // A folder: what is directly in it, folders and files, as the contents API lists them.
    const prefix = file ? `${file}/` : ''
    const inside = Object.keys(files).filter((p) => p.startsWith(prefix))
    if (!inside.length) return notFound(res)
    const names = new Map<string, { type: string; size: number }>()
    for (const p of inside) {
      const [name, ...deeper] = p.slice(prefix.length).split('/')
      names.set(
        name,
        deeper.length
          ? { type: 'dir', size: 0 }
          : { type: 'file', size: Buffer.byteLength(files[p]) }
      )
    }
    return send(
      res,
      200,
      [...names].map(([name, e]) => ({
        name,
        path: `${prefix}${name}`,
        type: e.type,
        size: e.size,
        _links: {},
      }))
    )
  }

  m = /^\/git\/trees\/(.+)$/.exec(path)
  if (m) {
    const files = filesAt(m[1])
    if (!files) return notFound(res)
    // Folders as well as files, the way GitHub lists a whole tree.
    const tree = [
      ...foldersOf(files).map((p) => ({ path: p, type: 'tree', sha: blobSha(`tree:${p}`) })),
      ...Object.entries(files).map(([p, text]) => ({
        path: p,
        type: 'blob',
        size: Buffer.byteLength(text),
        sha: blobSha(text),
      })),
    ]
    return send(res, 200, { sha: m[1], tree, truncated: false })
  }

  m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(path)
  if (m) {
    const sha = m[1]
    const text = [...Object.values(HEAD_FILES), ...Object.values(BASE_FILES)].find(
      (t) => blobSha(t) === sha
    )
    if (text === undefined) return notFound(res)
    return send(res, 200, {
      sha,
      size: Buffer.byteLength(text),
      url: '',
      encoding: 'base64',
      content: base64(text),
    })
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
  if (query?.includes('type:DISCUSSION')) {
    const d = fixtures(web).discussion
    const nodes = titleMatches(d.title, String(variables?.q ?? '')) ? [d] : []
    return send(res, 200, { data: { search: { nodes } } })
  }
  if (query?.includes('user(login:')) {
    // The batched lookup of people's names: `u0: user(login: $l0)`, one alias per login.
    const data: Record<string, unknown> = {}
    const errors: unknown[] = []
    for (const [name, login] of Object.entries(variables ?? {})) {
      const alias = `u${name.slice(1)}`
      if (typeof login === 'string' && login in PEOPLE) {
        data[alias] = { login, name: PEOPLE[login], avatarUrl: `${web}/avatars/u/${login}` }
      } else {
        data[alias] = null
        errors.push({ type: 'NOT_FOUND', path: [alias], message: 'Could not resolve to a User' })
      }
    }
    return send(res, 200, { data, ...(errors.length ? { errors } : {}) })
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
