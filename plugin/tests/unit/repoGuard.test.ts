/**
 * `scripts/repo-guard.mjs` refuses what should never reach the public repository.
 *
 * Every credential below is assembled at run time from pieces, so this file never holds one
 * whole shape — otherwise the guard, which reads this file too, would refuse its own tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error — a plain .mjs script with no type declarations
import * as guard from '../../scripts/repo-guard.mjs'

const SCRIPT = path.resolve(__dirname, '../../scripts/repo-guard.mjs')
const config = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../scripts/repo-guard.json'), 'utf8')
)

type Problem = { level: string; kind: string; file: string; message: string }
const check = (file: string, size?: number): Problem[] => guard.checkPath(file, size, config)
const scan = (text: string, file = 'plugin/src/x.ts', patterns: unknown[] = []): Problem[] =>
  guard.checkLine(file, 1, text, config, patterns)

const j = (...parts: string[]) => parts.join('')
const RANDOM = 'Q7vK2mXp9TzL4wRb8NcY3hGd6FsJ1aEu5VqWkZ0o'

const SECRETS: [string, string][] = [
  ['GitHub token', j('gh', 'p_', RANDOM.slice(0, 36))],
  ['GitHub token', j('github', '_pat_', RANDOM, '_', RANDOM)],
  ['Anthropic key', j('sk-', 'ant-', 'api03-', RANDOM)],
  ['OpenRouter key', j('sk-', 'or-', 'v1-', RANDOM)],
  ['OpenAI-style key', j('sk-', 'proj-', RANDOM)],
  ['AWS access key', j('AK', 'IA', 'Z3K7Q2M9X4B8N1V6')],
  ['Google API key', j('AI', 'za', 'Sy', RANDOM.slice(0, 33))],
  ['Slack token', j('xo', 'xb-', '1234567890-', RANDOM.slice(0, 20))],
  ['private key', j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----')],
  [
    'JWT',
    j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', RANDOM.slice(0, 30)),
  ],
  ['password in a URL', j('https://anton:', 'Hunter2Xq9', '@example.com/repo.git')],
  ['credential assignment', j('const apiKey = "', RANDOM.slice(0, 24), '"')],
  ['credential assignment', j('GITHUB_', 'TOKEN=', RANDOM.slice(0, 24))],
]

describe('paths', () => {
  it('passes the files the repository already holds', () => {
    for (const file of [
      'README.md',
      'plugin/src/main.ts',
      'assets/screens/time.jpg',
      'plugin/.prod.env.example',
      'docs/Testing.md',
    ])
      expect(check(file, 1000)).toEqual([])
  })

  it('refuses stray tool output anywhere, once, and says how to allow it', () => {
    for (const file of [
      '.playwright-mcp/console.log',
      'plugin/.playwright-mcp/page.yml',
      'plugin/src/.playwright-mcp/a.md',
    ]) {
      const found = check(file)
      expect(found).toHaveLength(1)
      expect(found[0].message).toContain('allow.junk')
    }
  })

  it('refuses junk by name', () => {
    for (const file of [
      'plugin/src/.DS_Store',
      'plugin/node_modules/x/index.js',
      'plugin/coverage/index.html',
      'plugin/build/main.js',
      'plugin/src/debug.log',
      'plugin/.env',
      'plugin/.env.local',
      'plugin/prod.env',
      'plugin/tests/cert.pem',
      'plugin/tests/id_ed25519',
      'plugin/tests/fixtures/Chat.abchat',
      'plugin/tests/.obsidian/plugins/abele/data.json',
      'plugin/src/CLAUDE.md',
    ])
      expect(check(file), file).toHaveLength(1)
  })

  it('refuses a new top-level entry, naming the list that would allow it', () => {
    const [found] = check('notes.txt')
    expect(found.message).toContain('the repository root')
    expect(found.message).toContain('layout["."]')
    expect(check('plugin/scratch.ts')[0].message).toContain('layout["plugin"]')
  })

  it('refuses a screenshot outside the picture folders', () => {
    expect(check('plugin/src/shot.png')[0].message).toContain('allow.images')
    expect(check('docs/assets/shot.png')).toEqual([])
    expect(check('plugin/tests/fixtures/page.png')).toEqual([])
  })

  it('refuses a big file unless it is allowed by name', () => {
    expect(check('plugin/src/huge.json', 3 * 1024 * 1024)[0].message).toMatch(
      /3\.0 MB, over the 1\.0 MB limit.*allow\.large/
    )
    expect(check('assets/abele_preview.jpg', 3 * 1024 * 1024)).toEqual([])
    expect(check('plugin/src/huge.json', 900 * 1024)).toEqual([])
  })

  it('lets the config allow a junk path on purpose', () => {
    const allowed = { ...config, allow: { ...config.allow, junk: ['plugin/tests/fixtures/**'] } }
    expect(guard.checkPath('plugin/tests/fixtures/sample.log', 10, allowed)).toEqual([])
  })
})

describe('secrets', () => {
  it.each(SECRETS)('finds a %s', (name, text) => {
    const found = scan(text)
    expect(
      found.map((p) => p.message.split(' ').slice(0, name.split(' ').length).join(' '))
    ).toContain(name)
    expect(found[0].level).toBe('error')
    expect(found[0].file).toBe('plugin/src/x.ts:1')
  })

  it('never prints a secret whole', () => {
    for (const [, text] of SECRETS) {
      for (const p of scan(text)) {
        expect(p.message).toMatch(/…\(\d+ chars\)/)
        const secretish = text.match(/[A-Za-z0-9_-]{16,}/)?.[0]
        if (secretish) expect(p.message).not.toContain(secretish)
      }
    }
    expect(guard.mask(j('gh', 'p_', RANDOM.slice(0, 36)))).toBe('ghp_…(40 chars)')
  })

  it('skips a line carrying the allow marker', () => {
    expect(scan(`${SECRETS[0][1]} // made up, ${guard.ALLOW_MARKER}`)).toEqual([])
  })

  it('leaves ordinary code alone', () => {
    for (const text of [
      'class="task-list-item-checkbox abele-task-view__description"',
      "const secret = { 'abele-openwebui': 'sk-super-secret-value' }",
      "const token = 'abele-github-token'",
      "password: 'your-password-here-please'",
      'const url = `https://${user}:${pass}@host`',
      'https://user:password@example.com',
      'headers: { Authorization: `Bearer ${token}` }',
      'const TOKEN_KEY = settings.githubTokenId',
    ])
      expect(scan(text), text).toEqual([])
  })
})

describe('personal paths', () => {
  it('refuses a real home directory and masks the name', () => {
    const [found] = scan(`const vault = '/Users/${'anton'}/obsidian/vault'`)
    expect(found.kind).toBe('home')
    expect(found.message).not.toContain('anton')
    expect(scan(`cd /home/${'deploy'}/app`)[0].kind).toBe('home')
  })

  it('lets an example user through', () => {
    expect(scan('TARGET="/Users/username/obsidian/.obsidian/plugins/abele"')).toEqual([])
    expect(scan('/home/runner/work/x')).toEqual([])
  })

  it('warns about a home-folder path in docs, without failing', () => {
    const [found] = scan('node gen.mjs --out ~/my-vault', 'docs/Testing.md')
    expect(found.level).toBe('warn')
    expect(scan('node gen.mjs --out ~/my-vault', 'plugin/src/x.ts')).toEqual([])
    expect(scan('patterns live in ~/.config/abele/guard-patterns.txt', 'docs/x.md')).toEqual([])
  })
})

describe('local patterns file', () => {
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-'))
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads one pattern per line, with comments and (?i)', () => {
    const file = path.join(dir, 'patterns.txt')
    fs.writeFileSync(file, '# private hosts\n\ninternal\\.corp\\.lan\n(?i)secretproject\n')
    const patterns = guard.loadLocalPatterns(file)
    expect(patterns).toHaveLength(2)
    const [found] = scan('fetch("https://build.internal.corp.lan/x")', 'plugin/src/x.ts', patterns)
    expect(found.kind).toBe('private')
    expect(found.message).toContain('#3')
    expect(found.message).not.toContain('internal.corp.lan')
    expect(scan('the SecretProject plan', 'plugin/src/x.ts', patterns)).toHaveLength(1)
  })

  it('is optional, and a broken pattern names its line', () => {
    expect(guard.loadLocalPatterns(path.join(dir, 'missing.txt'))).toEqual([])
    const file = path.join(dir, 'broken.txt')
    fs.writeFileSync(file, 'ok\n(unclosed\n')
    expect(() => guard.loadLocalPatterns(file)).toThrow(/line 2/)
  })
})

describe('diff parsing', () => {
  it('keeps added lines with their numbers and ignores headers', () => {
    const diff = [
      'diff --git a/docs/AI Agent.md b/docs/AI Agent.md',
      '--- a/docs/AI Agent.md',
      '+++ b/docs/AI Agent.md',
      '@@ -3,0 +4,2 @@ heading',
      '+first',
      '++++ a line that starts with pluses',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-removed',
    ].join('\n')
    expect(guard.parseAddedLines(diff)).toEqual([
      { file: 'docs/AI Agent.md', lineNo: 4, text: 'first' },
      { file: 'docs/AI Agent.md', lineNo: 5, text: '+++ a line that starts with pluses' },
    ])
  })
})

describe('against a real repository', () => {
  let repo: string
  // Inside the pre-commit hook git exports GIT_DIR, GIT_INDEX_FILE and friends. Passed on,
  // they point every command below at the repository being committed instead of the scratch
  // one — `git init` there once turned the real repository bare. None of them may leak through.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    ABELE_GUARD_PATTERNS: '/nonexistent/guard-patterns.txt',
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env,
    })
  const run = (...args: string[]) =>
    spawnSync('node', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', env })
  const write = (file: string, text: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-git-'))
    git('init', '-q')
    // Refuse to go on unless git really is working in the scratch folder.
    const top = git('rev-parse', '--show-toplevel').trim()
    if (fs.realpathSync(top) !== fs.realpathSync(repo)) throw new Error(`git resolved to ${top}`)
    write('plugin/src/main.ts', 'export {}\n')
    git('add', '.')
    git('commit', '-qm', 'init')
  })
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }))

  it('passes clean staged changes', () => {
    write('plugin/src/a.ts', 'export const a = 1\n')
    git('add', '.')
    const r = run('--staged')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('clean')
  })

  it('refuses a staged tool folder, a big file and a secret, without printing the secret', () => {
    const secret = j('gh', 'p_', RANDOM.slice(0, 36))
    write('.playwright-mcp/console.log', 'x\n')
    write('plugin/src/big.bin', Buffer.alloc(2 * 1024 * 1024))
    write('plugin/src/b.ts', `export const t = '${secret}'\n`)
    git('add', '.')
    const r = run('--staged')
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('.playwright-mcp/console.log')
    expect(r.stdout).toContain('plugin/src/big.bin')
    expect(r.stdout).toContain('plugin/src/b.ts:1')
    expect(r.stdout).not.toContain(secret)
    git('reset', '-q')
  })

  it('checks every commit of a range, so a secret removed later still counts', () => {
    const base = git('rev-parse', 'HEAD').trim()
    write('plugin/src/c.ts', `export const k = '${j('sk-', 'ant-', RANDOM)}'\n`)
    git('add', 'plugin/src/c.ts')
    git('commit', '-qm', 'add')
    write('plugin/src/c.ts', 'export const k = 1\n')
    git('commit', '-qam', 'remove')
    const r = run('--range', `${base}..HEAD`)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('Anthropic key')
  })
})
