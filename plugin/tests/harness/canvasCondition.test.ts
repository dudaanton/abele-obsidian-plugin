import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canvasCondition,
  canvasAttachmentNames,
  canvasTypingState,
  shortCanvasQuery,
} from '../e2e/helpers/canvasCondition'

const evaluate = (body: string, probe: () => unknown) =>
  new Function('probe', `return (async()=>{${body}})()`)(probe)

describe('canvas condition evaluated inside the page', () => {
  it('waits locally and returns the first reachable geometry', async () => {
    let calls = 0
    const point = [20, 40]
    expect(
      await evaluate(canvasCondition('return probe()', 1000), () => (++calls === 1 ? null : point))
    ).toEqual(point)
    expect(calls).toBe(2)
  })

  it('fails when the condition never arrives', async () => {
    await expect(evaluate(canvasCondition('return probe()', 5), () => null)).rejects.toThrow(
      'Canvas condition did not become ready'
    )
  })

  it('keeps waiting through a temporarily missing view', async () => {
    let calls = 0
    expect(
      await evaluate(canvasCondition('return probe()', 1000), () => {
        if (++calls === 1) throw new Error('View is mounting')
        return true
      })
    ).toBe(true)
    expect(calls).toBe(2)
  })
})

describe('canvas picker input', () => {
  it('types a native rename once and leaves verification to the persisted end state', async () => {
    const source = readFileSync(resolve(__dirname, '../e2e/canvasEditor.e2e.test.ts'), 'utf8')
    const body = source
      .slice(source.indexOf('const type = '), source.indexOf('const shot = '))
      .replace('text: string', 'text')
      .replace('run<{ expected: string }>', 'run')
    const run = vi.fn(() => ({ expected: 'sample-renamed' }))
    const typeText = vi.fn()
    const until = vi.fn()
    const type = new Function(
      'onPhone',
      'run',
      'canvasTypingState',
      'typeText',
      'measured',
      'until',
      `${body}; return type`
    )(
      () => true,
      run,
      canvasTypingState,
      typeText,
      (_kind: string, action: () => unknown) => action(),
      until
    )
    await type('sample-renamed', false)
    expect(typeText).toHaveBeenCalledExactlyOnceWith('sample-renamed', 'keys')
    expect(run).toHaveBeenCalledTimes(1)
    expect(until).not.toHaveBeenCalled()
    run.mockReturnValue({ expected: 'qx' })
    await type('qx')
    expect(until).toHaveBeenCalledExactlyOnceWith('document.activeElement?.value==="qx"', 'type')
  })

  it('reports the observed field value when a condition times out', async () => {
    const page = new Function(
      'document',
      `return (async()=>{${canvasCondition('return false', 5)}})()`
    )
    await expect(page({ activeElement: { value: 'Sample-renamed' } })).rejects.toThrow(
      'observed field value: "Sample-renamed"'
    )
  })

  it('gives both attachment fixtures short, distinct searchable names', () => {
    const names = Object.values(canvasAttachmentNames('abcd-1234'))
    expect(new Set(names).size).toBe(2)
    const paths = names.map((name) => `Sample canvas abcd-1234/sample-assets/${name}`)
    for (const [index, name] of names.entries()) {
      expect(name.length).toBeLessThanOrEqual(10)
      const query = shortCanvasQuery(paths[index], [...paths, 'Other/sample-image.svg'])
      expect(query.length).toBeLessThanOrEqual(name.length)
      let matches = 0
      for (const path of paths) {
        let at = 0
        for (const char of path.toLowerCase()) if (char === query[at]) at++
        if (at === query.length) matches++
      }
      expect(matches).toBe(1)
    }
  })

  it('uses a short query which only the complete target path can match', () => {
    const target = 'Sample/sample-assets/sample-image.svg'
    const paths = [target, 'Sample/sample-assets/sample-drawing.svg', 'Other/image.md']
    const query = shortCanvasQuery(target, paths)
    expect(query.length).toBeLessThan('sample-image.svg'.length)
    const matches = paths.filter((path) => {
      let at = 0
      for (const char of path.toLowerCase()) if (char === query[at]) at++
      return at === query.length
    })
    expect(matches).toEqual([target])
  })

  it('keeps the filename fallback when equal basenames cannot be distinguished', () => {
    expect(shortCanvasQuery('One/a.svg', ['One/a.svg', 'Two/a.svg'])).toBe('a.svg')
  })

  it('never sends a directory or more than ten characters to the keyboard', () => {
    for (const name of ['sample-image.svg', 'sample-drawing.svg', 'qx1234.svg', 'wz5678.svg']) {
      const target = `Sample long directory/another directory/${name}`
      const query = shortCanvasQuery(target, [target, `Other/${name}`])
      expect(query.length).toBeLessThanOrEqual(10)
      expect(query.length).toBeLessThanOrEqual(name.length)
      expect(query).not.toContain('/')
      expect(name).toContain(query)
    }
  })

  it('can run inside the page without module bindings', () => {
    const query = new Function(
      `return (${shortCanvasQuery.toString()})`
    )() as typeof shortCanvasQuery
    expect(query('Sample/image.svg', ['Sample/image.svg', 'Sample/drawing.svg'])).toBe(
      shortCanvasQuery('Sample/image.svg', ['Sample/image.svg', 'Sample/drawing.svg'])
    )
  })

  it('reads the expected typed value in the same eval that waits for keyboard readiness', async () => {
    const field = { value: 'sample', selectionStart: 1, selectionEnd: 4, matches: () => true }
    const page = new Function(
      'document',
      'window',
      'getComputedStyle',
      'innerHeight',
      `return (async()=>{${canvasTypingState('x')}})()`
    )
    expect(
      await page(
        { activeElement: field, body: {} },
        {},
        () => ({ getPropertyValue: () => '300' }),
        800
      )
    ).toEqual({ expected: 'sxle' })
  })
})
