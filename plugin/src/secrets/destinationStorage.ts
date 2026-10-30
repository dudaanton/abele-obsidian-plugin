import { GlobalStore } from '@/stores/GlobalStore'
import { DestinationPolicy, type Destination } from './DestinationPolicy'

const STORAGE_KEY = 'abele-key-destinations-v1'

export function destinationPolicy(): DestinationPolicy {
  const app = GlobalStore.getInstance().app
  return new DestinationPolicy({
    load: () => app.loadLocalStorage(STORAGE_KEY),
    save: (value) => app.saveLocalStorage(STORAGE_KEY, value),
  })
}

/** A fresh slot for a formerly literal header keeps its existing recipient on this device. */
export function acceptMigratedDestinations(destinations: Destination[]): void {
  // A new installation still initializes all its service recipients together at startup.
  if (GlobalStore.getInstance().app.loadLocalStorage(STORAGE_KEY) == null) return
  destinationPolicy().accept(destinations)
}
