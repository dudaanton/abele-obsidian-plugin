/**
 * The documentation for people, bundled with the plugin and opened as a view of its own.
 *
 * Three kinds of promise are held here. The shape: every page file is in the contents, so a
 * page written and never registered cannot sit unreachable in the bundle. The links: a page
 * pointing at a page or a heading that is not there is a dead end the reader only finds by
 * pressing it. And freshness, which no test can hold fully: every command in the palette and
 * every tab of the settings is at least named somewhere in the pages, so a feature added
 * without a word of documentation fails here and says which one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  USER_DOCS,
  findPage,
  resolveDocLink,
  searchUserDocs,
  plainText,
  unwrap,
  pageForSettingsTab,
} from '@/userdocs'
import { slug } from '@/docs'

const SRC = join(__dirname, '..', '..', 'src')
const DOCS_DIR = join(SRC, 'userdocs')

/** Code — fenced or inline — shows syntax as an example and is not prose to be checked. */
const withoutCode = (source: string) =>
  source.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '').replace(/`[^`\n]*`/g, '')

const links = (source: string) =>
  [...withoutCode(source).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])

const allText = USER_DOCS.map((p) => p.source).join('\n')

describe('the pages', () => {
  it('registers every page file in the contents, so none is unreachable', () => {
    const files = readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort()

    expect(USER_DOCS.map((p) => p.id).sort()).toEqual(files)
  })

  it('starts with getting started', () => {
    expect(USER_DOCS[0].id).toBe('getting-started')
  })

  it.each(USER_DOCS.map((p) => [p.id, p] as const))(
    '%s has a title, a summary and at least two sections',
    (_id, page) => {
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.summary.length).toBeGreaterThan(20)
      expect(page.headings.filter((h) => h.level === 2).length).toBeGreaterThanOrEqual(2)
    }
  )

  it.each(USER_DOCS.map((p) => [p.id, p] as const))(
    '%s has headings that can each be linked to',
    (_id, page) => {
      const ids = page.headings.map((h) => h.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  )

  it('finds a page by its id and nothing by a name it does not have', () => {
    expect(findPage('tasks')?.title).toBe('Tasks')
    expect(findPage('nope')).toBeNull()
  })
})

describe('links between pages', () => {
  const internal = USER_DOCS.flatMap((page) =>
    links(page.source)
      .filter((href) => !/^[a-z]+:/i.test(href))
      .map((href) => [page.id, href] as const)
  )

  it('are there to check', () => {
    // The guard on the guard: a parser that found no links would pass every page.
    expect(internal.length).toBeGreaterThan(15)
  })

  it.each(internal)('%s → %s resolves to a page and, when named, a heading', (from, href) => {
    const target = resolveDocLink(href, from)
    expect(target, href).not.toBeNull()
    if (href.includes('#')) expect(target?.heading, href).toBeTruthy()
  })

  it('resolves a bare heading within the page it is on', () => {
    expect(resolveDocLink('#priority-and-labels', 'tasks')).toEqual({
      page: 'tasks',
      heading: 'priority-and-labels',
    })
  })

  it('refuses a page that does not exist, and a heading its page does not have', () => {
    expect(resolveDocLink('nowhere', 'tasks')).toBeNull()
    expect(resolveDocLink('tasks#no-such-heading', 'tasks')).toBeNull()
  })

  it('are written one way: markdown links, no wikilinks outside code', () => {
    const offenders = USER_DOCS.filter((p) => /\[\[/.test(withoutCode(p.source))).map((p) => p.id)
    expect(offenders).toEqual([])
  })

  it('go out only to https addresses', () => {
    const external = USER_DOCS.flatMap((p) => links(p.source)).filter((h) => /^[a-z]+:/i.test(h))
    for (const href of external) expect(href).toMatch(/^https:\/\//)
  })
})

describe('search', () => {
  it('finds a word in the text, with the section it is under', () => {
    const hits = searchUserDocs('recurrence')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.page === 'tasks')).toBe(true)
  })

  it('ranks a section whose title holds the words above one that only mentions them', () => {
    const hits = searchUserDocs('synced keys')
    expect(hits[0].page).toBe('transfer')
    expect(hits[0].heading).toBe('synced-keys')
  })

  it('wants every word, in any order and case', () => {
    const both = searchUserDocs('TIMER header')
    expect(both.length).toBeGreaterThan(0)
    for (const hit of both) {
      const text = hit.snippet.map((s) => s.text).join('')
      expect(text.length).toBeGreaterThan(0)
    }
    expect(searchUserDocs('timer zzqx')).toEqual([])
  })

  it('matches the start of a word, so a word half typed already finds something', () => {
    expect(searchUserDocs('templ').length).toBeGreaterThan(0)
  })

  it('marks the words it matched in the snippet', () => {
    const [hit] = searchUserDocs('passphrase')
    const marked = hit.snippet.filter((s) => s.hit).map((s) => s.text.toLowerCase())
    expect(marked).toContain('passphrase')
  })

  it('keeps a snippet short and without markdown', () => {
    for (const hit of searchUserDocs('note')) {
      const text = hit.snippet.map((s) => s.text).join('')
      expect(text.length).toBeLessThanOrEqual(200)
      expect(text).not.toMatch(/\*\*|\]\(/)
    }
  })

  it('finds nothing for nothing', () => {
    expect(searchUserDocs('')).toEqual([])
    expect(searchUserDocs('   ')).toEqual([])
  })

  it('reads links and emphasis as the words they show', () => {
    expect(plainText('See [Tasks](tasks) and **bold** `code`.')).toBe('See Tasks and bold code.')
  })
})

/**
 * The files are wrapped at a hundred columns, as every markdown file in the repository is, and
 * Obsidian keeps a newline inside a paragraph as a line break unless the vault's owner turned
 * strict line breaks on. Rendered as written, every page came out broken mid-sentence.
 */
describe('what is handed to Obsidian to render', () => {
  it('joins the lines of a paragraph into one', () => {
    expect(unwrap('One sentence\nwrapped here.\n\nNext paragraph.')).toBe(
      'One sentence wrapped here.\n\nNext paragraph.'
    )
  })

  it('joins a list item with the lines that continue it, and keeps the items apart', () => {
    expect(unwrap('- first item\n  goes on\n- second\n1. numbered\n   too')).toBe(
      '- first item goes on\n- second\n1. numbered too'
    )
  })

  it('leaves code, tables, headings and quotes line by line', () => {
    const source = '## Heading\nText\n\n```yaml\na: 1\nb: 2\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quoted\n> more'
    expect(unwrap(source)).toBe(source)
  })

  it('leaves no line in any page broken mid-paragraph', () => {
    for (const page of USER_DOCS) {
      const lines = unwrap(page.source)
        .replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
        .split('\n')
      lines.forEach((line, i) => {
        const next = lines[i + 1] ?? ''
        const prose = (l: string) => /^[A-Za-z*([]/.test(l)
        if (prose(line) && prose(next)) throw new Error(`${page.id}: "${line}" / "${next}"`)
      })
    }
  })

  it('is what a page renders', () => {
    expect(USER_DOCS[0].rendered).toBe(unwrap(USER_DOCS[0].source))
  })
})

describe('plain text', () => {
  it('reads links and emphasis as the words they show, once more', () => {
    expect(plainText('See [Tasks](tasks) and **bold** `code`.')).toBe('See Tasks and bold code.')
  })
})

/**
 * Freshness. The pages are written by hand and nothing ties them to the code, so these are the
 * nudges: whoever adds a command or a settings tab is sent here to say a word about it.
 */
describe('what the pages must at least mention', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return walk(path)
      return /\.(ts|vue)$/.test(path) ? [path] : []
    })
  }

  /** Every command registered with a fixed name, wherever in the plugin it is registered. */
  const commands = walk(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/addCommand\(\{[\s\S]*?\bname:\s*(['"`])(.+?)\1/g)]
      .filter((m) => !m[2].includes('${'))
      .map((m) => [m[2], relative(SRC, file)] as const)
  )

  it('finds the commands it is meant to be checking', () => {
    expect(commands.length).toBeGreaterThan(40)
  })

  it.each(commands)('names the command "%s" (%s)', (name) => {
    expect(allText.toLowerCase()).toContain(name.toLowerCase())
  })

  const settingsSource = readFileSync(join(SRC, 'components/settings/Settings.vue'), 'utf8')
  const tabs = [...settingsSource.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map(
    (m) => [m[1], m[2]] as const
  )

  it('finds the settings tabs it is meant to be checking', () => {
    expect(tabs.length).toBeGreaterThan(8)
  })

  it.each(tabs)('gives the settings tab %s (%s) a section of the settings page', (_id, label) => {
    const settings = findPage('settings')!
    expect(settings.headings.map((h) => h.title)).toContain(label)
  })

  it.each(tabs)('knows which page the settings tab %s documents', (id) => {
    expect(findPage(pageForSettingsTab(id))).not.toBeNull()
  })

  /** The areas the plugin is made of; a page for each, so none is left to the settings page. */
  const areas = [
    'getting-started',
    'groups',
    'tasks',
    'logs-and-journals',
    'finance',
    'time-tracking',
    'templates',
    'ai-chat',
    'comments',
    'scripts',
    'github',
    'books',
    'writing',
    'transfer',
    'settings',
  ]

  it.each(areas)('has a page for %s', (id) => {
    expect(findPage(id)).not.toBeNull()
  })

  it('uses the same heading ids as the agent reference does', () => {
    expect(findPage('tasks')!.headings.map((h) => h.id)).toContain(slug('Priority and labels'))
  })
})
