import { expect, it } from 'vitest'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { buildPayload } from '@/transfer/entries'
import { storeReceivedKeys } from '@/transfer/receivedKeys'
import { useVault } from '../helpers/testEnv'
import type { TransferEntry } from '@/transfer/types'

it('keeps scoped credentials and binding proofs out of the ordinary road and transfer', () => {
  useVault([])
  setSecrets(null)
  const road = secrets()
  for (const id of [
    'abele-scoped-installation-sample',
    'abele-scoped-installation-sample-binding',
    'abele-scoped-invitation-sample-accepted',
  ]) {
    road.setLocal(id, 'invented-local-only-value')
    const entry: TransferEntry = {
      section: 'ai-providers',
      id: 'sample-provider',
      label: 'Sample provider',
      data: {},
      secretIds: [id],
    }
    expect(road.get(id)).toBe('')
    expect(buildPayload([entry], () => 'invented-local-only-value').secrets).toEqual({})
    storeReceivedKeys([entry], { [id]: 'invented-unwanted-replacement' })
    expect(road.getLocal(id)).toBe('invented-local-only-value')
  }
})
