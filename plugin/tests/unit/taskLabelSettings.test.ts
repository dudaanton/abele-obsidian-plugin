/**
 * The label property and the label colours are ordinary settings: they have defaults, they
 * survive a save and a load, and what comes in from a file is cleaned on the way in so a
 * hand-edited `data.json` cannot put a colour the kit has no class for on screen.
 */
import { describe, it, expect } from 'vitest'
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'

describe('task label settings', () => {
  it('defaults to the `labels` property and no colours', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings(undefined)

    expect(config.taskLabelProperty).toBe('labels')
    expect(config.taskLabelColors).toEqual([])
    expect(DEFAULT_SETTINGS.taskLabelProperty).toBe('labels')
  })

  it('survives a round trip through the settings file', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings({
      ...DEFAULT_SETTINGS,
      taskLabelProperty: 'tags',
      taskLabelColors: [{ value: 'work', color: 'blue' }],
    })

    const saved = config.exportSettings()
    config.applySettings(undefined)
    config.applySettings(saved)

    expect(config.taskLabelProperty).toBe('tags')
    expect(config.taskLabelColors).toEqual([{ value: 'work', color: 'blue' }])
  })

  it('drops colours it does not know and grey entries, which mean no colour', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings({
      ...DEFAULT_SETTINGS,
      taskLabelProperty: '  ',
      taskLabelColors: [
        { value: 'work', color: 'magenta' as never },
        { value: 'home', color: 'grey' },
        { value: '', color: 'red' },
        { value: 'gym', color: 'green' },
      ],
    })

    expect(config.taskLabelProperty).toBe('labels')
    expect(config.taskLabelColors).toEqual([{ value: 'gym', color: 'green' }])
  })
})
