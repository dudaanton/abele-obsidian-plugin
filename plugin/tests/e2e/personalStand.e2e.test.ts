import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { encodePayload, newTransferCode } from '../../src/transfer/payload'
import { newTransferId, toText } from '../../src/transfer/frames'
import { vaultCli } from './helpers/obsidianCli'

/** Explicitly selected live stand supplement; never an offline/iPad substitute. */
describe('personal stand supplement', () => {
  it('sets up or restores only the owned personal fixture', async () => {
    const name = process.env.OBSIDIAN_TEST_VAULT
    if (!name) throw new Error('Stand supplement requires an exclusively leased pool vault')
    const cli = vaultCli(name),
      stage = process.env.ABELE_STAND_STAGE
    if (stage === 'restore') {
      const result = cli.evalAwait<any>(`(async () => {
        const p = window.__personalStandProbe; if (!p) throw new Error('No owned restore state')
        const ledger = app.loadLocalStorage('abele-sync-ledger'), trust = app.loadLocalStorage('abele-script-provenance')
        const svc = window.__abeleTest.SyncService.getInstance(); await svc.forget()
        if (p.sibling) await svc.revokeTransferred(p.sibling, p.sibling.token)
        if (await app.vault.adapter.exists(p.root)) {
          const folder = app.vault.getAbstractFileByPath(p.root); if (folder) await app.vault.delete(folder, true)
        }
        for (const [key,value] of Object.entries(p.local)) app.saveLocalStorage(key,value)
        if (p.ignore === null) { if(await app.vault.adapter.exists('.abele-sync-ignore')) await app.vault.adapter.remove('.abele-sync-ignore') }
        else await app.vault.adapter.write('.abele-sync-ignore',p.ignore)
        if(p.marker === null) { if(await app.vault.adapter.exists('.abele-script-managed')) await app.vault.adapter.remove('.abele-script-managed') }
        else await app.vault.adapter.writeBinary('.abele-script-managed',new Uint8Array(p.marker).buffer)
        for (const name of [!p.local['abele-sync-ledger'] && ledger?.stateId ? 'abele-sync-' + ledger.stateId : null, !p.local['abele-script-provenance'] && trust?.id ? 'abele-script-provenance-' + trust.id : null].filter(Boolean)) {
          await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Owned fixture database remained open'))})
        }
        const out = { disconnected: !svc.connection.value.vaultId, folderGone: !await app.vault.adapter.exists(p.root) }
        delete window.__personalStandProbe; return out
      })()`)
      expect(result).toEqual({ disconnected: true, folderGone: true })
      return
    }
    if (stage === 'verify') {
      const result = cli.evalAwait<any>(`(async () => {
        const p = window.__personalStandProbe, svc = window.__abeleTest.SyncService.getInstance()
        if (!p) throw new Error('No owned stand fixture')
        const root = p.root + '/Verify-' + Date.now(); p.verifyRoot = root
        await app.vault.createFolder(root)
        await app.vault.create(root + '/online.md','Online sample')
        await app.vault.createBinary(root + '/sample.bin',new Uint8Array([0,255,128]).buffer)
        await svc.syncNow()
        await app.vault.rename(app.vault.getAbstractFileByPath(root + '/online.md'),root + '/renamed.md')
        await svc.syncNow()
        const page = await svc.client().manifest(null)
        const renamed = page.items.find(i=>i.path===root + '/renamed.md')
        await app.vault.createFolder(root + '/DeleteBurst')
        for(let i=0;i<60;i++) await app.vault.create(root + '/DeleteBurst/sample-' + i + '.md','sample ' + i)
        await svc.syncNow()
        if(svc.connection.value.paused) throw new Error('Delete burst must be unpaused')
        await app.vault.delete(app.vault.getAbstractFileByPath(root + '/DeleteBurst'),true)
        await svc.syncNow()
        const held = (await svc.heldDeletes()).filter(f=>f.path.startsWith(root + '/DeleteBurst/'))
        if(held.length!==60) throw new Error('Expected exact owned 60-file delete hold, got ' + held.length)
        await svc.decideDeletes('restore',held.map(f=>f.fileId)); await svc.syncNow()
        const restored = (await svc.client().manifest(null)).items.filter(i=>i.path.startsWith(root + '/DeleteBurst/')).length
        svc.pause()
        const client = svc.client(), commit = client.commitRaw.bind(client)
        client.commitRaw = async(ops,key)=>{ await commit(ops,key); throw new Error('Synthetic successful response lost') }
        await app.vault.create(root + '/lost-response.md','Committed once on stand')
        svc.resume()
        return { renamed: !!renamed, held: held.length, restored }
      })()`)
      expect(result).toEqual({ renamed: true, held: 60, restored: 60 })
      // Wait on actual error/journal progress, never count a sleep as replay evidence.
      for (let i = 0; i < 80; i++) {
        if (
          ['error', 'offline'].includes(
            cli.evalAwait<string>('window.__abeleTest.SyncService.getInstance().status.value.state')
          )
        )
          break
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(
        cli.evalAwait<string>('window.__abeleTest.SyncService.getInstance().status.value.state')
      ).toMatch(/^(error|offline)$/)
      const before = cli.evalAwait<any>(
        'window.__abeleTest.SyncService.getInstance().client().state()'
      )
      cli.run(['plugin:reload', 'id=abele'])
      for (let i = 0; i < 80; i++) {
        if (
          cli.evalAwait<string>(
            'window.__abeleTest.SyncService.getInstance().status.value.state'
          ) === 'idle'
        )
          break
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(
        cli.evalAwait<string>('window.__abeleTest.SyncService.getInstance().status.value.state')
      ).toBe('idle')
      expect(
        cli.evalAwait<string[]>('window.__abeleTest.SyncService.getInstance().log.value')
      ).toEqual(expect.arrayContaining([expect.stringContaining('push: replaying')]))
      const after = cli.evalAwait<any>(
        'window.__abeleTest.SyncService.getInstance().client().state()'
      )
      expect(after.head_seq).toBe(before.head_seq)
      expect(
        cli.evalAwait<string>(
          "app.vault.adapter.read(window.__personalStandProbe.verifyRoot + '/lost-response.md')"
        )
      ).toBe('Committed once on stand')
      return
    }
    if (stage !== 'setup') throw new Error('Explicit setup/verify/restore stage is required')
    const url = process.env.ABELE_STAND_URL,
      email = process.env.ABELE_STAND_EMAIL,
      password = process.env.ABELE_STAND_PASSWORD
    const vaultId = process.env.ABELE_STAND_VAULT,
      root = process.env.ABELE_STAND_NAMESPACE,
      transfer = process.env.ABELE_STAND_TRANSFER
    if (!url || !email || !password || !vaultId || !root || !transfer)
      throw new Error('Missing authorized stand inputs')
    // Account password never appears in a report/file; only the encrypted sibling transfer travels.
    const sibling = cli.evalAwait<any>(`(async () => {
      const svc = window.__abeleTest.SyncService.getInstance()
      if(svc.connection.value.vaultId) throw new Error('Existing fixture connection left untouched')
      const keys = ['abele-sync-connection','abele-sync-ledger','abele-sync-ledger-proof','abele-sync-ledger-bootstrap','abele-script-provenance']
      const p = { root: ${JSON.stringify(root)}, local: Object.fromEntries(keys.map(k=>[k,app.loadLocalStorage(k)])),
        ignore: await app.vault.adapter.exists('.abele-sync-ignore') ? await app.vault.adapter.read('.abele-sync-ignore') : null,
        marker: await app.vault.adapter.exists('.abele-script-managed') ? [...new Uint8Array(await app.vault.adapter.readBinary('.abele-script-managed'))] : null }
      if(await app.vault.adapter.exists(p.root)) throw new Error('Owned namespace collision')
      window.__personalStandProbe = p
      await app.vault.createFolder(p.root)
      await app.vault.adapter.write('.abele-sync-ignore','*\\n!' + p.root + '/\\n!' + p.root + '/**\\n')
      await app.vault.create(p.root + '/sample.md','Personal stand sample')
      const vaults = await svc.connect(${JSON.stringify(url)},${JSON.stringify(email)},${JSON.stringify(password)})
      if(!vaults.some(v=>v.id===${JSON.stringify(vaultId)})) throw new Error('Authorized vault absent')
      await svc.chooseVault(${JSON.stringify(vaultId)},'Sample desktop probe',null)
      await svc.syncNow()
      p.sibling = await svc.enrolSibling('Sample phone probe')
      return { ...p.sibling, selective: svc.connection.value.selective }
    })()`)
    const { token, selective, ...connection } = sibling
    const { maxFileBytes: _deviceCap, ...shared } = selective
    const code = newTransferCode()
    const blob = await encodePayload(
      {
        v: 1,
        at: new Date().toISOString(),
        entries: [
          {
            section: 'connection',
            id: 'connection',
            label: 'Sync connection',
            data: { ...connection, selective: shared },
            secretIds: ['sync-connection-token'],
          },
        ],
        secrets: { 'sync-connection-token': token },
      },
      code
    )
    writeFileSync(transfer, JSON.stringify({ text: toText(blob, newTransferId()), code, root }), {
      mode: 0o600,
    })
    expect(
      cli.evalAwait<string>('window.__abeleTest.SyncService.getInstance().connection.value.vaultId')
    ).toBe(vaultId)
  })
})
