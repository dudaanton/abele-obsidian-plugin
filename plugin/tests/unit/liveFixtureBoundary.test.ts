import { describe, expect, it, vi } from 'vitest'
import { closeFixtureLeaves, dismissBoundaryNotices } from '../e2e/helpers/fixtureBoundary'

describe('live fixture file boundary', () => {
  it('persists queued edits and awaits unload before detaching a fixture', async () => {
    const events: string[] = []
    let saved!: () => void
    let unloaded!: () => void
    const leaf = {
      view: {
        requestSave: Object.assign(() => {}, { cancel: () => events.push('cancel timer') }),
        save: async () => {
          events.push('save')
          await new Promise<void>((resolve) => {
            saved = resolve
          })
          events.push('saved')
        },
      },
      setViewState: async (state: { type: string }) => {
        events.push(state.type)
        await new Promise<void>((resolve) => {
          unloaded = resolve
        })
        events.push('unloaded')
      },
      detach: () => events.push('detach'),
    }
    const closing = closeFixtureLeaves([leaf])
    await vi.waitFor(() => expect(events).toEqual(['cancel timer', 'save']))
    saved()
    await vi.waitFor(() => expect(events).toContain('empty'))
    expect(events).not.toContain('detach')
    unloaded()
    await closing
    expect(events).toEqual(['cancel timer', 'save', 'saved', 'empty', 'unloaded', 'detach'])
  })

  it('never deletes or detaches a fixture whose pending save failed', async () => {
    const detach = vi.fn(),
      setViewState = vi.fn()
    await expect(
      closeFixtureLeaves([
        {
          view: {
            save: async () => {
              throw Error('sample save failure')
            },
          },
          detach,
          setViewState,
        },
      ])
    ).rejects.toThrow('sample save failure')
    expect(detach).not.toHaveBeenCalled()
    expect(setViewState).not.toHaveBeenCalled()
  })

  it('dismisses old notices only at the boundary and reports their text', async () => {
    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.textContent = 'Sample stale notice'
    notice.onclick = () => notice.remove()
    document.body.append(notice)
    expect(await dismissBoundaryNotices(document, async () => {})).toEqual(['Sample stale notice'])
    expect(document.querySelector('.notice')).toBeNull()
  })
})
