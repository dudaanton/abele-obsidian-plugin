import { GlobalStore } from '@/stores/GlobalStore'

export const findAndReplace = async (): Promise<void> => {
  GlobalStore.getInstance().findAndReplaceModalOpened.value = true
}
