import { expect, it } from 'vitest'
import { detectFormat, formatValue, sizeOf, wholeValue } from '@/components/debugger/valueFormat'

it('detects and lays out JSON while leaving invalid input and raw text alone', () => {
  expect(detectFormat('{"sample":1}')).toBe('json')
  expect(formatValue('{"sample":1}', 'json')).toBe('{\n  "sample": 1\n}')
  expect(detectFormat('{broken}')).toBe('text')
  expect(formatValue('{broken}', 'json')).toBe('{broken}')
  expect(formatValue('  sample\nvalue  ', 'text')).toBe('  sample\nvalue  ')
})

it('lays out nested XML and self-closing tags without lookbehind syntax', () => {
  const xml = '<sample><entry>value</entry><empty/></sample>'
  expect(detectFormat(xml)).toBe('xml')
  expect(formatValue(xml, 'xml')).toBe('<sample>\n  <entry>value</entry>\n  <empty/>\n</sample>')
})

it('counts UTF-8 bytes and retains complete observed text without requesting more', () => {
  expect(sizeOf('é\nx')).toBe('4 B · 2 lines')
  expect(sizeOf('x'.repeat(1024))).toBe('1.0 KB')
  expect(wholeValue('sample')).toBeUndefined()
  expect(wholeValue('sample', '')).toBe('')
  const value = JSON.stringify({ sample: 'x'.repeat(100) })
  expect(wholeValue(value)).toBe(value)
})

it('preserves significant whitespace in XML text', () => {
  expect(formatValue('<sample> value </sample>', 'xml')).toBe('<sample> value </sample>')
})
