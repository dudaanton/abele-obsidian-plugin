/**
 * The design standard in `docs/Design.md`, enforced.
 *
 * These read the component sources rather than rendering anything. Each rule exists because
 * breaking it produced a visible defect in the running app at least once:
 *
 * - a hand-styled `<button>` loses to Obsidian's `button:not(.clickable-icon)` and renders grey;
 * - a literal colour or length stops tracking the user's theme and zoom;
 * - an inline `style` attribute is a pattern nobody can find later;
 * - an unexplained `overflow-x` is how a pane starts scrolling sideways;
 * - an action with no tooltip leaves a person guessing what a glyph does.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..', 'src', 'components')

/**
 * What the standard covers today: the shared kit, every settings screen, and the chat
 * surfaces the agent work introduced. The older chat components are listed as debt in
 * `docs/Design.md` and join this list as they are migrated.
 */
const COVERED_DIRS = [join(ROOT, 'obsidian'), join(ROOT, 'settings')]
const COVERED_FILES = [
  'AiAgentSelector.vue',
  'AgentOverrideNotice.vue',
  'AiSubAgentRun.vue',
  'AiRunBranch.vue',
  'AiRunMessage.vue',
  'AiRunView.vue',
].map((name) => join(ROOT, name))

/** The one component allowed to be a `<button>`: everything else goes through it. */
const BUTTON_HOME = join(ROOT, 'obsidian', 'Button.vue')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return path.endsWith('.vue') ? [path] : []
  })
}

const FILES = [...COVERED_DIRS.flatMap(walk), ...COVERED_FILES].sort()

const name = (path: string) => relative(ROOT, path)

/** Comments explain the rules; they must not be judged by them. */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function styleBlock(source: string): string {
  const match = source.match(/<style[^>]*>([\s\S]*)<\/style>/)
  return match ? withoutComments(match[1]) : ''
}

function template(source: string): string {
  const match = source.match(/<template>([\s\S]*)<\/template>/)
  return match ? withoutComments(match[1]) : ''
}

/** Every `<Button …>` and `<Icon …>` in a template, with its attributes as written. */
function componentTags(source: string): { tag: string; attrs: string }[] {
  return [...template(source).matchAll(/<(Button|Icon)\b([^>]*?)\/?>/gs)].map((match) => ({
    tag: match[1],
    attrs: match[2] ?? '',
  }))
}

/** A glyph that does nothing on click is decoration — a status marker, a chevron. */
const isInteractive = (tag: { tag: string; attrs: string }) =>
  tag.tag === 'Button' || tag.attrs.includes('@click')

describe('the design standard', () => {
  it('covers the kit, the settings screens and the agent chat surfaces', () => {
    // A guard on the guard: a covered file renamed out of existence would otherwise make
    // every rule below pass by checking nothing.
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('routes every button through the kit', () => {
    const offenders = FILES.filter(
      (file) => file !== BUTTON_HOME && /<button[\s>]/.test(template(readFileSync(file, 'utf8')))
    )

    expect(offenders.map(name)).toEqual([])
  })

  it('keeps styling out of the markup', () => {
    const offenders = FILES.filter((file) => /\sstyle="/.test(template(readFileSync(file, 'utf8'))))

    expect(offenders.map(name)).toEqual([])
  })

  it('takes every colour from the theme', () => {
    const offenders = FILES.filter((file) =>
      /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/.test(styleBlock(readFileSync(file, 'utf8')))
    )

    expect(offenders.map(name)).toEqual([])
  })

  it('sizes in relative units, not pixels', () => {
    // A hairline is the exception: `1px` is what a border is, at any zoom.
    const offenders = FILES.filter((file) =>
      /(?<![\d.])(?!0px|1px)\d+(\.\d+)?px/.test(styleBlock(readFileSync(file, 'utf8')))
    )

    expect(offenders.map(name)).toEqual([])
  })

  it('says what every action does', () => {
    const offenders = FILES.filter((file) =>
      componentTags(readFileSync(file, 'utf8'))
        .filter(isInteractive)
        .some((tag) => !/(^|\s):?tooltip[=\s]/.test(tag.attrs))
    )

    expect(offenders.map(name)).toEqual([])
  })

  it('finds the actions it is meant to be checking', () => {
    // The rule above is a filter over a regex; if the regex stopped matching, it would pass
    // by checking nothing.
    const interactive = FILES.flatMap((file) =>
      componentTags(readFileSync(file, 'utf8')).filter(isInteractive)
    )

    expect(interactive.length).toBeGreaterThan(20)
  })

  it('explains any element that scrolls sideways', () => {
    const offenders = FILES.filter((file) => {
      const source = readFileSync(file, 'utf8')
      const match = /<style[^>]*>([\s\S]*)<\/style>/.exec(source)
      if (!match) return false

      const lines = match[1].split('\n')
      return lines.some((line, idx) => {
        if (!/overflow-x:\s*(auto|scroll)/.test(withoutComments(line))) return false
        const preceding = lines.slice(Math.max(0, idx - 4), idx).join('\n')
        return !/(\/\/|\/\*|\*)/.test(preceding)
      })
    })

    expect(offenders.map(name)).toEqual([])
  })
})
