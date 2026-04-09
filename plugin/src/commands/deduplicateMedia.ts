import { GlobalStore } from '@/stores/GlobalStore'

export const deduplicateMedia = (): void => {
  GlobalStore.getInstance().deduplicateMediaModalOpened.value = true
}
