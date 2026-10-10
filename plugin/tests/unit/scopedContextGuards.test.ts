import { expect, it } from 'vitest'
import { assertNoScriptContextHold } from '@/scripting/trust/scriptContextHold'
import { SCOPED_JOIN_KEY, SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'

it.each([SCOPED_JOIN_KEY, SCOPED_CONNECTION_KEY])(
  'refuses script execution with retained recovery marker %s',
  (key) => {
    expect(() =>
      assertNoScriptContextHold({
        loadLocalStorage: (name) => (name === key ? {} : null),
        saveLocalStorage: () => {},
      })
    ).toThrow(/Scoped/)
  }
)
