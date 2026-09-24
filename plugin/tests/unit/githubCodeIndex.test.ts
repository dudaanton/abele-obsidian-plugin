/**
 * The in-memory code index a GitHub tab searches: the archive GitHub sends for a commit, read
 * without a dependency, and the search over what it holds.
 *
 * The fixture is a real `git archive --format=tar.gz` — the same shape GitHub's tarball is: a
 * pax global header naming the commit, everything under one `owner-repo-sha/` folder, a path long
 * enough to need a pax header of its own, a symlink and a binary file.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { gzipSync } from 'fflate'
import { gunzip, readTar, stripRoot } from '@/github/search/tar'
import { IndexCache, RepoIndex, searchFiles } from '@/github/search/repoIndex'
import {
  compileQuery,
  globMatcher,
  matchRanges,
  QueryError,
  searchText,
} from '@/github/search/textSearch'

const archive = new Uint8Array(
  readFileSync(resolve(__dirname, '../fixtures/github/widgets.tar.gz'))
)
const LONG =
  'lib/deep/very/long/directory/name/that/keeps/going/and/going/until/it/passes/one/hundred/bytes/deep.py'

describe('reading a GitHub archive', () => {
  it('gunzips and lists every regular file, a path past a hundred bytes included', async () => {
    const tar = await gunzip(archive)
    const paths = [...readTar(tar)].map((e) => stripRoot(e.path))
    expect(paths.sort()).toEqual(
      ['README.md', 'docs/logo.png', LONG, 'main.go', 'src/app.ts', 'src/util/format.ts'].sort()
    )
  })

  it('gives each file its own bytes', async () => {
    const tar = await gunzip(archive)
    const readme = [...readTar(tar)].find((e) => e.path.endsWith('README.md'))!
    expect(new TextDecoder().decode(readme.data)).toBe('# Widgets\n\nA widget renders its name.\n')
  })

  it('stops at the end-of-archive blocks rather than reading padding as files', () => {
    expect([...readTar(new Uint8Array(1024))]).toEqual([])
  })
})

describe('the index', () => {
  const build = async (maxFileBytes?: number) =>
    RepoIndex.fromTar(await gunzip(archive), { maxFileBytes })

  it('keeps the text files and names the binary one without keeping it', async () => {
    const index = await build()
    expect(index.files.map((f) => f.path)).not.toContain('docs/logo.png')
    expect(index.paths).toContain('docs/logo.png')
    expect(index.binary).toBe(1)
    expect(index.bytes).toBeGreaterThan(0)
  })

  it('leaves out a file past the size cap', async () => {
    const index = await build(100)
    expect(index.file('src/app.ts')).toBeUndefined()
    expect(index.file('README.md')).toBeDefined()
    expect(index.oversized).toBeGreaterThan(0)
  })

  it('finds a word, one result per line, with its line number and column', async () => {
    const index = await build()
    const result = await index.search({ text: 'formatName' })
    expect(result.files.map((f) => f.path)).toEqual(['src/app.ts', 'src/util/format.ts'])
    const app = result.files[0].matches
    expect(app.map((m) => m.line)).toEqual([1, 7])
    expect(app[0].column).toBe(9)
    expect(app[1].text.trim()).toBe('return formatName(this.name)')
  })

  it('matches letter case only when asked', async () => {
    const index = await build()
    expect((await index.search({ text: 'widget' })).total).toBeGreaterThan(1)
    const exact = await index.search({ text: 'widget', caseSensitive: true })
    expect(exact.files.map((f) => f.path)).toEqual(['README.md'])
  })

  it('takes a regular expression, and says so when it is not one', async () => {
    const index = await build()
    const result = await index.search(
      { text: '^(export )?(function|class) \\w+', regex: true },
      { glob: '*.ts' }
    )
    expect(result.files.flatMap((f) => f.matches.map((m) => `${f.path}:${m.line}`))).toEqual([
      'src/app.ts:3',
      'src/app.ts:11',
    ])
    await expect(index.search({ text: '(', regex: true })).rejects.toBeInstanceOf(QueryError)
  })

  it('narrows to a path glob', async () => {
    const index = await build()
    const py = await index.search({ text: 'name' }, { glob: '*.py' })
    expect(py.files.map((f) => f.path)).toEqual([LONG])
    const src = await index.search({ text: 'name' }, { glob: 'src/**' })
    expect(src.files.every((f) => f.path.startsWith('src/'))).toBe(true)
  })

  it('stops at the limit and says there is more', async () => {
    const index = await build()
    const result = await index.search({ text: 'name' }, { limit: 2 })
    expect(result.files.reduce((n, f) => n + f.matches.length, 0)).toBe(2)
    expect(result.capped).toBe(true)
  })

  it('can be cancelled', async () => {
    const index = await build()
    const abort = new AbortController()
    abort.abort()
    await expect(index.search({ text: 'x' }, { signal: abort.signal })).rejects.toThrow(/cancel/)
  })
})

describe('searching text', () => {
  it('does not loop on a pattern that matches nothing at all', () => {
    expect(searchText('a\nb', compileQuery({ text: 'x*', regex: true }))).toEqual([])
    expect(matchRanges('abc', compileQuery({ text: '', regex: true }))).toEqual([])
  })

  it('finds whole words only, for references', () => {
    const re = compileQuery({ text: 'name', wholeWord: true, caseSensitive: true })
    expect(searchText('name\nrename\nname2\n(name)', re).map((m) => m.line)).toEqual([1, 4])
  })

  it('cuts a long line around the match', () => {
    const line = `${'x'.repeat(1000)}needle${'y'.repeat(1000)}`
    const [m] = searchText(line, compileQuery({ text: 'needle' }))
    expect(m.text.length).toBeLessThan(260)
    expect(m.text.slice(m.column, m.column + m.length)).toBe('needle')
  })

  it('reads a glob the usual ways', () => {
    expect(globMatcher('*.ts')('src/a/b.ts')).toBe(true)
    expect(globMatcher('src/*.ts')('src/a/b.ts')).toBe(false)
    expect(globMatcher('src/**/*.ts')('src/a/b.ts')).toBe(true)
    expect(globMatcher('src/**/*.ts')('src/b.ts')).toBe(true)
    expect(globMatcher('*.{ts,vue}')('x/y.vue')).toBe(true)
    expect(globMatcher('*.py, *.go')('main.go')).toBe(true)
    expect(globMatcher('')('anything')).toBe(true)
  })
})

describe('searching files that are not an archive', () => {
  it('searches any list of files the same way', async () => {
    const result = await searchFiles([{ path: 'a.ts', text: 'one\ntwo\none' }], { text: 'one' })
    expect(result.files[0].matches.map((m) => m.line)).toEqual([1, 3])
  })
})

describe('the cache of indexes', () => {
  const sized = (bytes: number) => Object.assign(new RepoIndex(), { bytes })

  it('drops the least recently used first', () => {
    const cache = new IndexCache(2)
    cache.set('a', sized(1))
    cache.set('b', sized(1))
    cache.get('a')
    cache.set('c', sized(1))
    expect(cache.keys()).toEqual(['a', 'c'])
  })

  it('drops old ones to stay under the memory cap, but always keeps the newest', () => {
    const cache = new IndexCache(10, 100)
    cache.set('a', sized(60))
    cache.set('b', sized(60))
    expect(cache.keys()).toEqual(['b'])
    cache.set('huge', sized(500))
    expect(cache.keys()).toEqual(['huge'])
  })
})

describe('the fallback decompressor', () => {
  it('gunzips without DecompressionStream too', async () => {
    const saved = globalThis.DecompressionStream
    // @ts-expect-error — removed to take the other road
    delete globalThis.DecompressionStream
    try {
      const out = await gunzip(gzipSync(new TextEncoder().encode('hello')))
      expect(new TextDecoder().decode(out)).toBe('hello')
    } finally {
      globalThis.DecompressionStream = saved
    }
  })
})
