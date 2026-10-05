import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { driver } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'
import { manualKeyConsentProbe } from '../helpers/manualKeyConsentProbe'
import { stagedNativeControl } from '../helpers/stagedNativeControl'
import { nativeControlFrame } from '../helpers/nativeControlFrame'

targets('desktop', 'phone')
const shots = shotDir('abele-manual-key-consent')
const available = isObsidianRunning() && hasTestApi()

interface Control {
  id: number
  label: string
  kind: 'editable' | 'noneditable' | 'sizing-copy'
}

const modes = onPhone() ? ['physical'] : ['desktop', 'emulated']

describe.skipIf(!available).each(modes)(
  'native manual key consent with mock transport: %s',
  (mode) => {
    it('saves a protected key, approves just its recipient and retries the unchanged literal script', async () => {
      const physical = onPhone()
      let desktopSize: [number, number] | undefined
      if (mode === 'emulated') {
        desktopSize = evalJson<[number, number]>(
          `require('@electron/remote').getCurrentWindow().getContentSize()`
        )
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
      }
      const token = 'sample-consent-' + Date.now()
      const deadline = Date.now() + 90_000
      const allowance = () => {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error('Sample consent probe exceeded its existing allowance')
        return Math.min(15_000, remaining)
      }
      const code = (action: string) => `(() => {
      const s=window.__sampleManualConsent
      if(!s||s.token!==${JSON.stringify(token)})throw Error('Sample consent owner mismatch')
      return (async()=>JSON.stringify(await ${action}))()
    })()`
      const invoke = async (action: string) => JSON.parse(await evalLong(code(action), allowance()))
      let report: Record<string, any> | undefined
      let failure: unknown
      let cleanup: Record<string, boolean | number> | undefined
      try {
        const controls = JSON.parse(
          await evalLong(manualKeyConsentProbe(shots, token, physical), allowance())
        ) as Control[]
        const identity = await invoke('s.identity()')
        const build = physical ? (process.env.ABELE_PHONE_BUILD ?? 'build') : 'build'
        for (const asset of identity.assets) {
          let path = join(build, asset.name)
          if (asset.name === 'styles.css' && !existsSync(path)) path = join(build, 'main.css')
          if (asset.name === 'manifest.json' && !existsSync(path)) path = '../manifest.json'
          expect(asset.sha256, asset.name).toBe(
            createHash('sha256').update(readFileSync(path)).digest('hex')
          )
        }
        console.info('manual consent installed development identity', JSON.stringify(identity))
        const status = physical ? JSON.parse(driver(['status'])) : null
        const screen = status?.screen ?? status?.driver?.screen
        const nativeFrame = physical ? nativeControlFrame(screen) : null
        for (const control of controls) {
          let geometry
          if (physical && control.kind === 'editable') {
            geometry = await stagedNativeControl({
              prepare: async () => invoke(`s.prepare(${control.id})`),
              tap: async (point) =>
                JSON.parse(driver(['tap', String(point.x), String(point.y)], allowance())),
              measure: async (point, acknowledgment) => {
                const measured = await invoke(`s.measure(${control.id},${acknowledgment.ok})`)
                return { ...measured, before: point, nativeFrame }
              },
            })
            expect(geometry.initialTarget, control.label).toBe(true)
            expect(geometry.trustedFocus, control.label).toBe(true)
            expect(geometry.keyboard, control.label).toBeGreaterThan(0)
            geometry.shot = await invoke(
              `s.shot(${JSON.stringify('focus-' + control.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))})`
            )
          } else {
            await invoke(`s.prepare(${control.id})`)
            geometry = await invoke(`s.measure(${control.id},false)`)
          }
          console.info('manual consent actual control geometry', JSON.stringify(geometry))
          await invoke(`s.blur(${control.id})`)
        }
        const formShot = await invoke(`s.shot('new-key-masked')`)
        await invoke('s.sequence()')
        const allowedShot = await invoke(`s.shot('recipient-allowed')`)
        report = await invoke('s.remove()')
        console.info(formShot, allowedShot)
      } catch (error) {
        failure = error
        throw error
      } finally {
        try {
          const raw = await evalLong(
            `(async()=>{
          const s=window.__sampleManualConsent
          return s?.token===${JSON.stringify(token)} ? await s.cleanup() : null
        })()`,
            30_000
          )
          cleanup = JSON.parse(raw)
          console.info('manual consent exact cleanup', JSON.stringify(cleanup))
        } catch (error) {
          if (failure) console.warn('Manual consent cleanup failed after primary error', error)
          else failure = error
        }
        if (desktopSize) {
          evalRaw(
            `require('@electron/remote').getCurrentWindow().setContentSize(${desktopSize[0]},${desktopSize[1]})`
          )
          await reloadApp('app.emulateMobile(false)')
        }
      }
      if (failure) throw failure
      expect(cleanup).not.toBeNull()
      for (const key of [
        'aiRestored',
        'localRestored',
        'keyRemoved',
        'modalClosed',
        'activeRestored',
        'layoutRestored',
        'windowRestored',
        'themeRestored',
        'panesRestored',
      ])
        expect(cleanup?.[key], key).toBe(true)
      expect(cleanup?.keyboard).toBe(0)
      expect(report?.blockedBefore).toBe(true)
      expect(report?.callsBefore).toBe(0)
      expect(report?.empty).toBe(true)
      expect(report?.masked).toBe(true)
      expect(report?.summary).toBe(true)
      expect(report?.secretAbsentFromText).toBe(true)
      expect(report?.outside).toEqual([])
      expect(report?.ringCuts).toEqual([])
      expect(report?.exactProtectedValue).toBe(true)
      expect(report?.pair).toEqual(['http://192.168.42.12:8123'])
      expect(report?.secretAbsentFromSettings).toBe(true)
      expect(report?.secretAbsentFromLocal).toBe(true)
      expect(report?.callsAfterConsent).toBe(0)
      expect(report?.literalUnchanged).toBe(true)
      expect(report?.retry).toBe(true)
      expect(report?.callsAfterRetry).toBe(1)
      expect(report?.blockedAfterRemoval).toBe(true)
      expect(report?.callsAfterRemoval).toBe(1)
    }, 120_000)
  }
)
