import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Criterion } from '@/entities/Criterion'
import { ReplacementAction } from '@/entities/ReplacementAction'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
const criterion = (patch: Partial<Criterion> = {}) => Object.assign(new Criterion(), patch)
const action = (patch: Partial<ReplacementAction> = {}) =>
  Object.assign(new ReplacementAction(), patch)

describe('Criterion', () => {
  it('starts as a case-sensitive path equality with a unique identity', () => {
    const c = new Criterion()
    expect(c).toMatchObject({
      type: 'path',
      operator: 'equals',
      property: '',
      value: '',
      caseInsensitive: false,
    })
    expect(c.id).not.toBe(new Criterion().id)
    expect(c.isValid()).toBe(false)
  })

  it.each([
    ['equals', 'Folder/Sample.md', true, false],
    ['contains', 'Sample', true, true],
    ['notContains', 'missing', true, true],
    ['startsWith', 'Folder/', true, true],
    ['endsWith', '.md', true, true],
    ['regex', '^Folder/.+\\.md$', true, true],
    ['exists', '', false, false],
    ['notExists', '', false, false],
  ] as const)(
    'path/content %s keep their distinct supported operators',
    (operator, value, pathResult, contentResult) => {
      const c = criterion({ operator, value })
      expect(c.checkPathCriterion('Folder/Sample.md')).toBe(pathResult)
      expect(c.checkContentCriterion('Folder/Sample.md')).toBe(contentResult)
    }
  )

  it.each(['equals', 'contains', 'notContains', 'startsWith', 'endsWith'] as const)(
    '%s folds case for paths, strings, and list membership',
    (operator) => {
      const c = criterion({ operator, value: 'SAMPLE', property: 'p' })
      const expected = operator !== 'notContains'
      expect(c.checkPathCriterion('sample')).toBe(!expected)
      expect(c.checkPropertyCriterion({ p: 'sample' })).toBe(!expected)
      c.caseInsensitive = true
      expect(c.checkPathCriterion('sample')).toBe(expected)
      expect(c.checkPropertyCriterion({ p: 'sample' })).toBe(expected)
      if (operator === 'contains' || operator === 'notContains')
        expect(c.checkPropertyCriterion({ p: ['sample', 'other'] })).toBe(expected)
    }
  )

  it('distinguishes absent, null, false, zero, scalar, and list properties', () => {
    const c = criterion({ type: 'property', property: 'p' })
    for (const value of [null, false, 0, '', []]) {
      c.operator = 'exists'
      expect(c.checkPropertyCriterion({ p: value })).toBe(true)
      c.operator = 'notExists'
      expect(c.checkPropertyCriterion({ p: value })).toBe(false)
    }
    expect(c.checkPropertyCriterion({})).toBe(true)
    expect(c.checkPropertyCriterion({ p: undefined })).toBe(true)
    c.operator = 'equals'
    expect(c.checkPropertyCriterion({ p: null })).toBe(true)
    c.value = '0'
    expect(c.checkPropertyCriterion({ p: 0 })).toBe(true)
    c.value = 'one,two'
    expect(c.checkPropertyCriterion({ p: ['one', 'two'] })).toBe(true)
    c.operator = 'contains'
    c.value = 'one'
    expect(c.checkPropertyCriterion({ p: ['someone'] })).toBe(false)
    expect(c.checkPropertyCriterion({ p: 'someone' })).toBe(true)
    c.value = '2'
    expect(c.checkPropertyCriterion({ p: [2] })).toBe(true)
    for (const operator of [
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'regex',
    ] as const) {
      c.operator = operator
      expect(c.checkPropertyCriterion({ p: 2 })).toBe(false)
      expect(c.checkPropertyCriterion({})).toBe(false)
    }
  })

  it('supports bare and slash-delimited regex flags without leaking lastIndex', () => {
    const c = criterion()
    for (const pattern of ['sample', '/sample/g', '/SAMPLE/i', '/^sample$/m']) {
      for (let n = 0; n < 3; n++) expect(c.checkRegExp('sample', pattern)).toBe(true)
    }
    expect(c.checkRegExp('other', 'sample')).toBe(false)
    expect(c.checkRegExp('sample', '[')).toBe(false)
    expect(c.checkRegExp('sample', '/sample/gg')).toBe(false)
  })

  it('pins regex API asymmetry: path/property use explicit flags, content uses caseInsensitive', () => {
    const c = criterion({
      operator: 'regex',
      property: 'p',
      value: 'SAMPLE',
      caseInsensitive: true,
    })
    expect(c.checkPathCriterion('sample')).toBe(false)
    expect(c.checkPropertyCriterion({ p: 'sample' })).toBe(false)
    expect(c.checkContentCriterion('sample')).toBe(true)
    c.value = '/sample/i'
    expect(c.checkPathCriterion('sample')).toBe(true)
    expect(c.checkPropertyCriterion({ p: 'sample' })).toBe(true)
    expect(c.checkContentCriterion('sample')).toBe(false)
    c.value = '['
    expect(c.checkContentCriterion('sample')).toBe(false)
  })

  it('requires a property name and values only for value-taking operators, without trimming', () => {
    const c = criterion({ type: 'property', operator: 'exists' })
    expect(c.isValid()).toBe(false)
    c.property = ' '
    expect(c.isValid()).toBe(true)
    for (const operator of [
      'equals',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'regex',
    ] as const) {
      c.operator = operator
      c.value = ''
      expect(c.isValid()).toBe(false)
      c.value = ' '
      expect(c.isValid()).toBe(true)
    }
    expect(criterion({ type: 'name', operator: 'notExists' }).isValid()).toBe(true)
  })
})

describe('ReplacementAction', () => {
  it('starts with a unique identity and moves only the basename into the chosen directory', () => {
    const a = action()
    expect(a.id).not.toBe(action().id)
    expect(a).toMatchObject({
      type: 'set-property',
      property: '',
      directory: '',
      value: '',
      oldValue: '',
    })
    expect(a.applyPathReplacement('Old/sample.md')).toBe('Old/sample.md')
    a.type = 'move'
    a.directory = 'New/Nested'
    expect(a.applyPathReplacement('Old/sample.md')).toBe('New/Nested/sample.md')
    a.directory = ''
    expect(a.applyPathReplacement('Old/sample.md')).toBe('sample.md')
  })

  it('sets a scalar as text, splits existing lists by semicolons, and never mutates input', () => {
    const a = action({ property: 'p', value: ' one ; two; ' })
    const source = { p: ['old'], nested: { keep: true } }
    expect(a.applyPropertyReplacement(source)).toEqual({
      p: ['one', 'two', ''],
      nested: { keep: true },
    })
    expect(source.p).toEqual(['old'])
    expect(a.applyPropertyReplacement({ p: 2 })).toEqual({ p: ' one ; two; ' })
    expect(a.applyPropertyReplacement(null)).toEqual({ p: ' one ; two; ' })
    a.type = 'remove-property'
    expect(a.applyPropertyReplacement(source)).toEqual({ nested: { keep: true } })
    expect(a.applyPropertyReplacement({})).toEqual({})
  })

  it('adds exact-case unique list items, discards a prior scalar and retains empty split items', () => {
    const a = action({ type: 'add-to-list', property: 'p', value: 'one;One;two;' })
    expect(a.applyPropertyReplacement({ p: ['one', 'one'] })).toEqual({
      p: ['one', 'One', 'two', ''],
    })
    expect(a.applyPropertyReplacement({ p: 'old' })).toEqual({ p: ['one', 'One', 'two', ''] })
  })

  it('removes all matching list items and replaces exact matches without splitting the replacement', () => {
    const a = action({ type: 'remove-from-list', property: 'p', value: 'one;two' })
    const source = { p: ['one', 'One', 'two', 'one', 2] }
    expect(a.applyPropertyReplacement(source)).toEqual({ p: ['One', 2] })
    expect(source.p).toHaveLength(5)
    expect(a.applyPropertyReplacement({ p: 'one' })).toEqual({ p: 'one' })
    a.type = 'replace-in-list'
    a.oldValue = 'one'
    a.value = 'new;value'
    expect(a.applyPropertyReplacement(source)).toEqual({
      p: ['new;value', 'One', 'two', 'new;value', 2],
    })
    expect(a.applyPropertyReplacement({ p: false })).toEqual({ p: false })
    a.type = 'move'
    const unchanged = a.applyPropertyReplacement(source)
    expect(unchanged).toEqual(source)
    expect(unchanged).not.toBe(source)
  })

  it('replaces plain text globally, supports regex groups/flags and leaves invalid regex unchanged', () => {
    const a = action({ type: 'replace-in-content', oldValue: '.', value: '!' })
    expect(a.applyContentReplacement('a.b.c')).toBe('a!b!c')
    a.oldValue = '/(sample)/i'
    a.value = '[$1]'
    expect(a.applyContentReplacement('Sample sample')).toBe('[Sample] [sample]')
    a.oldValue = '/[/'
    expect(a.applyContentReplacement('sample')).toBe('sample')
    a.oldValue = 'sample'
    a.value = ''
    expect(a.applyContentReplacement('sample sample')).toBe(' ')
    a.oldValue = ''
    expect(a.applyContentReplacement('keep')).toBe('keep')
    a.type = 'move'
    a.oldValue = 'keep'
    expect(a.applyContentReplacement('keep')).toBe('keep')
  })

  it('replaces only string values of the selected property, retaining nonstrings and other keys', () => {
    const a = action({ type: 'replace-in-property', property: 'p', oldValue: 'old', value: 'new' })
    const source = { p: ['old old', 2, null, { text: 'old' }], other: 'old' }
    expect(a.applyPropertyContentReplacement(source)).toEqual({
      p: ['new new', 2, null, { text: 'old' }],
      other: 'old',
    })
    expect(source.p[0]).toBe('old old')
    expect(a.applyPropertyContentReplacement({ p: 'old' })).toEqual({ p: 'new' })
    expect(a.applyPropertyContentReplacement({ p: '' })).toEqual({ p: '' })
    expect(a.applyPropertyContentReplacement({ p: 0 })).toEqual({ p: 0 })
    a.oldValue = ''
    expect(a.applyPropertyContentReplacement(source)).toBe(source)
  })

  it.each([
    ['move', { directory: 'New' }],
    ['remove-property', { property: 'p' }],
    ['replace-in-list', { property: 'p', oldValue: 'old', value: 'new' }],
    ['replace-in-property', { property: 'p', oldValue: 'old' }],
    ['replace-in-content', { oldValue: 'old' }],
    ['set-property', { property: 'p', value: 'new' }],
    ['add-to-list', { property: 'p', value: 'new' }],
    ['remove-from-list', { property: 'p', value: 'old' }],
  ] as const)('validates required trimmed fields for %s', (type, fields) => {
    expect(action({ type }).isValid()).toBe(false)
    expect(action({ type, ...fields }).isValid()).toBe(true)
    for (const field of Object.keys(fields)) {
      expect(action({ type, ...fields, [field]: '  ' }).isValid()).toBe(false)
    }
  })
})
