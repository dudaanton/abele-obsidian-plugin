import { expect, it } from 'vitest'
import { liveSuite } from './helpers/syncLiveCases'
import { waitFor } from './helpers/syncVault'
import { onPhone } from './helpers/target'

const fixture = liveSuite()

// Reindex is a desktop setting which clears the cache and reloads the window.
it.each(['upload', 'pull'] as const)(
  'reindexes during %s without extra transfers',
  async (phase) => {
    if (onPhone()) throw new Error('This reindex qualification requires desktop settings')
    const s = fixture(),
      a = s.primary,
      b = s.peer!
    const id = await s.connect(a)
    const peerId = await s.connect(b)
    const stable = { path: `${s.root}/stable.md`, text: 'Already synchronized bytes' }
    a.create(stable.path, stable.text)
    await s.cycle()
    await b.pause(peerId, true)
    await a.pause(id, true)
    const count = 24
    const samples = Array.from({ length: count }, (_, i) => ({
      path: `${s.root}/sample-${i}.md`,
      text: `Synthetic content ${i}:` + String(i).repeat(8192),
    }))
    // Both devices already have the baseline; only these unique new bytes may transfer.
    if (phase === 'pull') for (const one of samples) await s.put(one.path, one.text)
    else
      a.run(
        `for(const one of ${JSON.stringify(samples)})await app.vault.create(one.path,one.text);return true`
      )
    expect(s.server.httpTrace).toBeTypeOf('function')
    const before = s.server.httpTrace!().length
    a.run(`
    const runtime=host.live.get(${JSON.stringify(id)}), original=runtime.options.fetch;
    const phase=${JSON.stringify(phase)};
    window.__reindexProbe={reached:false,restore:()=>{runtime.options.fetch=original}};
    runtime.options.fetch=async(input,init)=>{
      const url=String(input instanceof Request?input.url:input);
      const match=phase==='upload'?init?.method==='PUT'&&url.includes('/v2/uploads/'):url.includes('/content');
      if(match&&!window.__reindexProbe.reached){
        window.__reindexProbe.reached=true;
        // Hold the active transfer until the settings click reloads this window.
        await new Promise(resolve=>{const timer=setTimeout(resolve,30000);window.__reindexProbe.release=()=>{clearTimeout(timer);resolve()}});
      }
      return original(input,init);
    };
    void svc.pause(${JSON.stringify(id)},false).catch(error=>console.debug('reindex interrupted cycle',error));
    return true`)
    try {
      await a.long(
        'wait for real transfer',
        `await poll(()=>window.__reindexProbe.reached);return true`
      )
      const started = a.run<number>(`return performance.timeOrigin`)
      a.run(`
      await app.setting.open();await app.setting.openTabById('file');
      let button;await poll(()=>{
        const rows=[...app.setting.activeTab.containerEl.querySelectorAll('.setting-item')].filter(el=>/^Rebuild vault cache$/i.test(el.querySelector('.setting-item-name')?.textContent?.trim()||''));
        button=rows.length===1&&rows[0].querySelector('button');return button;
      },undefined,'unique Rebuild vault cache setting');
      setTimeout(()=>button.click(),100);return true`)
      await waitFor(
        'cache rebuild reload',
        () => {
          try {
            return a.run<number>('return performance.timeOrigin') !== started
          } catch {
            return false
          }
        },
        90000
      )
      await a.waitIdle()
      await b.pause(peerId, false)
      await s.cycle()
      // Count real server requests before the oracle itself reads server contents.
      const requests = s.server.httpTrace!()
        .slice(before)
        .filter((one) => one.event === 'arrival')
      const uploads = requests.filter(
        (one) => one.method === 'PUT' && one.route === '/v2/uploads/:id'
      ).length
      const downloads = requests.filter(
        (one) => one.method === 'GET' && one.route === '/v2/files/:id/content'
      ).length
      expect(uploads).toBe(phase === 'upload' ? count : 0)
      expect(downloads).toBe(phase === 'upload' ? count : count * 2)
      const items = (await s.items()).filter((one) => one.kind !== 'directory')
      expect(items).toHaveLength(count + 1)
      const expected = [...samples, stable]
      for (const device of [a, b])
        expect(
          device.run<string[]>(
            `return app.vault.getFiles().filter(one=>one.path.startsWith(${JSON.stringify(s.root + '/')})).map(one=>one.path).sort()`
          )
        ).toEqual(expected.map((one) => one.path).sort())
      for (const one of expected) {
        expect(a.read(one.path)).toBe(one.text)
        expect(b.read(one.path)).toBe(one.text)
        const item = items.find((item) => item.path === one.path)!
        expect(new TextDecoder().decode(await s.client().getBlob(item.sha!))).toBe(one.text)
      }
      console.info('reindex qualification', {
        phase,
        files: count,
        uploads,
        downloads,
        mismatches: 0,
      })
    } finally {
      a.run(
        `window.__reindexProbe?.release?.();window.__reindexProbe?.restore?.();return true`,
        true
      )
    }
  },
  300000
)
