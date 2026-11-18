import { expect, it } from 'vitest'
import { layoutFixtureScript } from '../e2e/helpers/layoutFixtureScript'

it.each(['skill', 'prompt'])(
  'isolates composer %s choices from an interrupted earlier probe',
  (kind) => {
    const source = `Phone probe/probe-${kind}-`
    const old = layoutFixtureScript(source, 'sample-before')
    const current = layoutFixtureScript(source, 'sample-after')
    const query = layoutFixtureScript(`/probe-${kind}-`, 'sample-after').slice(1)
    const count = kind === 'skill' ? 12 : 8
    const files = [old, current].flatMap((prefix) =>
      Array.from({ length: count }, (_, i) => prefix + (i + 1) + '.md')
    )
    const choices = files.filter((path) => path.split('/').at(-1)!.startsWith(query))
    expect(choices).toHaveLength(count)
    expect(choices.every((path) => path.startsWith(current))).toBe(true)
  }
)
