/**
 * Everything the GitHub integration hooks into Obsidian, in one call from `onload`.
 *
 * The tab type is registered whether or not the feature is on, so a tab left open survives a
 * restart; everything that acts — the click, the menu item, the command — asks the settings
 * first, so switching the feature off takes effect at once without a reload.
 */
import { MarkdownView, Platform, type App, type Plugin } from 'obsidian'
import type { EditorView } from '@codemirror/view'
import { GithubView } from './GithubView'
import {
  GITHUB_VIEW_TYPE,
  githubSettings,
  noteActiveLeaf,
  openGithubUrl,
  parseForSettings,
} from './GithubService'
import { linkAtClick, paneForClick, urlAtCursor } from './links'
import { registerSnippetBlock } from './snippetCard'
import { OpenPicker } from './open/OpenPicker'
import { initGithubUsers } from './users'

/**
 * Where a click is taken as a click on a note's link. The settings window and dialogs are left
 * alone: a GitHub link there is documentation, and it should go where it always went.
 */
const NOTE_SURFACES = '.workspace-leaf-content, .abele-markdown, .markdown-rendered'

/**
 * The event Obsidian itself opens a link on. Desktop and iOS answer the click; Android answers the
 * `mousedown` before it, and taking the click there would be too late — the browser is already
 * open. Mirrors `onEditorClick` in Obsidian's own editor.
 */
const OPENING_EVENT: 'click' | 'mousedown' = Platform.isAndroidApp ? 'mousedown' : 'click'

/** Kept here too: this is where it was first exported from. */
export { paneForClick }

/**
 * The click listener that takes a GitHub link from Obsidian: in a note, its properties, a chat,
 * a GitHub tab. Registered in the capture phase on every window's document.
 */
export function linkClickHandler(app: App) {
  return (evt: MouseEvent) => {
    const settings = githubSettings()
    if (!settings.enabled || !settings.openLinks) return
    if (evt.button !== 0 || evt.defaultPrevented) return

    const target = evt.target as Element | null
    if (!target?.closest?.(NOTE_SURFACES)) return

    const link = linkAtClick(target)
    if (!link) return
    const pane = paneForClick(evt, link.sourceMode)
    if (pane === null) return
    if (!parseForSettings(link.url)) return

    evt.preventDefault()
    evt.stopImmediatePropagation()
    void openGithubUrl(app, link.url, pane)
  }
}

export function registerGithub(plugin: Plugin): void {
  const { app } = plugin

  plugin.registerView(GITHUB_VIEW_TYPE, (leaf) => new GithubView(leaf))
  // People's names and pictures, kept on this device; what was met last is written on the way out.
  const users = initGithubUsers(plugin)
  plugin.register(() => void users.save())
  // Code and comments kept in notes, drawn as cards.
  registerSnippetBlock((lang, handler) => plugin.registerMarkdownCodeBlockProcessor(lang, handler))

  // Capture phase, so this runs before Obsidian's own handler on the link and can stop it.
  const onClick = linkClickHandler(app)
  plugin.registerDomEvent(document, OPENING_EVENT, onClick, { capture: true })
  plugin.registerEvent(
    app.workspace.on('window-open', (_win, win) => {
      plugin.registerDomEvent(win.document, OPENING_EVENT, onClick, { capture: true })
    })
  )

  plugin.registerEvent(
    app.workspace.on('url-menu', (menu, url) => {
      if (!githubSettings().enabled || !parseForSettings(url)) return
      menu.addItem((item) =>
        item
          .setTitle('Open in Obsidian')
          .setIcon('github')
          .setSection('open')
          .onClick(() => void openGithubUrl(app, url))
      )
      menu.addItem((item) =>
        item
          .setTitle('Open in Obsidian in a new tab')
          .setIcon('github')
          .setSection('open')
          .onClick(() => void openGithubUrl(app, url, 'tab'))
      )
    })
  )

  // Which GitHub tab was used last, so a plain click keeps landing in it.
  plugin.registerEvent(app.workspace.on('active-leaf-change', noteActiveLeaf))

  plugin.addCommand({
    id: 'chat-about-github-item',
    name: 'Chat about this GitHub item',
    icon: 'message-square-plus',
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(GithubView)
      if (!githubSettings().enabled || !view?.canChatAbout()) return false
      if (!checking) view.chatAbout()
      return true
    },
  })

  plugin.addCommand({
    id: 'open-github-link',
    name: 'Open GitHub link or item',
    icon: 'github',
    checkCallback: (checking) => {
      if (!githubSettings().enabled) return false
      if (checking) return true

      // A GitHub link under the cursor opens straight away; otherwise the picker asks.
      const view = app.workspace.getActiveViewOfType(MarkdownView)
      const cm = (view?.editor as unknown as { cm?: EditorView } | undefined)?.cm
      const underCursor = cm ? urlAtCursor(cm) : null
      if (underCursor && parseForSettings(underCursor)) {
        void openGithubUrl(app, underCursor)
        return true
      }
      new OpenPicker(app, underCursor ?? '').open()
      return true
    },
  })
}
