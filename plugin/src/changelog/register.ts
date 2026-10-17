import { t } from '@/i18n'
import type { App, Plugin } from 'obsidian'
import { noticeWithActions } from '@/components/obsidian/notice'
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
    name: t('commands.open-changelog'),
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
  // Built in the Notice's own document. No focus is requested and no leaf opens on arrival.
  const shown = noticeWithActions(
    `Abele updated to ${range.to}. See what's new since ${range.from}.`,
    [
      {
        text: "What's new",
        tooltip: 'Open changes since the previous version',
        accent: true,
        run: () => {
          shown.hide()
          void openChangelog(app, range)
        },
      },
      { text: 'Dismiss', tooltip: 'Dismiss this update notice', run: () => shown.hide() },
    ],
    12_000
  )
  return () => shown.hide()
}
