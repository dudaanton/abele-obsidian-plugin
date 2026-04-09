import { GlobalStore } from '@/stores/GlobalStore'

export const unusedMedia = (): void => {
  GlobalStore.getInstance().unusedMediaModalOpened.value = true
}
