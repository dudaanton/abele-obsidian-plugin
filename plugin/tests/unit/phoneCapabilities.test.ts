import { expect, it, vi } from 'vitest'
import { phoneCapabilities } from '../e2e/helpers/phoneCapabilities'

it('records exposed methods without invoking native or adapter operations', () => {
  const readFile = vi.fn(),
    appendFile = vi.fn(),
    stat = vi.fn(),
    readBinaryRange = vi.fn()
  const result = phoneCapabilities(
    { Plugins: { Filesystem: { readFile, appendFile, stat }, Http: {} } },
    { readBinaryRange }
  )
  expect(result.plugins).toEqual(['Filesystem', 'Http'])
  expect(result.filesystemMethods).toEqual({
    readFile: 'function',
    appendFile: 'function',
    stat: 'function',
    readFileInChunks: 'undefined',
  })
  expect(result.adapterMethods.readBinaryRange).toBe('function')
  expect(result.readFileOffsetLength).toBe('unknown')
  for (const method of [readFile, appendFile, stat, readBinaryRange])
    expect(method).not.toHaveBeenCalled()
})

it('reports absent bridges and tolerates unavailable property getters', () => {
  expect(phoneCapabilities(undefined, {}).capacitorExists).toBe(false)
  const filesystem = {
    get readFile() {
      throw new Error('not available')
    },
  }
  expect(
    phoneCapabilities({ Plugins: { Filesystem: filesystem } }, {}).filesystemMethods.readFile
  ).toBe('undefined')
})

it('records chunk reads and native header version metadata without reading files', () => {
  const readFileInChunks = vi.fn()
  const header = { name: 'Filesystem', version: '6.1.0', methods: [{ name: 'readFileInChunks' }] }
  const result = phoneCapabilities(
    {
      getPlatform: () => 'ios',
      PluginHeaders: [header],
      Plugins: { Filesystem: { readFileInChunks } },
    },
    {}
  )
  expect(result.platform).toBe('ios')
  expect(result.filesystemVersion).toBe('6.1.0')
  expect(result.filesystemHeader).toEqual(header)
  expect(result.filesystemMethods.readFileInChunks).toBe('function')
  expect(readFileInChunks).not.toHaveBeenCalled()
})
