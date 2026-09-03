/**
 * A comment, from the command to the card, in the app people actually run.
 *
 * Everything here is a question happy-dom cannot answer. Whether the raw `%%c:…%%` ever
 * reaches the screen is a question about CodeMirror's decorations. Whether the card is visible
 * is a question about a margin that has to be measured. And the phone sheet only exists under
 * `app.emulateMobile(true)`, which is Obsidian switching its own layout — there is no way to
 * ask for it from a test that does not have Obsidian.
 *
 * The probe drives the command, because that is what a person's hotkey does. If the command
 * cannot reach the editor it falls back to creating the comment through `CommentService`, so
 * the rest of the run still says something; `via` records which happened and one assertion
 * pins it to the command.
 *
 * Requires Obsidian running on the demo vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalJson, evalRaw } from './helpers/obsidianCli'

interface Report {
  /** 'command' when the command palette entry did it, 'service' when the fallback did. */
  via: 'command' | 'service' | 'none'
  /** Whether any text node in the editor still shows the marker's raw text. */
  rawMarkerText: boolean
  /** The `data-comment-ids` the widget carries. */
  markerIds: string
  /** Whether the margin reported room — the card is only expected when it did. */
  hasRoom: boolean
  cardVisible: boolean
  /** Where the comment's chat file was expected, and whether it is there. */
  commentPath: string
  commentFileExists: boolean
  /** Under emulateMobile: the sheet and its input. */
  sheetOpen: boolean
  sheetInputVisible: boolean
  /** The probe note and the comment file are gone again. */
  cleaned: boolean
  error: string
}

const NOTE = 'Abele comment probe.md'
const QUOTE = 'the passage the probe asks about'
const BODY = `# Comment probe\n\nA paragraph holding ${QUOTE} and little else.\n`

const probe = `(() => {
  window.__abeleCommentProbe = null
  ;(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const path = ${JSON.stringify(NOTE)}
    const quote = ${JSON.stringify(QUOTE)}
    const service = window.__abeleTest.CommentService.getInstance()
    const report = {
      via: 'none', rawMarkerText: true, markerIds: '', hasRoom: false, cardVisible: false,
      commentPath: '', commentFileExists: false, sheetOpen: false, sheetInputVisible: false,
      cleaned: false, error: '',
    }

    try {
      const stale = app.vault.getAbstractFileByPath(path)
      if (stale) await app.vault.delete(stale)
      const file = await app.vault.create(path, ${JSON.stringify(BODY)})

      const leaf = app.workspace.getLeaf(false)
      await leaf.openFile(file)
      await wait(1000)

      // editorCallback resolves through the active markdown view, not through DOM focus, so
      // a selection set from here is the selection the command sees.
      const editor = app.workspace.activeEditor && app.workspace.activeEditor.editor
      if (!editor) throw new Error('no active editor after opening the probe note')
      const start = editor.getValue().indexOf(quote)
      if (start < 0) throw new Error('the probe note does not hold its own passage')
      editor.setSelection(editor.offsetToPos(start), editor.offsetToPos(start + quote.length))
      await wait(300)

      report.via = app.commands.executeCommandById('abele:comment-here') ? 'command' : 'none'
      await wait(2000)

      if (!document.querySelector('.abele-comment-marker')) {
        await service.create(file, start + quote.length, quote)
        report.via = 'service'
        await wait(2000)
      }

      const content = document.querySelector('.cm-content')
      if (!content) throw new Error('the editor rendered no content')
      const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let raw = false
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.indexOf('%%c:') !== -1) raw = true
      }
      report.rawMarkerText = raw

      const marker = document.querySelector('.abele-comment-marker[data-comment-ids]')
      report.markerIds = marker ? marker.getAttribute('data-comment-ids') : ''

      const box = document.querySelector('.abele-comment-widget-container')
      report.hasRoom = !!box && !box.classList.contains('abele-comment-widget-container_hidden')
      const card = document.querySelector('.abele-comment-card')
      report.cardVisible = !!card && card.getBoundingClientRect().width > 0

      const id = report.markerIds.split(',')[0]
      report.commentPath = id ? service.commentPath(id) : ''
      report.commentFileExists =
        !!report.commentPath && !!app.vault.getAbstractFileByPath(report.commentPath)

      // The phone: no margin at all, so the same card has to arrive as a sheet.
      app.emulateMobile(true)
      await wait(1500)
      const onPhone = document.querySelector('.abele-comment-marker[data-comment-ids]')
      if (onPhone) onPhone.click()
      await wait(1200)
      const sheet = document.querySelector('.modal .abele-comment-card')
      report.sheetOpen = !!sheet
      const input = sheet && sheet.querySelector('textarea')
      report.sheetInputVisible = !!input && input.getBoundingClientRect().height > 0
    } catch (e) {
      report.error = String((e && e.message) || e)
    }

    try {
      const close = document.querySelector('.modal-close-button')
      if (close) close.click()
      app.emulateMobile(false)
      await wait(500)

      for (const id of (report.markerIds || '').split(',').filter(Boolean)) {
        const chat = app.vault.getAbstractFileByPath(service.commentPath(id))
        if (chat) await app.vault.delete(chat)
      }
      const note = app.vault.getAbstractFileByPath(path)
      if (note) await app.vault.delete(note)
      report.cleaned = !app.vault.getAbstractFileByPath(path)
    } catch (e) {
      report.error = (report.error ? report.error + '; ' : '') + String((e && e.message) || e)
    }

    window.__abeleCommentProbe = report
  })()
  return 'started'
})()`

let report: Report

const available = isObsidianRunning() && hasTestApi()

beforeAll(async () => {
  if (!available) return

  evalRaw(probe, 120_000)

  // `eval` cannot await a promise, so the probe parks its result on the window and this polls
  // for it. Each round trip through the CLI costs a moment, hence the wait between attempts.
  let result: Report | null = null
  for (let attempt = 0; attempt < 60 && !result; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    result = evalJson<Report | null>('window.__abeleCommentProbe ?? null', 60_000)
  }
  evalRaw('delete window.__abeleCommentProbe')
  if (!result) throw new Error('The comment probe did not finish in time')
  report = result
}, 180_000)

describe.runIf(available)('commenting on a passage', () => {
  it('got through without an error of its own', () => {
    expect(report.error).toBe('')
  })

  it('is started by the command a hotkey would run', () => {
    expect(report.via).toBe('command')
  })

  it('never shows the marker as raw text in the editor', () => {
    expect(report.rawMarkerText).toBe(false)
  })

  it('puts an icon carrying the comment id where the marker is', () => {
    expect(report.markerIds).toMatch(/^[a-z0-9]{6}$/)
  })

  it('shows the card in the margin exactly when the margin has room', () => {
    expect({ hasRoom: report.hasRoom, cardVisible: report.cardVisible }).toEqual({
      hasRoom: report.hasRoom,
      cardVisible: report.hasRoom,
    })
  })

  it('writes the conversation into the comment folder', () => {
    expect(report.commentPath).toMatch(/^AI\/Comments\/[a-z0-9]{6}\.abchat$/)
    expect(report.commentFileExists).toBe(true)
  })
})

describe.runIf(available)('the same comment on a phone', () => {
  it('opens as a sheet when the icon is tapped', () => {
    expect(report.sheetOpen).toBe(true)
  })

  it('keeps the input where it can be typed into', () => {
    expect(report.sheetInputVisible).toBe(true)
  })
})

describe.runIf(available)('afterwards', () => {
  it('leaves neither the probe note nor its comment behind', () => {
    expect(report.cleaned).toBe(true)
  })
})
