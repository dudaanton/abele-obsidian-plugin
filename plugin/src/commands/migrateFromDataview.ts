import { GlobalStore } from '@/stores/GlobalStore'

export const migrateFromDataview = async (): Promise<void> => {
  GlobalStore.getInstance().migrateFromDataviewModalOpened.value = true
}
