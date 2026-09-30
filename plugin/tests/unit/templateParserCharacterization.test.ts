import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { load } from 'js-yaml'
import {
  applyTemplateVariables,
  parseTemplateVariables,
  type TemplateVariable,
} from '@/templates/TemplateParser'
import { useVault } from '../helpers/testEnv'

async function render(text: string, values: Record<string, string> = {}) {
  return applyTemplateVariables(
    text,
    parseTemplateVariables(text).variables,
    new Map(Object.entries(values))
  )
}

beforeEach(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-03-01T00:30:00-08:00'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('template expressions', () => {
  it('parses every field type, retaining raw spelling and excluding only dates from input', () => {
    const text =
      '{{ date }} {{date.format("YYYY")}} {{date.offset(-1)}} {{date.offset(2).format(\'DD\')}} {{sample;convert;Label}} {{ Items ::list}} {{Links::wiki_list}} {{Note::wikilink}} {{Choice::select( red, blue )}} {{Picture::image}} {{Other::unknown}}'
    const { variables, userVariables } = parseTemplateVariables(text)
    expect(variables.map(({ raw: _raw, ...v }) => v)).toEqual([
      { type: 'date', name: 'date', format: 'YYYY-MM-DD' },
      { type: 'date', name: 'date', format: 'YYYY' },
      { type: 'date', name: 'date', format: 'YYYY-MM-DD', offset: -1 },
      { type: 'date', name: 'date', format: 'DD', offset: 2 },
      { type: 'plugin', name: 'Label', pluginId: 'sample', methodName: 'convert' },
      { type: 'list', name: 'Items' },
      { type: 'wiki_list', name: 'Links' },
      { type: 'wikilink', name: 'Note' },
      { type: 'select', name: 'Choice', options: ['red', 'blue'] },
      { type: 'image', name: 'Picture' },
      { type: 'user', name: 'Other::unknown' },
    ])
    expect(userVariables).toEqual(variables.slice(4))
    expect(variables[0].raw).toBe('{{ date }}')
  })

  it('deduplicates raw expressions, not names, and starts each parse with a fresh regex', () => {
    for (let n = 0; n < 3; n++) {
      expect(
        parseTemplateVariables('{{x}} {{x}} {{ x }} {{x::list}}').variables.map((v) => v.raw)
      ).toEqual(['{{x}}', '{{ x }}', '{{x::list}}'])
    }
    expect(parseTemplateVariables('no variables {{unfinished').variables).toEqual([])
    expect(parseTemplateVariables('{{x}}'.repeat(10000)).variables).toHaveLength(1)
  })

  it('extracts scalar and list defaults with escaped commas and parentheses', () => {
    const text = String.raw`{{Text::default(a\(b\)\,c)}} {{Items::list::default(one,two\,three,,four,)}} {{Links::wiki_list::default()}} {{Choice::select(a,b)::default(b)}}`
    expect(parseTemplateVariables(text).variables.map((v) => v.defaultValue)).toEqual([
      'a(b),c',
      '["one","two,three","","four"]',
      '[]',
      'b',
    ])
  })

  it('leaves defaults for the input dialog rather than applying them in the parser', async () => {
    expect(await render('{{Text::default(sample)}} {{Choice::select(a,b)::default(b)}}')).toBe(' ')
    expect(await render('{{date}} {{date.offset(-1)}} {{date.offset(0).format("HH:mm")}}')).toBe(
      '2028-03-01 2028-02-29 00:30'
    )
  })

  it('replaces all exact occurrences literally, including replacement metacharacters', async () => {
    expect(await render('{{x}} {{ x }} {{x}}', { x: '$& $1 $$' })).toBe(
      '$& $1 $$ $& $1 $$ $& $1 $$'
    )
    expect(
      await render('{{picture::image}} {{choice::select(a,b)}}', {
        picture: '![[sample.png]]',
        choice: 'not-an-option',
      })
    ).toBe('![[sample.png]] not-an-option')
  })

  it.each(['"', "'", ''])(
    'removes %s quotes around multiline lists, preserving YAML link strings',
    async (quote) => {
      const text = `links: ${quote}{{links::wiki_list}}${quote}\nitems: ${quote}{{items::list}}${quote}`
      const result = await render(text, {
        links: '["Notes/Sample.md","sample.png"]',
        items: '["one","two"]',
      })
      expect(load(result)).toEqual({
        links: ['[[Notes/Sample|Sample]]', '[[sample.png|sample.png]]'],
        items: ['one', 'two'],
      })
      expect(result).not.toContain('{{')
    }
  )

  it('formats a single wikilink, leaves an empty one empty, and preserves malformed list input', async () => {
    expect(await render('{{note::wikilink}}', { note: 'Notes/Sample.md' })).toBe(
      '"[[Notes/Sample|Sample]]"'
    )
    expect(await render('{{note::wikilink}}')).toBe('')
    for (const value of ['[]', '{}', 'null'])
      expect(await render('{{x::list}}', { x: value })).toBe('')
    expect(await render('{{x::list}}', { x: 'not json' })).toBe('not json')
    expect(await render('x: "{{x::list}}"')).toBe('x: ""')
  })
})

describe('plugin variables', () => {
  it('binds the plugin receiver, awaits its method and stringifies non-string results', async () => {
    const app = useVault([])
    Object.assign(app, {
      plugins: {
        plugins: {
          sample: {
            prefix: 'value:',
            async convert(input: string) {
              return this.prefix + input
            },
          },
        },
      },
    })
    expect(await render('{{sample;convert;Input}}', { Input: 'seed' })).toBe('value:seed')
    Object.assign(app, { plugins: { plugins: { sample: { convert: () => 42 } } } })
    expect(await render('{{sample;convert;Input}}')).toBe('42')
  })

  it('falls back to input for missing registry, plugin, method, or a throwing method', async () => {
    const app = useVault([])
    for (const plugins of [
      undefined,
      { plugins: {} },
      { plugins: { sample: {} } },
      {
        plugins: {
          sample: {
            convert: () => {
              throw new Error('sample failure')
            },
          },
        },
      },
    ]) {
      Object.assign(app, { plugins })
      expect(await render('{{sample;convert;Input}}', { Input: 'keep' })).toBe('keep')
    }
    const invalid: TemplateVariable = { raw: '{{invalid}}', name: 'Input', type: 'plugin' }
    expect(await applyTemplateVariables(invalid.raw, [invalid], new Map([['Input', 'keep']]))).toBe(
      'keep'
    )
  })
})
