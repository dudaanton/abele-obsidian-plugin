import { ItemView, type App, type ViewStateResult } from 'obsidian'
import { createApp, reactive, type App as VueApp } from 'vue'
import Changelog from '@/components/changelog/Changelog.vue'
import releases from 'virtual:abele-changelog'
import { normalizeRange, type Range } from './model'

export const CHANGELOG_VIEW_TYPE = 'abele-changelog'
const current = releases[0]?.version ?? '0.0.0'

export class ChangelogView extends ItemView {
  readonly model: { range: Range | null } = reactive({ range: null })
  private vue: VueApp | null = null
  getViewType(): string {
    return CHANGELOG_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'Abele changelog'
  }
  getIcon(): string {
    return 'list'
  }
  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-changelog-view')
    this.vue = createApp(Changelog, { releases, model: this.model })
    this.vue.mount(this.contentEl.createDiv())
  }
  async onClose(): Promise<void> {
    this.vue?.unmount()
    this.vue = null
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.model.range = normalizeRange((state as { range?: unknown } | null)?.range, current)
    await super.setState(state, result)
  }
  getState(): Record<string, unknown> {
    return { range: this.model.range }
  }
}

export async function openChangelog(app: App, range: Range | null = null): Promise<void> {
  const { workspace } = app
  const leaf = workspace.getLeavesOfType(CHANGELOG_VIEW_TYPE)[0] ?? workspace.getLeaf('tab')
  await leaf.setViewState({ type: CHANGELOG_VIEW_TYPE, active: true, state: { range } })
  await workspace.revealLeaf(leaf)
}
