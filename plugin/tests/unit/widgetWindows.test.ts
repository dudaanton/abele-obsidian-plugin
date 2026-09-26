/**
 * Widgets in a note opened in another window.
 *
 * A popout window has a document of its own. The editor widgets — gallery, task, note header
 * and footer, footnote — were looked up in the main window's document only, both when the
 * component was put into them and when the store swept out the ones whose element was gone.
 * In a popout the first found nothing, so the widget stayed an empty box, and the second
 * threw the widget away on the next tab switch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { Gallery } from '@/entities/Gallery'
import { findInAnyWindow } from '@/helpers/windowDocuments'
import { useVault } from '../helpers/testEnv'

let popout: Document
let mount: HTMLElement

beforeEach(() => {
  const app = useVault([{ path: 'Notes/A.md', content: '' }]) as unknown as Record<string, unknown>
  popout = document.implementation.createHTMLDocument('popout')
  const leafEl = popout.createElement('div')
  popout.body.appendChild(leafEl)
  mount = popout.createElement('div')
  mount.setAttribute('data-gallery-id', 'g-popout')
  leafEl.appendChild(mount)
  app.workspace = {
    iterateAllLeaves: (fn: (leaf: unknown) => void) => fn({ view: { containerEl: leafEl } }),
  }
  GlobalStore.getInstance().galleriesContainers.value.splice(0)
})

afterEach(() => {
  GlobalStore.getInstance().galleriesContainers.value.splice(0)
})

describe('a widget in a popout window', () => {
  it('is found there by its id', () => {
    expect(findInAnyWindow(`[data-gallery-id='g-popout']`)).toBe(mount)
    expect(findInAnyWindow(`[data-gallery-id='nowhere']`)).toBeNull()
  })

  it('still finds a widget in the main window', () => {
    const el = document.createElement('div')
    el.setAttribute('data-task-id', 't-main')
    document.body.appendChild(el)
    expect(findInAnyWindow(`[data-task-id='t-main']`)).toBe(el)
    el.remove()
  })

  it('is not swept out of the store as an orphan', () => {
    const list = GlobalStore.getInstance().galleriesContainers.value
    const gallery = (id: string) =>
      new Gallery({ id, file: null, images: [], layout: 'grid', height: 400, bg: true })
    list.push(gallery('g-popout'), gallery('g-gone'))

    GlobalStore.getInstance().cleanupOrphanedWidgets()

    expect(list.map((g) => g.id)).toEqual(['g-popout'])
  })
})
