import { describe, expect, it } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { checkedMutation } from '@/ai/rewind/checkedMutation'
import { contentHash } from '@/ai/readGuard'

function storage() {
  let text = 'agent'
  let tail = Promise.resolve()
  const adapter = {
    queue<T>(action: () => Promise<T>): Promise<T> {
      const work = tail.then(action)
      tail = work.then(
        () => {},
        () => {}
      )
      return work
    },
    stat: () => adapter.queue(async () => ({ type: 'file', size: text.length })),
    read: () => adapter.queue(async () => text),
    write: (_path: string, value: string) =>
      adapter.queue(async () => {
        text = value
      }),
  }
  const undo = () =>
    checkedMutation(
      adapter as unknown as DataAdapter,
      new Map([['sample.md', contentHash('agent')]]),
      ['sample.md'],
      new Set(),
      () => adapter.write('sample.md', 'original')
    )
  return { adapter, undo, text: () => text }
}

describe('native restore queue boundary', () => {
  it('refuses an earlier queued competing edit before issuing the undo write', async () => {
    const s = storage()
    const other = s.adapter.write('sample.md', 'other writer')
    await expect(s.undo()).rejects.toThrow(/changed/i)
    await other
    expect(s.text()).toBe('other writer')
  })
  it('does not overwrite an edit queued while undo is checking its precondition', async () => {
    const s = storage()
    const undo = s.undo()
    const other = s.adapter.write('sample.md', 'later writer')
    await Promise.all([undo, other])
    expect(s.text()).toBe('later writer')
  })
  it('keeps the revision guard when native trash requests a fallback', async () => {
    const s = storage()
    const expected = new Map([['sample.md', contentHash('agent')]])
    await checkedMutation(
      s.adapter as unknown as DataAdapter,
      expected,
      ['sample.md'],
      new Set(),
      async () => false
    )
    await s.adapter.write('sample.md', 'another writer')
    await expect(
      checkedMutation(s.adapter as unknown as DataAdapter, expected, ['sample.md'], new Set(), () =>
        s.adapter.write('sample.md', 'removed')
      )
    ).rejects.toThrow(/changed/i)
    expect(s.text()).toBe('another writer')
  })

  it('refuses unsupported adapters before issuing a mutation', async () => {
    let issued = false
    await expect(
      checkedMutation(
        {} as DataAdapter,
        new Map([['sample.md', null]]),
        ['sample.md'],
        new Set(),
        async () => {
          issued = true
        }
      )
    ).rejects.toThrow(/cannot perform/)
    expect(issued).toBe(false)
  })
})
