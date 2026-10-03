import { afterEach, expect, it, vi } from 'vitest'
import { parseTemplateVariables, applyTemplateVariables } from '@/templates/TemplateParser'
import { renderDataTemplate } from '@/templates/dataTemplate'

afterEach(() => vi.useRealTimers())

it('auto-resolves both date syntaxes in user templates, preserving offsets and input fields', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2028, 2, 1, 12))
  const text =
    '{{date:YYYY/MM}} {{date.format("YYYY/MM")}} {{date.offset(-1).format("DD")}} {{Name}}'
  const parsed = parseTemplateVariables(text)
  expect(parsed.userVariables.map((variable) => variable.name)).toEqual(['Name'])
  expect(await applyTemplateVariables(text, parsed.variables, new Map([['Name', '$&']]))).toBe(
    '2028/03 2028/03 29 $&'
  )
})

it('keeps the data-template policy separate: supplied date, missing fields empty, no plugin execution', () => {
  expect(
    renderDataTemplate('{{date:YYYY}} {{title}} {{unknown}} {{plugin;method;label}}', {
      date: '2028-03-01',
      title: '$&',
    })
  ).toBe('2028 $&  ')
})
