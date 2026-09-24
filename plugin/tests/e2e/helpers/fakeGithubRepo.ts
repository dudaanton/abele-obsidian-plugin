/**
 * The repository the fake GitHub serves: `acme/widgets`, at two commits, with a pull request
 * between them, an issue, a discussion and their conversations.
 *
 * Every answer is made from the same few files, so they agree with each other the way GitHub's
 * do: a pull request's patches are diffs of the files it serves at the base and the head, the
 * archive holds exactly the tree's files, and a line a link names is the line the file has.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

export const OWNER = 'acme'
export const REPO = 'widgets'
export const HEAD_SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
export const BASE_SHA = '0b1c2d3e4f5061728394a5b6c7d8e9f00b1c2d3e'
/** The pull request's first commit; its second is the head. */
export const FIRST_SHA = 'c0ffee0123456789abcdef0123456789abcdef01'
export const PULL = 42
export const ISSUE = 7
export const DISCUSSION = 3
/** A conversation comment near the end of the pull request's, for scrolling to. */
export const LATE_COMMENT = 4214
export const ISSUE_COMMENT = 7011

const longFile = (changed: boolean) =>
  Array.from({ length: 400 }, (_, i) => {
    const n = i + 1
    // Every tenth line differs between the commits: forty hunks, so a line deep in the diff is
    // well below the top of the tab.
    const note = changed && n % 10 === 0 ? 'reworked' : 'original'
    return `export const setting${n} = ${n} // line ${n} of a long file, ${note}`
  }).join('\n') + '\n'

const README_HEAD = `# Widgets

Widgets loads and formats widgets for the dashboard.

## Install

Install it with the package manager:

\`\`\`sh
npm install acme-widgets
\`\`\`

## Usage

- Call \`startApp\` with the number of widgets.
- Read the formatted count it returns.
- Nothing else is needed.

## Notes

The loader keeps widgets in memory. A long list is loaded in pages.

A second paragraph about the loader, long enough to wrap onto more than one line in a narrow
tab, so that a rendered file has something to scroll.

## Licence

MIT.
`

const README_BASE = README_HEAD.replace(
  'A long list is loaded in pages.',
  'Lists are loaded whole.'
)

const APP_HEAD = `import { formatValue } from './util/format'
import { loadWidgets } from './loader'

export function startApp(count: number): string {
  const widgets = loadWidgets(count)
  return formatValue(widgets.length)
}
`

const APP_BASE = `import { formatValue } from './util/format'

export function startApp(count: number): string {
  return formatValue(count)
}
`

const FORMAT = `export function formatValue(value: number): string {
  return \`\${value} widgets\`
}
`

const LOADER = `export function loadWidgets(count: number): string[] {
  return Array.from({ length: count }, (_, i) => \`widget \${i + 1}\`)
}
`

const OLD = `// Kept for the old dashboard; removed by the rework.
export const legacy = true
`

export type Files = Record<string, string>

export const BASE_FILES: Files = {
  'README.md': README_BASE,
  'src/app.ts': APP_BASE,
  'src/long.ts': longFile(false),
  'src/old.ts': OLD,
  'src/util/format.ts': FORMAT,
}

export const HEAD_FILES: Files = {
  'README.md': README_HEAD,
  'src/app.ts': APP_HEAD,
  'src/loader.ts': LOADER,
  'src/long.ts': longFile(true),
  'src/util/format.ts': FORMAT,
}

/** The files at a ref: a branch name or either commit. */
export function filesAt(ref: string): Files | null {
  if (ref === 'main' || ref === HEAD_SHA || ref === 'HEAD' || ref === FIRST_SHA) return HEAD_FILES
  if (ref === BASE_SHA) return BASE_FILES
  return null
}

type Op = { type: ' ' | '-' | '+'; text: string; old?: number; new?: number }

/** A line diff by longest common subsequence — the files are small enough for the square. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i], old: i + 1, new: j + 1 })
      i++
      j++
    } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // A removed line before the line that replaces it, as GitHub writes them.
      ops.push({ type: '-', text: a[i], old: i + 1 })
      i++
    } else {
      ops.push({ type: '+', text: b[j], new: j + 1 })
      j++
    }
  }
  return ops
}

const splitLines = (text: string) => (text ? text.replace(/\n$/, '').split('\n') : [])

/** A unified diff as GitHub puts it in a file's `patch`: hunks with three lines of context. */
export function unifiedPatch(before: string, after: string): string {
  const ops = diffLines(splitLines(before), splitLines(after))
  const changed = ops.map((op, i) => (op.type === ' ' ? -1 : i)).filter((i) => i >= 0)
  if (!changed.length) return ''
  const hunks: Array<[number, number]> = []
  for (const i of changed) {
    const from = Math.max(0, i - 3)
    const to = Math.min(ops.length - 1, i + 3)
    const last = hunks[hunks.length - 1]
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else hunks.push([from, to])
  }
  const out: string[] = []
  for (const [from, to] of hunks) {
    const part = ops.slice(from, to + 1)
    const olds = part.filter((o) => o.type !== '+')
    const news = part.filter((o) => o.type !== '-')
    const oldStart = olds[0]?.old ?? (ops.slice(0, from).filter((o) => o.type !== '+').length || 0)
    const newStart = news[0]?.new ?? (ops.slice(0, from).filter((o) => o.type !== '-').length || 0)
    out.push(`@@ -${oldStart},${olds.length} +${newStart},${news.length} @@`)
    for (const o of part) out.push(`${o.type}${o.text}`)
  }
  return out.join('\n')
}

/** A changed file as the REST API lists it. */
export function changedFiles(before: Files, after: Files, web: string, sha: string) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return paths
    .filter((p) => before[p] !== after[p])
    .map((p) => {
      const patch = unifiedPatch(before[p] ?? '', after[p] ?? '')
      const lines = patch.split('\n')
      return {
        filename: p,
        status: !(p in before) ? 'added' : !(p in after) ? 'removed' : 'modified',
        additions: lines.filter((l) => l.startsWith('+')).length,
        deletions: lines.filter((l) => l.startsWith('-')).length,
        patch,
        blob_url: `${web}/${OWNER}/${REPO}/blob/${sha}/${p}`,
      }
    })
}

/** GitHub's `#diff-<hash>`: the SHA-256 of the path. */
export const diffHash = (path: string) => createHash('sha256').update(path).digest('hex')

/** A gzipped ustar archive, the files under one folder as GitHub's tarballs have them. */
export function tarball(files: Files, folder: string): Buffer {
  const blocks: Buffer[] = []
  const header = (name: string, size: number, type: '0' | '5') => {
    const h = Buffer.alloc(512)
    h.write(name, 0, 100, 'utf8')
    h.write(type === '5' ? '0000755\0' : '0000644\0', 100)
    h.write('0000000\0', 108)
    h.write('0000000\0', 116)
    h.write(size.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write('        ', 148)
    h.write(type, 156)
    h.write('ustar\0' + '00', 257)
    let sum = 0
    for (const byte of h) sum += byte
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    return h
  }
  const dirs = new Set<string>([folder])
  for (const path of Object.keys(files)) {
    const parts = path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) dirs.add(`${folder}/${parts.slice(0, i).join('/')}`)
  }
  for (const dir of [...dirs].sort()) blocks.push(header(`${dir}/`, 0, '5'))
  for (const [path, text] of Object.entries(files)) {
    const body = Buffer.from(text, 'utf8')
    blocks.push(header(`${folder}/${path}`, body.length, '0'))
    blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const user = (login: string) => ({ login })

const paragraph = (i: number) =>
  `A longer thought about the change, number ${i}. It goes on for a while so that the ` +
  `conversation takes more than one screen, and a link to a late comment has to scroll.`

/** Everything the REST and GraphQL answers are built from, for one web origin. */
export function fixtures(web: string) {
  const repoWeb = `${web}/${OWNER}/${REPO}`
  const pullComments = Array.from({ length: 15 }, (_, i) => ({
    id: LATE_COMMENT - 14 + i,
    user: user(['bob', 'carol', 'dave'][i % 3]),
    body: `Comment ${i + 1}.\n\n${paragraph(i)}\n\n${paragraph(i + 100)}`,
    created_at: `2026-09-02T10:${String(10 + i).padStart(2, '0')}:00Z`,
    html_url: `${repoWeb}/pull/${PULL}#issuecomment-${LATE_COMMENT - 14 + i}`,
  }))
  const issueComments = Array.from({ length: 12 }, (_, i) => ({
    id: ISSUE_COMMENT - 11 + i,
    user: user(['erin', 'frank'][i % 2]),
    body: `Issue comment ${i + 1}.\n\n${paragraph(i)}`,
    created_at: `2026-08-02T10:${String(10 + i).padStart(2, '0')}:00Z`,
    html_url: `${repoWeb}/issues/${ISSUE}#issuecomment-${ISSUE_COMMENT - 11 + i}`,
  }))
  const files = changedFiles(BASE_FILES, HEAD_FILES, web, HEAD_SHA)
  const pull = {
    title: 'Rework the widget loader',
    number: PULL,
    html_url: `${repoWeb}/pull/${PULL}`,
    user: user('alice'),
    created_at: '2026-09-01T10:00:00Z',
    state: 'open',
    draft: false,
    labels: [{ name: 'enhancement', color: 'a2eeef' }],
    body: 'Reworks the loader so a long list loads in pages.\n\nSee the notes in the README.',
    base: { ref: 'main', sha: BASE_SHA },
    head: { label: 'alice:loader', ref: 'loader', sha: HEAD_SHA },
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changed_files: files.length,
    commits: 2,
  }
  const commit = (sha: string, parent: string, message: string, list: unknown[]) => ({
    sha,
    html_url: `${repoWeb}/commit/${sha}`,
    commit: { message, author: { name: 'alice', date: '2026-09-01T09:00:00Z' } },
    author: user('alice'),
    parents: [{ sha: parent }],
    files: list,
  })
  return {
    repo: { name: REPO, full_name: `${OWNER}/${REPO}`, default_branch: 'main' },
    pull,
    pullComments,
    reviews: [
      {
        id: 9001,
        user: user('erin'),
        body: 'Looks fine overall.',
        state: 'APPROVED',
        submitted_at: '2026-09-03T10:00:00Z',
        html_url: `${repoWeb}/pull/${PULL}#pullrequestreview-9001`,
      },
    ],
    reviewComments: [
      {
        id: 5501,
        path: 'src/app.ts',
        user: user('frank'),
        body: 'Why load them all at once?',
        created_at: '2026-09-03T11:00:00Z',
        side: 'RIGHT',
        line: 5,
        original_line: 5,
        html_url: `${repoWeb}/pull/${PULL}#discussion_r5501`,
      },
    ],
    files,
    commits: [
      commit(FIRST_SHA, BASE_SHA, 'Add the loader', []),
      commit(HEAD_SHA, FIRST_SHA, 'Rework the widget loader\n\nPages a long list.', []),
    ],
    commitDetail: (sha: string) =>
      sha === HEAD_SHA
        ? commit(HEAD_SHA, BASE_SHA, 'Rework the widget loader\n\nPages a long list.', files)
        : sha === FIRST_SHA
          ? commit(FIRST_SHA, BASE_SHA, 'Add the loader', files.slice(0, 1))
          : null,
    issue: {
      title: 'Loader hangs on an empty list',
      number: ISSUE,
      html_url: `${repoWeb}/issues/${ISSUE}`,
      user: user('bob'),
      created_at: '2026-08-01T10:00:00Z',
      state: 'open',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      body: 'Starting the app with no widgets never returns.',
    },
    issueComments,
    discussion: {
      title: 'How should paging work?',
      number: DISCUSSION,
      url: `${repoWeb}/discussions/${DISCUSSION}`,
      body: 'Pages of fifty, or of a hundred?',
      createdAt: '2026-08-20T10:00:00Z',
      closed: false,
      isAnswered: true,
      author: user('carol'),
      category: { name: 'Ideas' },
      labels: { nodes: [] },
      comments: {
        totalCount: 2,
        nodes: [
          {
            id: 'DC_1',
            databaseId: 301,
            body: 'Fifty reads better on a phone.',
            createdAt: '2026-08-21T10:00:00Z',
            isAnswer: true,
            url: `${repoWeb}/discussions/${DISCUSSION}#discussioncomment-301`,
            author: user('dave'),
            replies: {
              totalCount: 1,
              nodes: [
                {
                  id: 'DC_2',
                  databaseId: 302,
                  body: 'Agreed.',
                  createdAt: '2026-08-21T11:00:00Z',
                  url: `${repoWeb}/discussions/${DISCUSSION}#discussioncomment-302`,
                  author: user('bob'),
                },
              ],
            },
          },
          {
            id: 'DC_3',
            databaseId: 303,
            body: 'A hundred is fewer requests.',
            createdAt: '2026-08-22T10:00:00Z',
            isAnswer: false,
            url: `${repoWeb}/discussions/${DISCUSSION}#discussioncomment-303`,
            author: user('erin'),
            replies: { totalCount: 0, nodes: [] },
          },
        ],
      },
    },
  }
}
