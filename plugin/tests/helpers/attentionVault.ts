import { useVault } from './testEnv'
import type { FakeFileSpec } from './fakeVault'

/** An established list: these lifecycle fixtures happen after its original baseline. */
export function useAttentionVault(specs: FakeFileSpec[]) {
  const app = useVault(specs)
  app.saveLocalStorage('abele-agents-started-at', 0)
  return app
}
