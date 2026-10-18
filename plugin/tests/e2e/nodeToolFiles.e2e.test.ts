import { it } from 'vitest'
import { targets } from './helpers/target'
import { checkToolFileLinks } from './helpers/toolFileLinks'
targets('desktop')
it.each([false, true])(
  'keeps provider paths visible in node chat, phone layout: %s',
  async (phone) => {
    await checkToolFileLinks(true, phone)
  }
)
