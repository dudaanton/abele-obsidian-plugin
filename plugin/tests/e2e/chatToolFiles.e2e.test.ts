import { it } from 'vitest'
import { targets } from './helpers/target'
import { checkToolFileLinks } from './helpers/toolFileLinks'
targets('desktop')
it.each([false, true])(
  'keeps saved file links visible in chat, phone layout: %s',
  async (phone) => {
    await checkToolFileLinks(false, phone)
  }
)
