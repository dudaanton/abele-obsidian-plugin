import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const source = (name: string) => readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8')

describe('live probe synchronization and failure evidence', () => {
  it('samples footer geometry after the rendering step, including before-paint resize corrections', async () => {
    const text = source('footerPlace')
    const frame = text.slice(text.indexOf('  const frame ='), text.indexOf('  const until ='))
    const callbacks: (() => void)[] = [],
      tasks: (() => void)[] = []
    const run = new Function('requestAnimationFrame', 'setTimeout', `${frame};return frame()`)
    let sampled = false
    const result = run(
      (fn: () => void) => callbacks.push(fn),
      (fn: () => void) => tasks.push(fn)
    ).then(() => {
      sampled = true
    })
    callbacks.shift()!()
    await Promise.resolve()
    // ResizeObserver runs after animation-frame callbacks, before the browser paints.
    expect(sampled).toBe(false)
    expect(tasks).toHaveLength(1)
    tasks.shift()!()
    await result
    expect(sampled).toBe(true)
  })
  it('waits for scheduled Markdown saves before asserting source editability', async () => {
    const text = source('slidesLinks')
    const poll = text.slice(text.indexOf('      const until='), text.indexOf('      const dir='))
    const edit = text.slice(
      text.indexOf('        // A link opens the file before its text arrives'),
      text.indexOf('        r.noteShot=')
    )
    let reads = 0
    const app = {
      vault: {
        read: vi.fn(async () => (++reads < 3 ? 'Original note' : 'Original note\nA sample edit.')),
      },
    }
    const leaf = {
      view: {
        editor: { getValue: () => 'Original note', setValue: vi.fn() },
        getViewData: () => 'Original note',
        save: vi.fn(async () => {}),
      },
    }
    const run = new Function(
      'app',
      'leaf',
      `return (async()=>{const note={},r={},noteText='Original note',wait=async()=>{};${poll}${edit};return r})()`
    )
    expect((await run(app, leaf)).editable).toBe(true)
    expect(reads).toBe(3)
  })

  it('fails explicitly when every native tap acknowledgement is lost, retaining target and errors', async () => {
    const text = source('chatOpenPhone')
    const gesture = text.slice(
      text.indexOf('  const tap = async'),
      text.indexOf('  const report =')
    )
    const host = {
      tap: vi.fn(async () => {
        throw new Error('The network connection was lost.')
      }),
    }
    const el = {
      scrollIntoView: vi.fn(),
      getBoundingClientRect: () => ({ left: 20, top: 30, width: 40, height: 20 }),
      contains: () => true,
    }
    const run = new Function(
      'window',
      'document',
      'el',
      `return (async()=>{const wait=async()=>{},hits={},opened=()=>false;${gesture};await tap('sample attachment',el)})()`
    )
    await expect(run({ __e2eHost: host }, { elementFromPoint: () => el }, el)).rejects.toThrow(
      /sample attachment.*on it.*connection was lost/
    )
    expect(host.tap).toHaveBeenCalledTimes(3)
  })

  it('keeps the primary selection failure message even when WebKit provides only an at-sign stack', () => {
    const text = readFileSync('tests/e2e/helpers/selectionReturn.ts', 'utf8')
    const capture = text.slice(
      text.indexOf('} catch(error){') + '} catch(error){'.length,
      text.indexOf('} finally {leaf?.detach()')
    )
    const run = new Function('error', `const report={};${capture};return report.error`)
    expect(run({ message: 'Synthetic native hold transport failure', stack: '@' })).toContain(
      'Synthetic native hold transport failure'
    )
    expect(run({ message: 'Synthetic native hold transport failure', stack: '@' })).toContain('@')
  })
})
