import { GlobalStore } from '@/stores/GlobalStore'

export const importFiles = (): void => {
  GlobalStore.getInstance().importFilesModalOpened.value = true
}
