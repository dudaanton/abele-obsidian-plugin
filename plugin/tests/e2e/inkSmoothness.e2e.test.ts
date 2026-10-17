import { describe, expect, it } from 'vitest'
import { strokePath } from '@/ink/stroke'
import { handwriting } from '../helpers/handwriting'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const shots = shotDir('ink-smoothness')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('shared ink geometry at screen and retina resolution', () => {
  it('captures the same sparse loop before and after on desktop and an emulated phone', () => {
    const path = strokePath(handwriting)
    const result = evalAsync<number>(
      `(async () => {
      const remote = require('@electron/remote')
      const web = remote.getCurrentWebContents(), cdp = web.debugger
      const owned = !cdp.isAttached()
      if (owned) cdp.attach('1.3')
      const panel = document.createElement('div')
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;color:black;padding:16px'
      document.body.append(panel)
      let count = 0
      try {
        for (const [name, width, height] of [['desktop',1024,768],['phone',390,844]]) {
          for (const dpr of [1,3]) {
            await cdp.sendCommand('Emulation.setDeviceMetricsOverride', {
              width,height,deviceScaleFactor:dpr,mobile:name==='phone'
            })
            panel.replaceChildren()
            for (const before of [true,false]) {
              const label = document.createElement('p')
              label.textContent = (before ? 'Before' : 'After') + ' · ' + name + ' · ' + dpr + '× DPR'
              panel.append(label)
              const canvas = document.createElement('canvas')
              canvas.width = 180*dpr; canvas.height = 160*dpr
              canvas.style.cssText = 'display:block;width:180px;height:160px'
              panel.append(canvas)
              const ctx = canvas.getContext('2d')
              ctx.scale(dpr,dpr)
              ctx.fillStyle = ctx.strokeStyle = '#1f1f1f'
              if (before) {
                // Constant pressure: round bands are exactly a round-joined polyline.
                const points = ${JSON.stringify(handwriting.points)}
                ctx.lineWidth = ${handwriting.size};ctx.lineCap = ctx.lineJoin = 'round'
                ctx.beginPath();ctx.moveTo(points[0],points[1])
                for(let i=3;i<points.length;i+=3)ctx.lineTo(points[i],points[i+1])
                ctx.stroke()
              } else ctx.fill(new Path2D(${JSON.stringify(path)}))
            }
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
            const image = await cdp.sendCommand('Page.captureScreenshot', {
              format:'png',captureBeyondViewport:false,fromSurface:true
            })
            const png = Buffer.from(image.data,'base64')
            if (png.readUInt32BE(16)!==width*dpr || png.readUInt32BE(20)!==height*dpr)
              throw Error('Screenshot did not preserve the requested device pixels')
            require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+name+'-'+dpr+'x.png', png)
            count++
          }
        }
        return JSON.stringify(count)
      } finally {
        panel.remove()
        await cdp.sendCommand('Emulation.clearDeviceMetricsOverride')
        if (owned) cdp.detach()
      }
    })()`,
      120_000
    )
    expect(result).toBe(4)
  }, 150_000)
})
