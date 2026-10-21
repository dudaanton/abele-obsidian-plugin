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
import { en } from '@/i18n/locales/en/pilot'
import { inspectDesign, inspectCss } from '../helpers/designParser'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { baseParse, NodeTypes, type TemplateChildNode } from '@vue/compiler-dom'
import postcss from 'postcss'
import { initCompiler } from 'sass-embedded'

const ROOT = join(__dirname, '..', '..', 'src', 'components')
const STYLES = join(__dirname, '..', '..', 'src', 'styles.css')

/** Obsidian's clickable-icon inset is 4px vertically and 6px horizontally.
 * Resolve its size tokens rather than treating a nonzero inset as sufficient. */
function shrinksGlyphBox(property: string, value: string): boolean {
  if (['auto', 'none', 'revert', 'revert-layer'].includes(value)) return false
  if (!property.startsWith('padding')) return true
  const lengths = value.match(/var\(--size-[24]-\d+\)|\d*\.?\d+(?:px|rem|em)?/g) ?? []
  const pixels = lengths.map((length) => {
    const token = /^var\(--size-([24])-(\d+)\)$/.exec(length)
    if (token) return Number(token[1]) * Number(token[2])
    if (/(?:rem|em)$/.test(length)) return parseFloat(length) * 16
    return parseFloat(length)
  })
  const horizontal = /(?:inline|left|right)/.test(property)
  if (property !== 'padding') return pixels.some((size) => size < (horizontal ? 6 : 4))
  const [top, right = top, bottom = top, left = right] = pixels
  return [top, right, bottom, left].some((size, index) => size < (index % 2 ? 6 : 4))
}

describe('glyph button boxes', () => {
  it.each([
    ['padding', '1px'],
    ['padding-inline', 'var(--size-2-1)'],
    ['padding', 'var(--size-2-2) var(--size-2-2)'],
    ['height', 'var(--icon-size)'],
    ['max-height', '1lh'],
    ['block-size', '1rem'],
  ])('rejects %s: %s', (property, value) => {
    expect(shrinksGlyphBox(property, value)).toBe(true)
  })

  it('preserves native padding and height on interactive glyphs', () => {
    const failures: string[] = []
    const compiler = initCompiler()
    try {
      for (const path of walk(ROOT)) {
        const source = readFileSync(path, 'utf8')
        const iconNames = new Set(['Icon'])
        const buttonNames = new Set(['Button'])
        for (const match of source.matchAll(
          /import\s+(\w+)\s+from\s+['"][^'"]*\/(Icon|Button)\.vue['"]/g
        ))
          (match[2] === 'Icon' ? iconNames : buttonNames).add(match[1])
        const root = document.createElement('body')
        const add = (node: TemplateChildNode, parent: HTMLElement) => {
          if (node.type !== NodeTypes.ELEMENT) return
          const el = document.createElement(node.tag.toLowerCase())
          for (const prop of node.props) {
            if (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'class')
              el.className = prop.value?.content ?? ''
          }
          // The kit's own root binds this class rather than writing it literally.
          // Inspect its interactive variant as well as the controls composed by callers.
          const bindsNativeClass =
            el.matches('.abele-obsidian-icon, .abele-obsidian-button') &&
            node.props.some(
              (prop) =>
                prop.type === NodeTypes.DIRECTIVE &&
                prop.name === 'bind' &&
                prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
                prop.arg.content === 'class' &&
                prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION &&
                /['"]clickable-icon['"]\s*:/.test(prop.exp.content)
            )
          if (bindsNativeClass) el.classList.add('clickable-icon')
          const clicked = node.props.some(
            (prop) =>
              prop.type === NodeTypes.DIRECTIVE &&
              prop.name === 'on' &&
              prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
              prop.arg.content === 'click'
          )
          const plain = node.props.some(
            (prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'plain'
          )
          if (iconNames.has(node.tag)) el.classList.add('abele-obsidian-icon')
          const active = node.props.some(
            (prop) =>
              prop.type === NodeTypes.DIRECTIVE &&
              prop.name === 'bind' &&
              prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
              ['active', 'interactive'].includes(prop.arg.content) &&
              !(prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION && prop.exp.content === 'false')
          )
          if (
            (iconNames.has(node.tag) && (clicked || active)) ||
            (buttonNames.has(node.tag) && plain)
          )
            el.classList.add('clickable-icon')
          if (
            iconNames.has(node.tag) ||
            (bindsNativeClass && el.matches('.abele-obsidian-icon, .abele-obsidian-button'))
          )
            el.dataset.glyph = 'true'
          if (
            buttonNames.has(node.tag) &&
            node.props.some((prop) =>
              prop.type === NodeTypes.ATTRIBUTE
                ? prop.name === 'icon'
                : prop.type === NodeTypes.DIRECTIVE &&
                  prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
                  prop.arg.content === 'icon'
            )
          )
            el.dataset.glyph = 'true'
          parent.append(el)
          // Kit slots may receive interactive metadata/actions from a caller.
          if (path.includes(`${join('components', 'obsidian')}/`) && node.tag === 'slot') {
            const glyph = document.createElement('button')
            glyph.className = 'abele-obsidian-icon clickable-icon'
            glyph.dataset.glyph = 'true'
            el.append(glyph)
          }
          node.children.forEach((child) => add(child, el))
        }
        const descriptor = parseSfc(source).descriptor
        baseParse(descriptor.template?.content ?? '').children.forEach((node) => add(node, root))
        const css = compiler.compileString(
          descriptor.styles.map((style) => style.content).join('\n'),
          {
            logger: { warn() {}, debug() {} },
          }
        ).css
        postcss.parse(css).walkRules((rule) => {
          if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return
          if (
            !rule.nodes.some(
              (node) =>
                node.type === 'decl' &&
                /^(?:padding|height$|max-height$|block-size$|max-block-size$)/.test(node.prop)
            )
          )
            return
          const glyphs = ['', 'is-phone is-mobile'].flatMap((mode) => {
            root.className = mode
            return [...root.querySelectorAll('.clickable-icon')].filter((el) =>
              rule.selectors.some((selector) => !selector.includes('::') && el.matches(selector))
            )
          })
          if (!glyphs.length) return
          rule.walkDecls(
            /^(?:padding(?:-(?:block|inline)(?:-start|-end)?|-(?:top|right|bottom|left))?|height|max-height|block-size|max-block-size)$/,
            (decl) => {
              if (
                (decl.prop.startsWith('padding') && /(?:^|\s)0(?:px)?(?:\s|$)/.test(decl.value)) ||
                (glyphs.some((el) => el.hasAttribute('data-glyph')) &&
                  shrinksGlyphBox(decl.prop, decl.value))
              )
                failures.push(`${name(path)}: ${rule.selector} { ${decl.prop}: ${decl.value} }`)
            }
          )
        })
      }
    } finally {
      compiler.dispose()
    }
    expect(failures).toEqual([])
  }, 30_000)
})

/**
 * What the standard covers today: the shared kit, every settings screen, the sync dialogs, and
 * the chat surfaces the agent work introduced. The older chat components are listed as debt in
 * `docs/Design.md` and join this list as they are migrated.
 */
const COVERED_DIRS = [
  join(ROOT, 'obsidian'),
  join(ROOT, 'settings'),
  join(ROOT, 'github'),
  join(ROOT, 'mermaid'),
  join(ROOT, 'reader'),
  join(ROOT, 'drawing'),
  join(ROOT, 'docs'),
  join(ROOT, 'changelog'),
  join(ROOT, 'quick'),
  join(ROOT, 'calendarBase'),
  join(ROOT, 'linter'),
  join(ROOT, 'sync'),
]
const COVERED_FILES = [
  'AiAgentSelector.vue',
  'AgentOverrideNotice.vue',
  'AiSubAgentRun.vue',
  'AiRunBranch.vue',
  'AiRunMessage.vue',
  'AiRunView.vue',
  'AiChatSetup.vue',
  'ChatsList.vue',
  'ScriptView.vue',
  'ScriptNode.vue',
  'ScriptHtml.vue',
  'AccountsSidebar.vue',
  'AiCommentTrail.vue',
  'NoteEditorField.vue',
  'CalendarEvent.vue',
  'AiRewindDialog.vue',
  'ChatFindBar.vue',
].map((name) => join(ROOT, name))

/** Real semantic controls live in the kit; screens cannot create their own button families. */
const BUTTON_HOMES = ['Button', 'Disclosure', 'ListRow', 'SwatchPicker', 'Image'].map((component) =>
  join(ROOT, 'obsidian', `${component}.vue`)
)

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

// Incremental strict gate: stage 0 changes primitives, not screens. The older source checks
// below retain their full scope. No covered file is removed to make this gate pass.
const STRICT_KIT = [
  'Icon',
  'ListRow',
  'MetaLine',
  'RelativeTime',
  'PathLabel',
  'Disclosure',
  'ListSectionHeader',
  'EventList',
  'SheetHeaderActions',
  'Quote',
  'SwatchPicker',
  'Image',
  'EmptyState',
  'FoldHeading',
  'Card',
  'Section',
  'Progress',
]
const STRICT_SCREENS: string[] = [] // Each migration must append its screen here.
const MIGRATION_EXEMPTIONS = {
  stage1: ['ChatArtifacts.vue'], // Inventory/history hierarchy needs owner-selected composition.
  stage2: ['TextCommentDialog.vue'], // Content sizing, drafts and annotation controls.
  stage3: [
    'AiChatHistory.vue',
    'AiChatMessage.vue',
    'ChatAnchorHistory.vue',
    'AiReplyRevisionDialog.vue',
  ], // Nested navigation and history, not all flat rows.
  stage4: ['settings/ai/AgentsSettings.vue'], // Rich-choice cards need comparison before replacing.
  stage5: ['NodePath.vue', 'NodeFilesDialog.vue'], // Recovery and permission context.
  stage6: walk(ROOT)
    .map(name)
    .filter((file) => !file.startsWith('obsidian/')), // Remaining legacy screens, settings, trees, tables and specialized editors. Legacy gate still applies where covered.
}
// Global stylesheet and imperative builders predate stage 0; they retain their geometry,
// diagnostic/editor data and native ShellModal keyboard rules. New policy declarations are
// parsed now; newly migrated CSS/builders must be added, rather than exempted wholesale.
const STRICT_GLOBAL_CSS = [join(ROOT, 'obsidian', 'designKit.css')]
const LEGACY_BUILDERS = ['src/modal/ShellModal.ts', 'src/modal/shellStyles.ts', 'src/styles.css']

describe('parsed incremental design standard', () => {
  it('documents the remaining migrations without pretending they are strict yet', () => {
    expect(Object.keys(MIGRATION_EXEMPTIONS)).toHaveLength(6)
    expect(LEGACY_BUILDERS).toContain('src/modal/ShellModal.ts')
  })
  it('applies host-token, date, disclosure and accessible-action rules to the new kit', () => {
    const failures = STRICT_KIT.flatMap((component) => {
      const path = join(ROOT, 'obsidian', `${component}.vue`)
      return inspectDesign(readFileSync(path, 'utf8')).map((error) => `${name(path)}: ${error}`)
    })
    expect(failures).toEqual([])
  })
  it('parses the centralized touch policy without exempting invented tokens or colours', () => {
    expect(
      STRICT_GLOBAL_CSS.flatMap((path) =>
        inspectCss(readFileSync(path, 'utf8'), { touchPolicy: true })
      )
    ).toEqual([])
  })
  it('enforces compositions as screens join the strict inventory', () => {
    expect(
      STRICT_SCREENS.flatMap((file) =>
        inspectDesign(readFileSync(join(ROOT, file), 'utf8'), { screen: true })
      )
    ).toEqual([])
  })
})

// Forms join this gate independently of the flat-list migration. Native controls belong in
// the kit, including a hidden platform picker; aliases do not disguise raw HTML tags.
const KIT_FORM_SCREENS = [
  'AiChatSettings.vue',
  'AiScopeEditor.vue',
  'AiChatHistory.vue',
  'DateTimePicker.vue',
  'DateRangePickerModal.vue',
  'RecurrencePicker.vue',
]
function rawFormControls(source: string): string[] {
  const content = parseSfc(source).descriptor.template?.content ?? ''
  const tags: string[] = []
  const visit = (node: TemplateChildNode) => {
    if (node.type !== NodeTypes.ELEMENT) return
    if (['input', 'select', 'textarea'].includes(node.tag)) tags.push(node.tag)
    node.children.forEach(visit)
  }
  baseParse(content).children.forEach(visit)
  return tags
}

const EMPTY_STATE_SCREENS = [
  'Gallery.vue',
  'TimeEntryListView.vue',
  'TimeTrackingSidebar.vue',
  'TemplateSelectModal.vue',
  'FinanceSidebar.vue',
  'TransactionsList.vue',
  'github/GithubComment.vue',
  'AiChatHistory.vue',
  'AiSkillPromptPicker.vue',
  'settings/LinksSettings.vue',
]
const CAPTION_SCREENS = [
  'AiChatSettings.vue',
  'FinanceSidebar.vue',
  'TimeTrackingSidebar.vue',
  'ScriptRuns.vue',
  'MigrateFromFireflyModal.vue',
  'MigrateFromTogglModal.vue',
]
function localSmallUi(source: string): string[] {
  const content = parseSfc(source).descriptor.template?.content ?? ''
  const errors: string[] = []
  const visit = (node: TemplateChildNode) => {
    if (node.type !== NodeTypes.ELEMENT) return
    if (
      ['div', 'span', 'p'].includes(node.tag) &&
      node.props.some(
        (p) =>
          p.type === NodeTypes.ATTRIBUTE &&
          p.name === 'class' &&
          /__(?:empty|chart-empty|pie-empty|bar(?:-container)?)\b/.test(p.value?.content ?? '')
      )
    )
      errors.push('local empty or progress UI')
    if (['h3', 'h4', 'progress'].includes(node.tag)) errors.push(`raw ${node.tag}`)
    node.children.forEach(visit)
  }
  baseParse(content).children.forEach(visit)
  return errors
}
describe('migrated small UI', () => {
  it('does not clip the reset action inside a native description row', () => {
    expect(styleBlock(readFileSync(join(ROOT, 'AgentOverrideNotice.vue'), 'utf8'))).toMatch(
      /\.abele-override-notice\s*\{[^}]*overflow:\s*visible/
    )
  })
  it('makes the period caption a named kit action rather than a clickable div', () => {
    const source = readFileSync(join(ROOT, 'obsidian/PeriodSelector.vue'), 'utf8')
    expect(template(source)).not.toMatch(/<div[^>]*__title[^>]*@click/)
    expect(source).toContain("import ObsidianIcon from './Icon.vue'")
    const captions: string[] = []
    const visit = (node: TemplateChildNode) => {
      if (node.type !== NodeTypes.ELEMENT) return
      if (
        node.tag === 'ObsidianIcon' &&
        node.props.some(
          (prop) =>
            prop.type === NodeTypes.ATTRIBUTE &&
            prop.name === 'class' &&
            prop.value?.content === 'abele-period-selector__title'
        )
      )
        captions.push(node.loc.source)
      node.children.forEach(visit)
    }
    baseParse(template(source)).children.forEach(visit)
    expect(captions).toHaveLength(1)
    expect(captions[0]).toContain(':tooltip="t(\'kit.dateRange\')"')
    expect(captions[0]).toContain('@click="pickerOpen = true"')
    expect(en['kit.dateRange']).toBe('Choose date range')
  })
  it('detects nested handmade states, bars and captions without rejecting kit aliases', () => {
    expect(
      localSmallUi(
        '<template><div><p class="abele-sample__empty">None</p><div class="abele-sample__bar"/><h3>Items</h3><progress /></div><KitEmptyState/><KitSection/><KitProgress/></template>'
      )
    ).toEqual([
      'local empty or progress UI',
      'local empty or progress UI',
      'raw h3',
      'raw progress',
    ])
  })
  it('keeps empty states, progress and section captions in the kit', () => {
    expect(
      [...new Set([...EMPTY_STATE_SCREENS, ...CAPTION_SCREENS])].flatMap((file) =>
        localSmallUi(readFileSync(join(ROOT, file), 'utf8')).map((error) => `${file}: ${error}`)
      )
    ).toEqual([])
  })
})

describe('migrated theme colours', () => {
  it('does not keep a private highlight palette or dark-mode shades', () => {
    const css = readFileSync(STYLES, 'utf8')
    const declarations = [...css.matchAll(/--abele-highlight-[a-z]+:\s*([^;]+);/g)].map(
      (match) => match[1]
    )
    expect(declarations).toHaveLength(9)
    expect(
      declarations.every((value) => /var\(--(?:color-[a-z]+-rgb|text-muted)\)/.test(value))
    ).toBe(true)
  })
  it('keeps chart defaults and gallery-viewer chrome free of literal colours', () => {
    const chart = readFileSync(join(ROOT, '../bases/echarts.ts'), 'utf8')
    const finance = readFileSync(join(ROOT, '../composables/useFinanceCharts.ts'), 'utf8')
    const gallery = styleBlock(readFileSync(join(ROOT, 'GalleryViewer.vue'), 'utf8'))
    expect(
      [chart, finance, gallery].some((source) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/.test(source))
    ).toBe(false)
  })
})

describe('migrated dialog sizing', () => {
  it('does not add another descendant shell-size override beyond the recorded AI editor debt', () => {
    expect(
      walk(ROOT)
        .filter(
          (file) =>
            !file.includes('/obsidian/') &&
            /\.modal[^{}]*\{[^{}]*\b(?:width|max-width|min-width)\s*:/.test(
              styleBlock(readFileSync(file, 'utf8'))
            )
        )
        .map(name)
    ).toEqual(['settings/ModelEditModal.vue'])
  })
  it('keeps audited picker and import shells on shared sizes', () => {
    const files = [
      'DateTimePickerModal.vue',
      'DateRangePickerModal.vue',
      'RecurrencePickerModal.vue',
      'FindAndReplaceModal.vue',
      'MigrateFromFireflyModal.vue',
      'MigrateFromTogglModal.vue',
      'MigrateFromDataviewModal.vue',
    ]
    expect(
      files.filter((file) =>
        /\.modal[^{}]*\{[^{}]*\b(?:width|max-width|min-width)\s*:/.test(
          styleBlock(readFileSync(join(ROOT, file), 'utf8'))
        )
      )
    ).toEqual([])
  })
  it.fails('BUG: the unmigrated model editor still sizes its shell from a descendant', () => {
    const offenders = walk(ROOT).filter(
      (file) =>
        !file.includes('/obsidian/') &&
        /\.modal[^{}]*\{[^{}]*\b(?:width|max-width|min-width)\s*:/.test(
          styleBlock(readFileSync(file, 'utf8'))
        )
    )
    expect(offenders.map(name)).toEqual([])
  })
})

describe('migrated form controls', () => {
  it('finds nested raw fields while allowing imported kit aliases', () => {
    expect(
      rawFormControls('<template><div><input /><select /><textarea /></div><KitInput /></template>')
    ).toEqual(['input', 'select', 'textarea'])
  })
  it('keeps chat settings and filters on shared form controls', () => {
    expect(
      KIT_FORM_SCREENS.flatMap((file) =>
        rawFormControls(readFileSync(join(ROOT, file), 'utf8')).map((tag) => `${file}: ${tag}`)
      )
    ).toEqual([])
  })
})

describe('the design standard', () => {
  it('covers the kit, the settings screens and the agent chat surfaces', () => {
    // A guard on the guard: a covered file renamed out of existence would otherwise make
    // every rule below pass by checking nothing.
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('routes every button through the kit', () => {
    const offenders = FILES.filter(
      (file) =>
        !BUTTON_HOMES.includes(file) && /<button[\s>]/.test(template(readFileSync(file, 'utf8')))
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
   * The composer a thumb meets, at 16 px.
   *
   * Below that, focusing a field is answered by iOS zooming the whole page into it — the note
   * jumped and had to be pinched back every time somebody typed a question, which is what the
   * first phone report was about. There is one composer now — a comment is read in the sidebar
   * like any other chat — and the size is invisible to any component test, since happy-dom
   * computes no layout, so the rule is guarded by name.
   */
  it('sizes the composer a thumb meets so iOS does not zoom into it', () => {
    expect(readFileSync(join(ROOT, 'AiChatInput.vue'), 'utf8')).toMatch(
      /<style\b[^>]*src=["']\.\/chat\/input\.scss["']/
    )
    const chat = readFileSync(join(ROOT, 'chat', 'input.scss'), 'utf8')
    const sidebar =
      /body\.is-mobile \.abele-chat-input__textarea\s*\{([^}]*)\}/.exec(chat)?.[1] ?? ''

    expect(sidebar).toMatch(/font-size:\s*var\(--font-ui-medium\)/)
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
   * The three sync dialogs, whose scrolling no component test can see.
   *
   * `.abele-modal_tall` is a flex column with `overflow: hidden` — Obsidian's own sheet on a
   * phone — so a body that grows instead of scrolling pushes its last rows past the bottom of
   * the dialog, where nothing can reach them. That was fifty version cards and an expanded
   * diff with no way down. The fix is structural and lives entirely in CSS, so it is guarded
   * by name: a root that is a column, and one region inside it that takes the scrolling.
   */
  it('gives every tall sync dialog a list that scrolls inside it', () => {
    const dialogs = [
      ['sync/VersionHistoryModal.vue', '.abele-version-history', '.abele-version-history__list'],
      ['sync/DeletedFilesModal.vue', '.abele-deleted-files', '.abele-deleted-files__list'],
    ]

    for (const [file, rootClass, listClass] of dialogs) {
      const css = styleBlock(readFileSync(join(ROOT, file), 'utf8'))
      const ruleFor = (selector: string): string =>
        new RegExp(`(?:^|[,}])\\s*\\${selector}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''

      const root = ruleFor(rootClass)
      expect(root, `${file} ${rootClass}`).toMatch(/flex-direction:\s*column/)
      expect(root, `${file} ${rootClass}`).toMatch(/min-height:\s*0/)

      const list = ruleFor(listClass)
      expect(list, `${file} ${listClass}`).toMatch(/flex:\s*1 1 auto/)
      expect(list, `${file} ${listClass}`).toMatch(/min-height:\s*0/)
      expect(list, `${file} ${listClass}`).toMatch(/overflow-y:\s*auto/)
    }
    // Token sharing/review use the shared scrolling body and an independent pinned footer.
    const tokens = readFileSync(join(ROOT, 'sync/TokenDialogs.vue'), 'utf8')
    const shell = readFileSync(join(ROOT, '..', 'modal/ShellModal.ts'), 'utf8')
    const shellCss = readFileSync(join(ROOT, '..', 'modal/shell.css'), 'utf8')
    expect(tokens).toContain("mode === 'share' || mode === 'review' ? 'tall'")
    expect(tokens).toContain('<template #footer>')
    expect(shell).toContain('this.contentEl.appendChild(this.bodyEl)')
    expect(shell).toContain('this.contentEl.appendChild(this.footerEl)')
    expect(shellCss).toMatch(/\.modal\.abele-modal \.abele-modal__body\s*\{[^}]*min-height:\s*0/)
    expect(shellCss).toMatch(/\.modal\.abele-modal \.abele-modal__body\s*\{[^}]*flex:\s*1 1 auto/)
    expect(shellCss).toMatch(/\.modal\.abele-modal \.abele-modal__body\s*\{[^}]*overflow-y:\s*auto/)
    expect(shellCss).toMatch(/\.abele-modal__footer\s*\{[^}]*flex:\s*0 0 auto/)
  })

  it('keeps the retained held-delete action row visible with safe-area space', () => {
    const modal = styleBlock(readFileSync(join(ROOT, 'obsidian/Modal.vue'), 'utf8'))
    const held = readFileSync(join(ROOT, 'sync/HeldDeletesBlock.vue'), 'utf8')
    expect(modal).toMatch(/\.abele-modal__body \.abele-modal__actions\s*\{[^}]*position:\s*sticky;/)
    expect(modal).toMatch(
      /body\.is-phone \.modal\.mod-lg \.abele-modal__body \.abele-modal__actions\s*\{[^}]*safe-area-inset-bottom/
    )
    expect(held).toContain('abele-held-deletes__actions abele-modal__actions')
  })
  it('scrolls held paths inside a tall dialog, not behind its answer row', () => {
    const dialog = readFileSync(join(ROOT, 'sync/HeldDeletesModal.vue'), 'utf8')
    const css = styleBlock(readFileSync(join(ROOT, 'sync/HeldDeletesBlock.vue'), 'utf8'))
    expect(dialog).toContain('size="tall"')
    expect(css).toMatch(
      /\.abele-modal_tall \.abele-held-deletes__paths\s*\{[^}]*overflow-y:\s*auto;/
    )
  })

  it('keeps the restore-since dropdown inside its narrow dialog row', () => {
    const css = styleBlock(readFileSync(join(ROOT, 'sync/RestoreSince.vue'), 'utf8'))
    expect(css).toMatch(
      /\.abele-restore-since \.abele-obsidian-dropdown\s*\{[^}]*box-sizing:\s*border-box;/
    )
    expect(css).toMatch(
      /\.abele-restore-since \.abele-obsidian-dropdown\s*\{[^}]*margin-inline:\s*0;/
    )
  })

  it('reads older versions as the history scrolls to its end, with no paging button to press', () => {
    // The button and the room for its focus ring went with it: the end of the list asks itself.
    const source = readFileSync(join(ROOT, 'sync/VersionHistoryModal.vue'), 'utf8')
    expect(source).not.toContain('text="Load older"')
    expect(source).toMatch(/<ScrollMore[^>]*v-if="hasOlder"/)
  })

  it('lists what a transfer brings as rows whose names keep the width and whose state is a code', () => {
    const source = readFileSync(join(ROOT, 'settings/transfer/TransferScanModal.vue'), 'utf8')
    // The shared row moves its codes under the name when narrow, so a name never shrinks to
    // fragments beside them; new and replacing are codes with their words in the tooltip.
    expect(source).toMatch(/<EntryRow[^>]*class="abele-transfer-scan__entry"/)
    const replaces = 'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324'
    const missing = 'settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a'
    expect(source).toContain(`'${replaces}'`)
    expect(source).toContain(`'${missing}'`)
    expect(en[replaces]).toBe('Replaces the one already on this device')
    expect(en[missing]).toBe('Not on this device yet')
  })

  it('wraps shared phone modal titles inside space reserved for native close controls', () => {
    const source = readFileSync(join(ROOT, 'obsidian/Modal.vue'), 'utf8')
    const css = styleBlock(source)
    expect(source).toContain("modal.value.modalEl.addClass('abele-modal')")
    expect(css).toMatch(
      /body\.is-phone \.modal\.abele-modal \.modal-title\s*\{[^}]*white-space:\s*normal;/
    )
    expect(css).toMatch(
      /body\.is-phone \.modal\.abele-modal \.modal-title\s*\{[^}]*max-width:\s*calc\([^;]*--touch-size-m/
    )
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
