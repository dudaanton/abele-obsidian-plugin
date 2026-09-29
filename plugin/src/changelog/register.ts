import { ButtonComponent, Notice, type App, type Plugin } from 'obsidian'
import { startChangelog } from './startup'
import { CHANGELOG_VIEW_TYPE, ChangelogView, openChangelog } from './ChangelogView'
import { runningVersion } from 'virtual:abele-changelog'
import type { Range } from './model'

export const CHANGELOG_VERSION_KEY = 'abele-changelog-version'

/** Unconditional entry points and an independent device-local startup step. */
export function registerChangelog(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerView(CHANGELOG_VIEW_TYPE, (leaf) => new ChangelogView(leaf))
  plugin.addCommand({
    id: 'open-changelog',
    name: 'Open changelog',
    icon: 'list',
    callback: () => void openChangelog(app),
  })
  plugin.register(
    startChangelog(
      {
        read: () => app.loadLocalStorage(CHANGELOG_VERSION_KEY),
        write: (value) => app.saveLocalStorage(CHANGELOG_VERSION_KEY, value),
      },
      runningVersion,
      (callback) => app.workspace.onLayoutReady(callback),
      (range) => showOffer(app, range)
    )
  )
}

export function showOffer(app: App, range: Range): () => void {
  const notice = new Notice(
    `Abele updated to ${range.to}. See what's new since ${range.from}.`,
    12_000
  )
  // Build in the Notice's own document. No focus is requested and no leaf opens on arrival.
  const actions = notice.messageEl.createDiv({ cls: 'abele-changelog-notice__actions' })
  new ButtonComponent(actions)
    .setButtonText("What's new")
    .setCta()
    .setTooltip('Open changes since the previous version')
    .onClick(() => {
      notice.hide()
      void openChangelog(app, range)
    })
  new ButtonComponent(actions)
    .setButtonText('Dismiss')
    .setTooltip('Dismiss this update notice')
    .onClick(() => notice.hide())
  return () => notice.hide()
}
