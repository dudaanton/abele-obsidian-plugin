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
const STYLES = join(__dirname, '..', '..', 'src', 'styles.css')

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
  'CommentCard.vue',
  'CommentInput.vue',
  'CommentPin.vue',
  'CommentThread.vue',
  'ChatsList.vue',
  'ScriptView.vue',
  'ScriptNode.vue',
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

/**
 * Drops the conditions of `@container` and `@media` queries.
 *
 * A breakpoint is not a size: it is the width at which a rule starts applying, and the only
 * honest unit for one is the pixel the layout is actually measured in. What the rule then
 * *sets* is still held to the theme's steps, which is why only the parenthesis goes.
 */
function withoutBreakpoints(css: string): string {
  return css.replace(/@(?:container|media)[^{]*/g, '@query ')
}

function styleBlock(source: string): string {
  const match = source.match(/<style[^>]*>([\s\S]*)<\/style>/)
  return match ? withoutComments(match[1]) : ''
}

function template(source: string): string {
  const match = source.match(/<template>([\s\S]*)<\/template>/)
  return match ? withoutComments(match[1]) : ''
}

/**
 * Every `<Button …>` and `<Icon …>` in a template, with its attributes as written.
 *
 * Quoted values are consumed whole rather than scanned character by character: an attribute
 * is allowed to contain `>` — `v-if="items.length > 1"` — and stopping at the first one cuts
 * the tag short, which used to report a button as missing the tooltip written further along.
 */
function componentTags(source: string): { tag: string; attrs: string }[] {
  const tags = /<(Button|Icon)\b((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/gs
  return [...template(source).matchAll(tags)].map((match) => ({
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
      /(?<![\d.])(?!0px|1px)\d+(\.\d+)?px/.test(
        withoutBreakpoints(styleBlock(readFileSync(file, 'utf8')))
      )
    )

    expect(offenders.map(name)).toEqual([])
  })

  it('does not read a breakpoint as a size', () => {
    const source = '@container (max-width: 420px) {\n  .a { width: 420px; }\n}'

    expect(withoutBreakpoints(source)).not.toContain('(max-width: 420px)')
    // Only the condition goes: what is inside the query is still markup being sized.
    expect(withoutBreakpoints(source)).toContain('width: 420px')
  })

  it('says what every action does', () => {
    const offenders = FILES.filter((file) =>
      componentTags(readFileSync(file, 'utf8'))
        .filter(isInteractive)
        .some((tag) => !/(^|\s):?tooltip[=\s]/.test(tag.attrs))
    )

    expect(offenders.map(name)).toEqual([])
  })

  it('reads a whole tag even when an attribute holds a comparison', () => {
    // The guard on the guard's parser: this tag has its tooltip after a `>` in a directive.
    const source = `<template><Button v-if="items.length > 1" text="Go" tooltip="Go there" /></template>`

    expect(componentTags(source)[0].attrs).toContain('tooltip="Go there"')
  })

  it('finds the actions it is meant to be checking', () => {
    // The rule above is a filter over a regex; if the regex stopped matching, it would pass
    // by checking nothing.
    const interactive = FILES.flatMap((file) =>
      componentTags(readFileSync(file, 'utf8')).filter(isInteractive)
    )

    expect(interactive.length).toBeGreaterThan(20)
  })

  /**
   * Not a rule about our own markup, but the one place where losing a line of CSS is invisible
   * to every other test here: Obsidian sizes a dropdown through
   * `.setting-item-control select.dropdown`, which outweighs a class selector of ours, and its
   * fitted width was too narrow to show "Off" beside the chevron. Nothing in a component test
   * sees another application's stylesheet, so the override is guarded by name.
   */
  it('keeps the override that stops Obsidian shrinking a dropdown to a letter', () => {
    const setting = readFileSync(join(ROOT, 'obsidian', 'Setting.vue'), 'utf8')

    expect(styleBlock(setting)).toMatch(/select\.dropdown\s*\{[^}]*width:\s*100%/)
  })

  /**
   * Every composer a thumb meets, at 16 px.
   *
   * Below that, focusing a field is answered by iOS zooming the whole page into it — the note
   * jumped and had to be pinched back every time somebody typed a question, which is what the
   * first phone report was about. The sidebar's composer is the one a phone types a comment
   * into now; the margin's is what a tablet still shows, and is still `body.is-mobile`.
   * Neither the size nor the reason is visible to any component test — happy-dom computes no
   * layout — so both rules are guarded by name.
   */
  it('sizes every composer a thumb meets so iOS does not zoom into it', () => {
    const chat = styleBlock(readFileSync(join(ROOT, 'AiChatInput.vue'), 'utf8'))
    const sidebar =
      /body\.is-mobile \.abele-chat-input__textarea\s*\{([^}]*)\}/.exec(chat)?.[1] ?? ''
    expect(sidebar).toMatch(/font-size:\s*var\(--font-ui-medium\)/)

    const input = styleBlock(readFileSync(join(ROOT, 'CommentInput.vue'), 'utf8'))
    const field =
      /body\.is-mobile \.abele-comment-input__field\s*\{([^}]*)\}/.exec(input)?.[1] ?? ''
    expect(field).toMatch(/font-size:\s*var\(--font-ui-medium\)/)
    expect(field).toMatch(/min-height:\s*var\(--input-height\)/)

    const send = /body\.is-mobile \.abele-comment-input__send\s*\{([^}]*)\}/.exec(input)?.[1] ?? ''
    // --size-4-9 is 36 px, the smallest square a thumb hits reliably.
    expect(send).toMatch(/min-width:\s*var\(--size-4-9\)/)
    expect(send).toMatch(/min-height:\s*var\(--size-4-9\)/)
  })

  /**
   * The chat header at the width a phone gives it.
   *
   * Six things share one row: the agent, the model it resolves to, and four actions — and a
   * comment adds two more. At 414 px the agent's name was clipped to "Co…" and the model to
   * "Claude O…", which is two truncations where one of them is the only thing that says which
   * agent is answering. The model is the one that goes: it is a fact about the agent, and the
   * chat settings say it in full. A container query, because the pane is what is narrow, not
   * the window — a phone and a narrow desktop split are the same problem.
   */
  it('drops the model label where the pane is too narrow for both', () => {
    const selector = styleBlock(readFileSync(join(ROOT, 'AiAgentSelector.vue'), 'utf8'))

    const query = /@container\s*\(max-width:\s*420px\)\s*\{([\s\S]*?)\n\}/.exec(selector)?.[1] ?? ''
    expect(query).toContain('.abele-agent-selector__model')
    expect(query).toMatch(/display:\s*none/)
  })

  /**
   * The header's agent picker, which is a native `select` wearing a badge's clothes.
   *
   * Obsidian draws the chevron as a background image 12 px in from the right edge and reserves
   * the room for it with `padding-right: 32px`. A compact padding shorthand takes that room
   * away and the chevron lands on the last letter of the agent's name — which is what the
   * first phone screenshot showed. The room is padding, not decoration, so it is guarded.
   */
  it('leaves the agent picker room for the chevron Obsidian draws in it', () => {
    const card = styleBlock(readFileSync(join(ROOT, 'CommentCard.vue'), 'utf8'))

    const picker =
      /\.abele-comment-card__agent \.abele-obsidian-dropdown \.dropdown\s*\{([^}]*)\}/.exec(
        card
      )?.[1] ?? ''
    // --size-4-6 is 24px: 12px to the chevron plus the glyph itself.
    expect(picker).toMatch(/padding:[^;]*var\(--size-4-6\)/)
  })

  /**
   * The button Obsidian appends to every code block, and the fourth of its rules that no test
   * of ours can see.
   *
   * `MarkdownRenderer` puts a `button.copy-code-button` inside each `pre`, and Obsidian's own
   * stylesheet only positions it under `.markdown-rendered` — a class the kit's `Markdown`
   * adds only for a whole document, which a card in the margin is not. Unstyled the button
   * keeps Obsidian's default `button` chrome and lands under the code as a grey slab, and
   * `.is-mobile` shows it always rather than on hover, which is how a phone reported it.
   */
  it('tames the copy button Obsidian appends to a code block in a comment', () => {
    const thread = styleBlock(readFileSync(join(ROOT, 'CommentThread.vue'), 'utf8'))

    // Absolute against the block, which is what `position: relative` on the `pre` is for.
    const pre = /\.abele-comment-thread__body pre\s*\{([^}]*)\}/.exec(thread)?.[1] ?? ''
    expect(pre).toMatch(/position:\s*relative/)
    // Room at the end of the first line, so the code does not run under the button.
    expect(pre).toMatch(/padding-inline-end:\s*var\(--size-4-12\)/)

    const button =
      /\.abele-comment-thread__body \.copy-code-button\s*\{([^}]*)\}/.exec(thread)?.[1] ?? ''
    expect(button).toMatch(/position:\s*absolute/)
    expect(button).toMatch(/top:\s*var\(--size-4-1\)/)
    expect(button).toMatch(/inset-inline-end:\s*var\(--size-4-1\)/)
    expect(button).toMatch(/color:\s*var\(--text-muted\)/)
    // Obsidian's default button is a raised slab; in a sidenote it has to be a glyph.
    expect(button).toMatch(/box-shadow:\s*none/)
    expect(button).toMatch(/font-size:\s*var\(--font-ui-smaller\)/)
    expect(button).toMatch(/--icon-size:\s*var\(--icon-xs\)/)
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

/**
 * Three facts that live in `src/styles.css` and nowhere else.
 *
 * A marker is a CodeMirror widget, so its appearance is not in any component's `<style>` block
 * and no test above can see it. Each rule here was a decision: a finger needs a target of its
 * own on a phone, the glyph has to sit in the middle of that target rather than in a corner of
 * it, and the underline is the only thing on screen that says which words a comment is about.
 */
describe('the comment marker, which lives in the stylesheet', () => {
  const css = readFileSync(STYLES, 'utf8')

  /**
   * The body of the first rule with this exact selector.
   *
   * Anchored, because a selector is also the tail of every selector that qualifies it:
   * unanchored, `.abele-comment-marker` matches `body.is-mobile .abele-comment-marker` and an
   * assertion about the desktop rule would quietly be reading the phone's.
   */
  const ruleIn = (source: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)?.[1] ?? ''
  }
  const rule = (selector: string): string => ruleIn(css, selector)

  /**
   * Every rule this selector appears in, joined — including the ones where it shares its
   * declarations with another selector. A state drawn by two rules, one of them a group, is
   * still one thing to assert about, and the anchored reader above cannot see the group at
   * all: there the selector is followed by a comma rather than by a brace.
   */
  const rules = (selector: string): string =>
    [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) =>
        match[1]
          .split(',')
          .map((one) => one.trim())
          .includes(selector)
      )
      .map((match) => match[2])
      .join('\n')

  it('reads the rule it was asked for, not one whose selector ends with it', () => {
    const sample = 'body.is-mobile .abele-x {\n  min-width: 1px;\n}\n.abele-x {\n  color: red;\n}\n'

    expect(ruleIn(sample, '.abele-x')).toContain('color: red')
    expect(ruleIn(sample, '.abele-x')).not.toContain('min-width')
  })

  it('gives a finger something to hit', () => {
    const mobile = rule('body.is-mobile .abele-comment-marker')

    // --size-4-6 is Obsidian's 24px step, which is its own minimum for a touch target.
    expect(mobile).toMatch(/min-width:\s*var\(--size-4-6\)/)
    expect(mobile).toMatch(/min-height:\s*var\(--size-4-6\)/)
    expect(mobile).toMatch(/justify-content:\s*center/)
  })

  /**
   * The digit that says how much has been said at a marker — reported missing three times.
   * Twice it was the size: a `--font-smallest` grey speck beside a coloured glyph is a thing
   * nobody reads at any distance. The third time it was what was being counted at all.
   */
  it('draws the count at a size anybody can read', () => {
    const count = rule('.abele-comment-marker__count')

    expect(count).toMatch(/font-size:\s*var\(--font-ui-smaller\)/)
    // The marker's colour, not a muted grey: on a failed comment the digit turns red with it.
    expect(count).toMatch(/color:\s*inherit/)
    // And no phone-only rule saying it again: one size, read at any distance.
    expect(rule('body.is-mobile .abele-comment-marker__count')).toBe('')
  })

  it('centres the glyph inside it, on the line it interrupts', () => {
    expect(rule('.abele-comment-marker')).toMatch(/align-items:\s*center/)
  })

  /**
   * The two states an agent puts a marker in, as a phone sees them.
   *
   * Both were drawn for a mouse pointer a foot from the screen: "busy" faded and shrank the
   * glyph itself, and the "waiting on you" dot was `--size-2-1` — two pixels, which the phone
   * reported as invisible. Then the glyph pulsing was reported too, as the whole icon
   * blinking. So both are dots now, the size of the one the chat tabs use, hung off the corner
   * rather than drawn inside the glyph, and both grow with the 24 px target on a phone.
   */
  it('says an agent is working with a dot, not by moving the glyph', () => {
    const dot = rules('.abele-comment-marker_busy::after')

    expect(dot).toMatch(/position:\s*absolute/)
    expect(dot).toMatch(/background-color:\s*var\(--interactive-accent\)/)
    expect(dot).toMatch(/animation:\s*abele-comment-marker-pulse/)
    // Nothing is done to the drawing itself, which is what read as blinking.
    expect(rule('.abele-comment-marker_busy .abele-comment-marker__icon')).toBe('')
  })

  it('hangs both dots off the glyph rather than inside it', () => {
    const busy = rules('.abele-comment-marker_busy::after')
    const pending = rules('.abele-comment-marker_pending::after')

    // Absolute against the marker, which is what `position: relative` there is for.
    expect(rule('.abele-comment-marker')).toMatch(/position:\s*relative/)
    for (const dot of [busy, pending]) {
      expect(dot).toMatch(/position:\s*absolute/)
      expect(dot).toMatch(/width:\s*var\(--size-2-3\)/)
      expect(dot).toMatch(/height:\s*var\(--size-2-3\)/)
    }
    // Waiting on the reader is the theme's warning colour, and it is held still: nothing is
    // happening until somebody answers it.
    expect(pending).toMatch(/background-color:\s*var\(--text-warning\)/)
    expect(pending).not.toMatch(/animation:/)

    // A phone's target is half again as big, and so are the dots on it.
    for (const state of ['busy', 'pending']) {
      const mobile = rules(`body.is-mobile .abele-comment-marker_${state}::after`)
      expect(mobile).toMatch(/width:\s*var\(--size-4-2\)/)
      expect(mobile).toMatch(/height:\s*var\(--size-4-2\)/)
    }
  })

  it('says a comment failed in the theme own error colour', () => {
    expect(rule('.abele-comment-marker_error')).toMatch(/color:\s*var\(--text-error\)/)
  })

  it('keeps the underline that says which words the comment is about', () => {
    expect(rule('.abele-comment__quote')).toMatch(/border-bottom:\s*1px solid var\(--text-accent\)/)
  })

  /**
   * `--text-highlight-bg` is the yellow a person's own `==highlight==` is painted in, so an
   * open comment tinted with it reads as text somebody marked up rather than as the passage
   * the card beside it is about.
   */
  it('does not tint the open passage in the colour of a manual highlight', () => {
    const open = rule('.abele-comment__quote_open')

    expect(open).toMatch(/background-color:/)
    expect(open).not.toContain('--text-highlight-bg')
  })
})
