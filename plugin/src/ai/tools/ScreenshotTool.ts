import type { AgentTool, UserContentPart } from '../client'
import type { WorkspaceLeaf } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'
import domtoimage from 'dom-to-image-more'
import { findScriptView } from './scriptViewLookup'
import { saveImageToVault } from './imageUtils'
import dayjs from 'dayjs'

export function findLeafByFile(path: string): WorkspaceLeaf | null {
  const { app } = GlobalStore.getInstance()
  let found: WorkspaceLeaf | null = null
  app.workspace.iterateAllLeaves((leaf) => {
    if (!found && (leaf.view as any).file?.path === path) {
      found = leaf
    }
  })
  return found
}

/** A box on the screen, in CSS pixels of the window it is in. */
export interface VisibleRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The part of `el` that is on screen right now, or `null` when none of it is.
 *
 * On screen means what it says: inside the window, in a tab that is showing. An element in a
 * tab behind another, or in a collapsed sidebar, has no box at all and is not captured — the
 * person decides what is visible, and the agent gets exactly that.
 */
export function visibleRect(el: HTMLElement): VisibleRect | null {
  if (!el.isConnected) return null
  const win = el.ownerDocument.defaultView ?? window
  const r = el.getBoundingClientRect()
  const x = Math.max(r.left, 0)
  const y = Math.max(r.top, 0)
  const right = Math.min(r.right, win.innerWidth)
  const bottom = Math.min(r.bottom, win.innerHeight)
  if (right - x < 1 || bottom - y < 1) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(right - x),
    height: Math.round(bottom - y),
  }
}

/** Makes a PNG data URL of `rect`, which is the visible part of `el`. */
export type Capturer = (el: HTMLElement, rect: VisibleRect) => Promise<string>

interface RemoteLike {
  getCurrentWebContents(): {
    capturePage(rect: VisibleRect): Promise<{ toDataURL(): string }>
  }
}

/**
 * Electron's own capture of the window, when this is the main window on the desktop: the
 * pixels as drawn, scroll position and all. `dom-to-image` draws from a clone of the DOM,
 * which starts every scroller at the top, so it is only the fallback — a popout window (its
 * web contents are not the current ones) and the phone.
 */
export const captureVisible: Capturer = async (el, rect) => {
  const remote = electronRemote()
  if (remote && el.ownerDocument === document) {
    const image = await remote.getCurrentWebContents().capturePage(rect)
    return image.toDataURL()
  }
  return domtoimage.toPng(el, { width: rect.width, height: rect.height })
}

function electronRemote(): RemoteLike | null {
  try {
    const req = (window as unknown as { require?: (name: string) => unknown }).require
    const electron = req?.('electron') as { remote?: RemoteLike } | undefined
    return electron?.remote && typeof electron.remote.getCurrentWebContents === 'function'
      ? electron.remote
      : null
  } catch {
    return null
  }
}

/**
 * The picture, kept and shown.
 *
 * What the agent sees, the person should see too: the screenshot goes into the attachments
 * folder like a generated image does, the chat shows it under the tool call, and the path in
 * the result is what the chat reads it back from. The model gets the same picture in the
 * conversation.
 */
async function picture(label: string, nameHint: string, dataUrl: string) {
  const path = await saveImageToVault(dataUrl, nameHint)
  ScopeResolver.getInstance().addFile(path)
  return {
    content: [{ type: 'text' as const, text: `Screenshot saved: ${path}` }],
    injectMessages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: label },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] as UserContentPart[],
        timestamp: Date.now(),
      },
    ],
  }
}

/** A file name a person can read in the attachments folder: what was shot, and when. */
const shotName = (what: string) =>
  `Screenshot ${what.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()} ${dayjs().format('YYYY-MM-DD HH-mm-ss')}`

export function createScreenshotTool(capture: Capturer = captureVisible): AgentTool {
  return {
    name: 'screenshot',
    label: 'Screenshot',
    description:
      'Take a screenshot of a file open in Obsidian, or of a script view. With path: if the file is already open, captures its current view without reloading; if not, opens it in a new tab first. With view (a tab title or script name): captures the part of that view that is on screen right now, as the person sees it — the visible area only, at their scroll position; a tab that is not showing cannot be captured. The picture is saved to the attachments folder and shown in the chat, so the person sees what you saw. Use this to visually inspect layout, content, or rendering.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to vault root' },
        view: {
          type: 'string',
          description:
            'A script view, by its tab title or script name. Use instead of path. Only what is on screen is captured.',
        },
      },
      required: [],
    },
    execute: async (_id, params) => {
      const viewName = params.view as string | undefined
      if (viewName) {
        // The leaf's content, not the teleport target: that is the box the person sees, with
        // the error strip and the padding the view sits in.
        const box = (m: { el: HTMLElement | null }) =>
          (m.el?.closest('.view-content') ?? m.el) as HTMLElement | null
        // Two tabs of one script — one restored and hidden, one just opened — share a title;
        // the one on screen is the one meant.
        const { view, model } = findScriptView(viewName, (m) => {
          const b = box(m)
          return b !== null && visibleRect(b) !== null
        })
        const el = box(model)
        if (!el) throw new Error(`View "${view.title}" has no element yet; it is still starting.`)
        const rect = visibleRect(el)
        if (!rect) {
          throw new Error(
            `View "${view.title}" is not on screen — its tab is behind another, or its pane is collapsed. Only what is visible can be captured; ask the person to bring it into view.`
          )
        }
        const dataUrl = await capture(el, rect)
        return picture(
          `[Screenshot: view "${view.title}" — the visible part of the tab, ${rect.width}×${rect.height}]`,
          shotName(view.title),
          dataUrl
        )
      }

      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path or view')
      if (!ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }

      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)

      let targetLeaf = findLeafByFile(path)

      if (!targetLeaf) {
        targetLeaf = app.workspace.getLeaf('tab')
        await targetLeaf.openFile(file)
        // Brief delay to let the view render
        await new Promise((r) => window.setTimeout(r, 500))
      }

      const el = targetLeaf.view.containerEl
      if (!el) throw new Error('Leaf has no container element')

      const dataUrl = await domtoimage.toPng(el, {
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: {
          overflow: 'visible',
        },
      })

      return picture(`[Screenshot: ${path}]`, shotName(file.basename), dataUrl)
    },
  }
}
