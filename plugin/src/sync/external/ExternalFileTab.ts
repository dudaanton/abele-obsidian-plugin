import { ItemView, Platform, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { h, shallowRef } from 'vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import ExternalFileView from '@/components/external/ExternalFileView.vue'
import { tokenOffloadsOf } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'
import { ExternalPresentation } from './presentation'
import { externalPreview } from './preview'
import { externalActionsOf } from './actionHost'
import { EXTERNAL_VIEW_TYPE } from './opening'

export class ExternalFileTab extends ItemView {
  private path = ''
  private mounted: KitMount | null = null
  private presentation: ExternalPresentation | null = null
  private unsubscribe: (() => void) | null = null
  private opening = false
  private subpath = ''
  private stateOff: (() => void)[] = []
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }
  getViewType(): string {
    return EXTERNAL_VIEW_TYPE
  }
  getIcon(): string {
    return 'cloud'
  }
  getDisplayText(): string {
    return this.path.split('/').at(-1) || 'External file'
  }
  getState(): Record<string, unknown> {
    return { path: this.path, subpath: this.subpath }
  }
  async setState(
    state: { path?: string; file?: string; subpath?: string },
    result: ViewStateResult
  ): Promise<void> {
    const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
    const path = manager.originalPath(state.path ?? state.file ?? '')
    if (!path) return
    this.clear()
    this.path = path
    this.subpath = state.subpath ?? ''
    let openRequested = false
    const presentation = new ExternalPresentation(manager, path, undefined, (key) =>
      externalPreview(this.app, key)
    )
    this.presentation = presentation
    const value = shallowRef(presentation.value)
    const sync = () => {
      value.value = presentation.value
      if (openRequested && value.value.hydrated && !this.opening) {
        const file = this.app.vault.getFileByPath(path)
        if (file) {
          this.opening = true
          void this.leaf.openFile(file, { eState: { subpath: this.subpath } }).catch((error) => {
            this.opening = false
            console.debug('[abele-sync] downloaded file could not be opened', error)
          })
        }
      }
    }
    this.unsubscribe = presentation.subscribe(sync)
    for (const ref of [this.app.vault.on('create', sync), this.app.vault.on('rename', sync)]) {
      this.stateOff.push(() => this.app.vault.offref(ref))
    }
    const download = () => {
      openRequested = true
      return presentation.download()
    }
    const keep = () => {
      openRequested = true
      return presentation.download(async () => {
        const host = externalActionsOf.get(this.app.vault)
        if (!host) throw new Error('Connections are unavailable')
        await host.pin(path, true)
      })
    }
    this.mounted = mountKit(
      this.contentEl,
      {
        render: () =>
          h(ExternalFileView, {
            file: value.value.file,
            state: value.value.state,
            progress: value.value.progress,
            error: value.value.error,
            narrow: Platform.isMobile,
            onDownload: (): void => void download(),
            onRetry: (): void => void download(),
            onKeep: (): void => void keep(),
            onCancel: () => presentation.cancel(),
          }),
      },
      null,
      { owner: this }
    )
    const refresh = (): void => void presentation.refresh()
    for (const name of ['online', 'offline']) {
      this.containerEl.ownerDocument.defaultView?.addEventListener(name, refresh)
      this.stateOff.push(() =>
        this.containerEl.ownerDocument.defaultView?.removeEventListener(name, refresh)
      )
    }
    await presentation.refresh()
    await super.setState(state, result)
  }
  private clear(): void {
    for (const off of this.stateOff) off()
    this.stateOff = []
    this.unsubscribe?.()
    this.unsubscribe = null
    this.presentation?.dispose()
    this.presentation = null
    this.mounted?.unmount()
    this.mounted = null
    this.contentEl.empty()
    this.opening = false
  }
  async onClose(): Promise<void> {
    this.clear()
  }
}
