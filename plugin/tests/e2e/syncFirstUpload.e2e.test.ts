import { expect, it } from 'vitest'
import { liveSuite } from './helpers/syncLiveCases'

const fixture = liveSuite(false)

it('uploads a large local inventory to an empty server despite unsupported local names', async () => {
  const s = fixture(),
    a = s.primary
  a.timeoutMs = 300_000
  await a.long(
    'seed first upload inventory',
    `const root=${JSON.stringify(s.root)};
    await app.vault.createFolder(root);
    for(let bucket=0;bucket<30;bucket++){
      const dir=root+'/Bucket-'+bucket;await app.vault.createFolder(dir);
      for(let n=0;n<100;n++)await app.vault.create(dir+'/Sample-'+n+'.md','Sample '+bucket+' '+n);
    }
    for(let n=0;n<4;n++)await app.vault.createBinary(root+'/sample-'+n+'.bin',new Uint8Array(128*1024).fill(n).buffer);
    for(const name of ['quote".md','question?.md','star*.md','colon:1.bin'])await app.vault.adapter.write(root+'/'+name,'unsupported sample');
    await app.vault.adapter.mkdir(root+'/rewind');await app.vault.adapter.write(root+'/rewind/sample:1.bin','unsupported rewind sample');
    return true`
  )
  expect(await s.items()).toEqual([])
  await s.connect(a, s.server.rootToken, undefined, 300_000)
  const items = (await s.items()).filter((item) => item.kind !== 'directory')
  expect(items).toHaveLength(3004)
  expect(items.some((item) => /["?*:]/.test(item.path))).toBe(false)
  expect(items.find((item) => item.path === s.root + '/Bucket-29/Sample-99.md')).toBeDefined()
  for (let n = 0; n < 4; n++)
    expect(items.find((item) => item.path === s.root + '/sample-' + n + '.bin')?.size).toBe(
      128 * 1024
    )
}, 600_000)
