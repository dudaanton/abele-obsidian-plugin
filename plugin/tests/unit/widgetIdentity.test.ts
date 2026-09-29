/**
 * An editor widget and its entry in the store stay together for as long as its element is on
 * screen.
 *
 * CodeMirror asks two widgets whether they are equal in both directions — the old one about the
 * new one when it compares decoration sets, the new one about the old when it decides whether
 * to keep an element. `eq` used to copy the other widget's id into itself, so the old widget
 * could leave a comparison wearing the new one's id; when the element was built again anyway,
 * destroying the old widget took the new one's entry out of the store and its element stayed an
 * empty box. That is what "Insert Abele gallery" over a picture already in the note did: the
 * gallery appeared with nothing in it, until Obsidian was restarted.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorSelection, EditorState } from '@codemirror/state'
import { TFile, editorInfoField, editorLivePreviewField } from 'obsidian'
import { galleryExtensions } from '@/editor/GalleryPlugin'
import { GalleryWidget } from '@/editor/GalleryWidget'
import { TaskWidget } from '@/editor/TaskWidget'
import { widgetMount } from '@/helpers/widgetMounts'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const IMAGE = '![[Attachments/sample-image.png]]'

function noteFile(): TFile {
  const file = new TFile()
  file.path = 'Notes/A.md'
  file.basename = 'A'
  file.extension = 'md'
  return file
}

const store = () => GlobalStore.getInstance()

/** Every gallery element on screen, and whether the store still has an entry drawn into it. */
function mounted(view: EditorView) {
  return Array.from(view.dom.querySelectorAll<HTMLElement>('[data-gallery-id]')).map((el) => ({
    el,
    entry: store().galleriesContainers.value.find((g) => widgetMount(g) === el) ?? null,
  }))
}

beforeEach(() => {
  useVault([{ path: 'Notes/A.md', content: '' }])
  store().galleriesContainers.value.splice(0)
  store().tasksContainers.value.splice(0)
})

describe('a gallery inserted over a picture already in the note', () => {
  it('keeps its entry in the store while its element is on screen', () => {
    const doc = `# A\n\nAbove.\n${IMAGE}\n\nBelow.\n`
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [
          editorLivePreviewField.init(() => true),
          editorInfoField.init(() => ({ file: noteFile() })),
          galleryExtensions,
        ],
      }),
    })

    // What the command does: the header goes in above the picture, the cursor on to its line.
    const at = view.state.doc.line(4).from
    view.dispatch({ selection: EditorSelection.cursor(at) })
    view.dispatch({ changes: { from: at, insert: '::abele-gallery::\n' } })
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(5).from) })
    // And the cursor moving on, which draws the gallery in its closed form.
    view.dispatch({ selection: EditorSelection.cursor(0) })

    const shown = mounted(view)
    expect(shown).toHaveLength(1)
    expect(shown[0].entry).not.toBeNull()
    expect(shown[0].entry!.images.map((i) => i.path)).toEqual([
      'Attachments/sample-image.png',
    ])
    // And nothing left behind for an element that is gone.
    expect(store().galleriesContainers.value).toHaveLength(1)

    view.destroy()
    expect(store().galleriesContainers.value).toHaveLength(0)
  })
})

describe('comparing two widgets', () => {
  it('changes neither of them', () => {
    const file = noteFile()
    const a = new GalleryWidget(file, [], 'grid', 400, true)
    const b = new GalleryWidget(file, [], 'grid', 400, true)
    const before = [JSON.stringify(a), JSON.stringify(b)]
    expect(a.eq(b)).toBe(true)
    expect(b.eq(a)).toBe(true)
    expect([JSON.stringify(a), JSON.stringify(b)]).toEqual(before)

    const t1 = new TaskWidget('Notes/A.md', '[[T]]')
    const t2 = new TaskWidget('Notes/A.md', '[[T]]')
    const tBefore = [JSON.stringify(t1), JSON.stringify(t2)]
    expect(t1.eq(t2)).toBe(true)
    expect([JSON.stringify(t1), JSON.stringify(t2)]).toEqual(tBefore)
  })

  it('takes out of the store exactly the entry drawn into the element being destroyed', () => {
    const file = noteFile()
    const old = new GalleryWidget(file, [], 'grid', 400, true)
    const next = new GalleryWidget(file, [], 'grid', 400, true)
    const oldDom = old.toDOM()
    old.eq(next)
    const nextDom = next.toDOM()

    old.destroy(oldDom)

    expect(store().galleriesContainers.value).toHaveLength(1)
    expect(widgetMount(store().galleriesContainers.value[0])).toBe(
      nextDom.querySelector('[data-gallery-id]')
    )
  })
})
