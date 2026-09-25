#!/usr/bin/env node
/**
 * Keeps what does not belong in a public repository out of it: stray tool output, build
 * results, oversized files, credentials, and paths that name someone's home directory.
 *
 * Usage (from anywhere inside the repository):
 *   node plugin/scripts/repo-guard.mjs --staged          # what `git commit` is about to record
 *   node plugin/scripts/repo-guard.mjs --range A..B      # every commit in A..B, one by one
 *   node plugin/scripts/repo-guard.mjs --all             # every tracked file as it is now
 *
 * Exits 1 when anything is refused, 0 otherwise; warnings never fail. No dependencies, so the
 * pre-commit hook runs it before `node_modules` exists. What is allowed lives in
 * `repo-guard.json` beside this file; the rules and how to allow something on purpose are in
 * `docs/Repository guard.md`.
 *
 * A matched credential is never printed whole — only its first characters and its length.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'repo-guard.json')
const CONFIG_NAME = 'plugin/scripts/repo-guard.json'
export const ALLOW_MARKER = 'repo-guard: allow'

// ---------------------------------------------------------------------------------------------
// Paths

/** `**` crosses folders, `*` and `?` do not. Anchored at both ends. */
export function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += glob[i + 2] === '/' ? 2 : 1
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

const matchesAny = (file, globs = []) => globs.some((g) => globToRegExp(g).test(file))

const JUNK_DIRS = new Map([
  ['.playwright-mcp', 'browser-automation output (console logs, page snapshots)'],
  ['playwright-report', 'test report output'],
  ['test-results', 'test report output'],
  ['node_modules', 'installed dependencies'],
  ['coverage', 'coverage report'],
  ['.nyc_output', 'coverage report'],
  ['build', 'build output'],
  ['dist', 'build output'],
  ['.cache', 'cache'],
  ['.vite', 'cache'],
  ['tmp', 'scratch files'],
  ['.tmp', 'scratch files'],
  ['__pycache__', 'cache'],
  ['.idea', 'editor settings'],
  ['.vscode', 'editor settings'],
  ['.obsidian', 'vault settings (may hold plugin data and keys)'],
  ['.trash', 'vault trash'],
  ['.claude', 'local agent files'],
  ['.orca', 'local agent files'],
  ['.superpowers', 'local agent files'],
  ['.llm', 'local agent files'],
])

const JUNK_FILES = [
  [/^\.DS_Store$|^Thumbs\.db$|^desktop\.ini$/, 'operating-system metadata'],
  [/^CLAUDE\.md$/, 'local agent instructions'],
  [/^data\.json$/, "Obsidian plugin data (holds a user's settings)"],
  [/^\.env(\..+)?$|\.env$/, 'environment file (credentials)', /\.(example|sample|template)$/],
  [/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, 'SSH key'],
  [/\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn)$/i, 'key or certificate'],
  [/\.(log|har|heapsnapshot|cpuprofile|trace)$/i, 'log or runtime dump'],
  [/\.(abchat)$/i, 'chat log from a vault'],
  [/\.(sqlite3?|db)$/i, 'database file'],
  [/\.(swp|swo|orig|rej|bak)$|~$/i, 'editor or merge leftover'],
  [/\.map$/i, 'source map (build output)'],
  [/\.(zip|tgz|7z|rar|dmg|vsix)$/i, 'archive'],
]

const MEDIA = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|mp4|mov|webm|avi)$/i

/**
 * Checks one path that a commit adds or changes. `size` is in bytes, or undefined when it is
 * not known. Returns the problems found, each `{ level, kind, file, message }`.
 */
export function checkPath(file, size, config) {
  const allow = config.allow ?? {}
  const found = []
  const refuse = (message, key) =>
    found.push({
      level: 'error',
      kind: 'path',
      file,
      message: `${message} If it belongs here on purpose, add it to "${key}" in ${CONFIG_NAME}.`,
    })

  const parts = file.split('/')
  let junk = false
  if (!matchesAny(file, allow.junk)) {
    const dir = parts.slice(0, -1).find((p) => JUNK_DIRS.has(p))
    const base = parts[parts.length - 1]
    const rule = JUNK_FILES.find(
      ([re, , except]) => re.test(base) && !(except && except.test(base))
    )
    junk = Boolean(dir || rule)
    if (dir) refuse(`${dir}/ is ${JUNK_DIRS.get(dir)}, not source.`, 'allow.junk')
    else if (rule) refuse(`looks like ${rule[1]}.`, 'allow.junk')
    else if (MEDIA.test(base) && !matchesAny(file, allow.images))
      refuse('is a picture or video outside the folders meant for them.', 'allow.images')
  }

  // Junk already says what is wrong; the layout would only repeat it less usefully.
  for (const [dir, children] of junk ? [] : Object.entries(config.layout ?? {})) {
    const prefix = dir === '.' ? [] : dir.split('/')
    if (parts.length <= prefix.length) continue
    if (!prefix.every((p, i) => parts[i] === p)) continue
    const child = parts[prefix.length]
    if (!children.includes(child)) {
      const where = dir === '.' ? 'the repository root' : `${dir}/`
      refuse(`"${child}" is new in ${where}, which only holds known entries.`, `layout["${dir}"]`)
    }
  }

  const max = config.maxBytes ?? 1024 * 1024
  if (size !== undefined && size > max && !matchesAny(file, allow.large))
    refuse(`is ${formatBytes(size)}, over the ${formatBytes(max)} limit.`, 'allow.large')
  return found
}

const formatBytes = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`

// ---------------------------------------------------------------------------------------------
// Contents

/** Shannon entropy in bits per character — random keys sit above ~3.5, words below. */
export function entropy(s) {
  const counts = {}
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1
  return Object.values(counts).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0)
}

const hasDigitAndLetter = (s) => /\d/.test(s) && /[A-Za-z]/.test(s)
const PLACEHOLDER =
  /example|sample|dummy|fake|placeholder|changeme|your|redacted|xxxx|\*\*\*|<|>|\$\{|\{\{/i

/** Each rule: a name, a regex whose group 1 (or whole match) is the secret, and an optional test. */
export const SECRET_RULES = [
  { name: 'GitHub token', re: /(?<![\w-])((?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36,})/g },
  { name: 'GitHub token', re: /(?<![\w-])(github_pat_[A-Za-z0-9_]{50,})/g },
  { name: 'Anthropic key', re: /(?<![\w-])(sk-ant-[A-Za-z0-9_-]{20,})/g },
  { name: 'OpenRouter key', re: /(?<![\w-])(sk-or-[A-Za-z0-9_-]{20,})/g },
  {
    name: 'OpenAI-style key',
    re: /(?<![\w-])(sk-(?!ant-|or-)[A-Za-z0-9_-]{20,})/g,
    test: (s) => hasDigitAndLetter(s.slice(3)) && entropy(s) > 3.5,
  },
  { name: 'AWS access key', re: /(?<![A-Z0-9])((?:AKIA|ASIA)[0-9A-Z]{16})(?![A-Z0-9])/g },
  { name: 'Google API key', re: /(?<![\w-])(AIza[0-9A-Za-z_-]{35})/g },
  { name: 'Slack token', re: /(?<![\w-])(xox[abposr]-[0-9A-Za-z-]{10,})/g },
  { name: 'Stripe key', re: /(?<![\w-])((?:sk|rk)_live_[0-9A-Za-z]{16,})/g },
  { name: 'npm token', re: /(?<![\w-])(npm_[A-Za-z0-9]{36})/g },
  { name: 'Hugging Face token', re: /(?<![\w-])(hf_[A-Za-z0-9]{34,})/g },
  { name: 'private key', re: /(-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----)/g },
  {
    name: 'JWT',
    re: /(?<![\w-])(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
  },
  {
    name: 'password in a URL',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`<>]+:([^\s/@'"`<>]+)@[^\s/'"`<>]+/gi,
    test: (s) => !PLACEHOLDER.test(s) && !/^(pass(word)?|pwd|secret|token|x+|\$\w+)$/i.test(s),
  },
  {
    name: 'credential assignment',
    re: /(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?key|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/gi,
    test: (s) => hasDigitAndLetter(s) && entropy(s) > 3.5 && !PLACEHOLDER.test(s),
  },
  {
    name: 'credential assignment',
    re: /\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY)\s*=\s*([^\s"'`$]{16,})/g,
    test: (s) => hasDigitAndLetter(s) && entropy(s) > 3.5 && !PLACEHOLDER.test(s),
  },
  {
    name: 'bearer token',
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{24,}=*)/g,
    test: (s) => hasDigitAndLetter(s) && entropy(s) > 3.5 && !PLACEHOLDER.test(s),
  },
]

/** The first few characters and the length — enough to find it, not enough to use it. */
export function mask(secret) {
  const shown = Math.min(4, Math.floor(secret.length / 4))
  return `${secret.slice(0, shown)}…(${secret.length} chars)`
}

/** Names a home directory folders use in examples; anything else is taken to be a real one. */
const EXAMPLE_USERS = new Set(
  'username user user1 you yourname your-name name me example someone john jane alice bob runner'.split(
    ' '
  )
)
const HOME_PATH = /(?:\/(?:Users|home)\/|[A-Za-z]:\\\\?Users\\\\?)([^\s/\\'"`)]+)/g

/**
 * Reads the owner's private patterns: one regular expression per line, `#` starts a comment,
 * a leading `(?i)` makes it case-insensitive. A missing file is no patterns at all.
 */
export function loadLocalPatterns(file) {
  if (!file || !fs.existsSync(file)) return []
  const patterns = []
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim()
      if (!line || line.startsWith('#')) return
      const insensitive = line.startsWith('(?i)')
      try {
        patterns.push({
          index: i + 1,
          re: new RegExp(insensitive ? line.slice(4) : line, insensitive ? 'gi' : 'g'),
        })
      } catch (e) {
        throw new Error(
          `repo-guard: line ${i + 1} of ${file} is not a valid regular expression: ${e.message}`
        )
      }
    })
  return patterns
}

const isDocs = (file) => file.startsWith('docs/') || /^[^/]+\.md$/.test(file)

/** Checks one added line. `lineNo` may be undefined when the line number is not known. */
export function checkLine(file, lineNo, text, config, localPatterns = []) {
  if (text.includes(ALLOW_MARKER)) return []
  const where = lineNo === undefined ? file : `${file}:${lineNo}`
  const found = []
  const add = (level, kind, message) => found.push({ level, kind, file: where, message })

  for (const rule of SECRET_RULES) {
    for (const m of text.matchAll(rule.re)) {
      const secret = m[1] ?? m[0]
      if (rule.test && !rule.test(secret)) continue
      add(
        'error',
        'secret',
        `${rule.name} ${mask(secret)}. Take it out and revoke it — it is in your history until the commit is rewritten. A made-up value in a test takes "${ALLOW_MARKER}" in a comment on the same line.`
      )
    }
  }

  for (const p of localPatterns) {
    for (const m of text.matchAll(p.re)) {
      if (!m[0]) break
      add(
        'error',
        'private',
        `private pattern #${p.index} from your local patterns file matches ${mask(m[0])}.`
      )
    }
  }

  if (!matchesAny(file, config.allow?.homePaths)) {
    for (const m of text.matchAll(HOME_PATH)) {
      const user = m[1]
      if (EXAMPLE_USERS.has(user.toLowerCase()) || /^[<${%]/.test(user)) continue
      add(
        'error',
        'home',
        `names a real home directory (${m[0].slice(0, m[0].length - user.length)}${mask(user)}). Use a made-up path such as /Users/username/, or add the file to "allow.homePaths" in ${CONFIG_NAME}.`
      )
    }
  }

  if (isDocs(file)) {
    // `~/.config/…` and other dot-folders are settings, not somebody's vault.
    for (const m of text.matchAll(/(?<![\w.])~\/(?![.…])[^\s`'")\]…]+/g)) {
      add(
        'warn',
        'docs',
        `${m[0]} is a path in someone's home folder. Docs use made-up example paths, never a real vault.`
      )
    }
  }
  return found
}

/**
 * Splits a `git diff -U0` / `git show -U0` into added lines: `{ file, lineNo, text }`.
 * Needs `core.quotePath=false`, so paths arrive unquoted.
 */
export function parseAddedLines(diff) {
  const lines = []
  let file = null
  let lineNo = 0
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false
      file = null
    } else if (!inHunk && line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(4).replace(/^b\//, '')
    } else if (line.startsWith('@@')) {
      const m = /^@@ -\S+ \+(\d+)/.exec(line)
      lineNo = m ? Number(m[1]) : 0
      inHunk = true
    } else if (inHunk && file) {
      if (line.startsWith('+')) lines.push({ file, lineNo: lineNo++, text: line.slice(1) })
      else if (line.startsWith(' ')) lineNo++
    }
  }
  return lines
}

// ---------------------------------------------------------------------------------------------
// Git

const git = (args, input) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input,
  })

/** `git diff --name-status -z` output → paths added, copied, modified or renamed to. */
function changedPaths(nameStatusZ) {
  const fields = nameStatusZ.split('\0').filter(Boolean)
  const paths = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i]
    if (status[0] === 'R' || status[0] === 'C') {
      paths.push(fields[i + 2])
      i += 2
    } else {
      if (status[0] !== 'D') paths.push(fields[i + 1])
      i += 1
    }
  }
  return paths
}

/** Object sizes for `rev:path` specs, in one `git cat-file` call. */
function blobSizes(specs) {
  if (specs.length === 0) return []
  const out = git(
    ['cat-file', '--batch-check=%(objecttype) %(objectsize)'],
    specs.join('\n') + '\n'
  )
  return out
    .trim()
    .split('\n')
    .map((l) => (l.startsWith('blob ') ? Number(l.split(' ')[1]) : undefined))
}

const DIFF = ['-U0', '--no-color', '--no-ext-diff', '--no-textconv']

/** One unit of work: the paths it touches with their sizes, and the lines it adds. */
function stagedUnit() {
  const paths = changedPaths(git(['diff', '--cached', '--name-status', '-z', '-M']))
  const sizes = blobSizes(paths.map((p) => `:${p}`))
  return {
    label: 'staged',
    paths: paths.map((p, i) => [p, sizes[i]]),
    lines: parseAddedLines(git(['diff', '--cached', '-M', ...DIFF])),
  }
}

function commitUnit(sha) {
  const paths = changedPaths(
    git(['diff-tree', '-r', '-M', '--root', '--no-commit-id', '--name-status', '-z', sha])
  )
  const sizes = blobSizes(paths.map((p) => `${sha}:${p}`))
  const diff = git(['show', '--format=', '-M', ...DIFF, sha])
  return {
    label: sha.slice(0, 7),
    paths: paths.map((p, i) => [p, sizes[i]]),
    lines: parseAddedLines(diff),
  }
}

function treeUnit(root) {
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean)
  const paths = []
  const lines = []
  for (const file of files) {
    const abs = path.join(root, file)
    if (!fs.existsSync(abs)) continue
    const buf = fs.readFileSync(abs)
    paths.push([file, buf.length])
    if (buf.subarray(0, 8000).includes(0)) continue
    buf
      .toString('utf8')
      .split('\n')
      .forEach((text, i) => lines.push({ file, lineNo: i + 1, text }))
  }
  return { label: 'tree', paths, lines }
}

export function checkUnit(unit, config, localPatterns) {
  const found = []
  for (const [file, size] of unit.paths) {
    found.push(...checkPath(file, size, config))
    for (const p of localPatterns) {
      p.re.lastIndex = 0
      if (p.re.test(file))
        found.push({
          level: 'error',
          kind: 'private',
          file,
          message: `the path matches private pattern #${p.index} from your local patterns file.`,
        })
    }
  }
  for (const { file, lineNo, text } of unit.lines)
    found.push(...checkLine(file, lineNo, text, config, localPatterns))
  return found
}

function main(argv) {
  const mode = argv[0]
  if (!['--staged', '--range', '--all'].includes(mode) || (mode === '--range' && !argv[1])) {
    console.error('usage: repo-guard.mjs --staged | --range <base>..<head> | --all')
    return 2
  }
  const root = git(['rev-parse', '--show-toplevel']).trim()
  process.chdir(root)
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const patternsFile =
    process.env.ABELE_GUARD_PATTERNS || path.join(os.homedir(), '.config/abele/guard-patterns.txt')
  const localPatterns = loadLocalPatterns(patternsFile)

  let units
  if (mode === '--staged') units = [stagedUnit()]
  else if (mode === '--all') units = [treeUnit(root)]
  else {
    const shas = git(['rev-list', '--no-merges', '--reverse', argv[1]]).split('\n').filter(Boolean)
    units = shas.map(commitUnit)
  }

  const seen = new Set()
  const problems = []
  for (const unit of units) {
    for (const p of checkUnit(unit, config, localPatterns)) {
      const key = `${p.level}|${p.file}|${p.message}`
      if (seen.has(key)) continue
      seen.add(key)
      problems.push({ ...p, unit: unit.label })
    }
  }

  const errors = problems.filter((p) => p.level === 'error')
  const warnings = problems.filter((p) => p.level === 'warn')
  for (const p of [...errors, ...warnings]) {
    const tag = p.level === 'error' ? 'error' : 'warn '
    const commit = mode === '--range' ? ` [${p.unit}]` : ''
    console.log(`  ${tag} ${p.kind.padEnd(7)} ${p.file}${commit} — ${p.message}`)
  }
  const scope =
    mode === '--range'
      ? `${units.length} commit(s) in ${argv[1]}`
      : mode === '--all'
        ? 'the tracked tree'
        : 'the staged changes'
  if (errors.length) {
    console.log(
      `repo-guard: ${errors.length} problem(s) in ${scope}. See docs/Repository guard.md.`
    )
    return 1
  }
  console.log(
    `repo-guard: ${scope} clean${warnings.length ? `, ${warnings.length} warning(s)` : ''}${localPatterns.length ? ` (with ${localPatterns.length} private pattern(s))` : ''}.`
  )
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2))
}
