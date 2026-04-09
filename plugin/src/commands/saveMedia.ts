import { GlobalStore } from '@/stores/GlobalStore'

export const saveMedia = (): void => {
  GlobalStore.getInstance().saveMediaModalOpened.value = true
}
