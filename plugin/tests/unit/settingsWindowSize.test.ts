/**
 * The size Obsidian's own settings window opens at on a desktop. Obsidian asks for 900×700
 * whatever the screen, which leaves a plugin's settings beside two sidebars in a narrow strip;
 * the plugin asks for more where the screen has it, and keeps the window on that screen.
 */
import { describe, it, expect } from 'vitest'
import { enlargeSettingsWindow, settingsWindowBounds } from '@/helpers/settingsWindowSize'

const OBSIDIAN = { width: 900, height: 700, minWidth: 600, minHeight: 400 }
const screen = (width: number, height: number, x = 0, y = 0) => ({ x, y, width, height })

describe('the settings window size', () => {
  it('opens at 1280×1000 on a screen that has room for it', () => {
    const b = settingsWindowBounds(OBSIDIAN, screen(1280, 800, 100, 100), screen(2560, 1320, 0, 30))

    expect([b.width, b.height]).toEqual([1280, 1000])
  })

  it('takes 90% of the width and 88% of the height of a smaller screen', () => {
    const b = settingsWindowBounds(OBSIDIAN, screen(1440, 875, 0, 25), screen(1440, 875, 0, 25))

    expect([b.width, b.height]).toEqual([1280, 770])
  })

  it('is never smaller than what Obsidian asked for while the screen holds that', () => {
    const b = settingsWindowBounds(OBSIDIAN, screen(1024, 700), screen(1024, 740))

    expect([b.width, b.height]).toEqual([921, 700])
  })

  it('is never larger than the screen it opens on', () => {
    const b = settingsWindowBounds(OBSIDIAN, screen(800, 600), screen(800, 600))

    expect([b.width, b.height]).toEqual([800, 600])
    expect([b.x, b.y]).toEqual([0, 0])
  })

  it('stands centred over the main window', () => {
    const b = settingsWindowBounds(
      OBSIDIAN,
      screen(1600, 1100, 400, 100),
      screen(2560, 1320, 0, 30)
    )

    expect([b.x, b.y]).toEqual([560, 150])
  })

  it('is moved back onto the screen when centring would push it past an edge', () => {
    const b = settingsWindowBounds(
      OBSIDIAN,
      screen(1024, 700, 1500, 600),
      screen(2560, 1320, 0, 30)
    )

    expect(b.x + b.width).toBe(2560)
    expect(b.y + b.height).toBe(1350)
    const left = settingsWindowBounds(
      OBSIDIAN,
      screen(600, 400, -200, 0),
      screen(2560, 1320, 0, 30)
    )
    expect([left.x, left.y]).toEqual([0, 30])
  })

  it('keeps the minimum size Obsidian set', () => {
    const b = settingsWindowBounds(OBSIDIAN, screen(1280, 800), screen(2560, 1320))

    expect([b.minWidth, b.minHeight]).toEqual([600, 400])
  })
})

describe('asking Obsidian for it', () => {
  class Setting {
    getPopoutOptions() {
      return { ...OBSIDIAN }
    }
  }
  const win = {
    screenX: 100,
    screenY: 100,
    outerWidth: 1280,
    outerHeight: 800,
    screen: { availLeft: 0, availTop: 30, availWidth: 2560, availHeight: 1320 },
  }

  it('replaces the size Obsidian asks for, and gives its own back when undone', () => {
    const setting = new Setting()
    const undo = enlargeSettingsWindow(setting, win)

    expect(setting.getPopoutOptions()).toMatchObject({ width: 1280, height: 1000, minWidth: 600 })
    undo()
    expect(setting.getPopoutOptions()).toEqual(OBSIDIAN)
    expect(Object.prototype.hasOwnProperty.call(setting, 'getPopoutOptions')).toBe(false)
  })

  it('leaves an Obsidian without a settings window alone', () => {
    const setting = {}
    const undo = enlargeSettingsWindow(setting, win)

    expect(setting).toEqual({})
    undo()
    expect(setting).toEqual({})
  })
})
