import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ref, type Ref } from 'vue'
import type { TFile } from 'obsidian'

export const FIND_AND_REPLACE_VIEW_ID = 'abele-find-and-replace'
export const FIND_AND_REPLACE_ID_ATTR = 'abele-find-and-replace-id'

export interface FindAndReplaceInstance {
  id: string
  files: Ref<TFile[]>
}

export class FindAndReplaceView extends BasesView {
  type = FIND_AND_REPLACE_VIEW_ID
  private containerEl: HTMLElement
  private instanceId: string
  private filesRef: Ref<TFile[]>

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    this.containerEl = containerEl
    this.instanceId = nanoid()
    this.filesRef = ref([])

    const widgetContainer = createDiv({
      attr: { [FIND_AND_REPLACE_ID_ATTR]: this.instanceId },
    })
    this.containerEl.appendChild(widgetContainer)

    const store = GlobalStore.getInstance()
    const map = new Map(store.findAndReplaceBasesInstances.value)
    map.set(this.instanceId, { id: this.instanceId, files: this.filesRef })
    store.findAndReplaceBasesInstances.value = map
  }

  onDataUpdated(): void {
    this.filesRef.value = this.data.data.map((entry) => entry.file)
  }

  onunload(): void {
    const store = GlobalStore.getInstance()
    const map = new Map(store.findAndReplaceBasesInstances.value)
    map.delete(this.instanceId)
    store.findAndReplaceBasesInstances.value = map
  }
}
