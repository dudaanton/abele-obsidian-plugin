import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

function css(component: string) {
  const source = readFileSync(`src/components/github/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)?.[1] ?? '').css
}

it('sizes blame to its author and date rather than reserving part of the pane', () => {
  const blame = css('GithubBlameRange')
  expect(blame).not.toMatch(/\b\d+vw\b/)
  for (const selector of ['.abele-github-blame', '.abele-github-blame-range']) {
    const rule = blame.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`))?.[1]
    expect(rule).toContain('width: max-content')
  }
  expect(blame).not.toContain('cqi')
  expect(blame).not.toContain('max-width: 45%')
  expect(css('GithubCode')).toContain('container-type: inline-size')
})

it('keeps code wrapping while blame is visible', () => {
  const code = css('GithubCode')
  const content = code.match(/:has\(\.abele-github-blame\) \.cm-content\s*\{([^}]+)\}/)?.[1]
  expect(content).toContain('min-width: 0')
  expect(content).toContain('white-space: pre-wrap')
  expect(content).toContain('overflow-wrap: anywhere')
})

it('lays out author and date intrinsically without percentage-width children', () => {
  const blame = css('GithubBlameRange')
  const label = blame.match(/\.abele-github-blame-range__open[^}]+__label\s*\{([^}]+)\}/)?.[1]
  expect(label).toContain('display: flex')
  expect(label).toContain('width: max-content')
  expect(blame).not.toContain('width: 100%')
  const date = blame.match(/\.is-mobile \.abele-github-blame-range__date\s*\{([^}]+)\}/)?.[1] ?? ''
  expect(date).not.toContain('display: none')
})

it('gives find input the remaining column without reserving empty counter space', () => {
  const find = css('GithubFindBar')
  const bar = find.match(/\.abele-github-find\s*\{([^}]+)\}/)?.[1]
  expect(bar).toContain('grid-template-columns: minmax(0, 1fr) max-content max-content')
  const count = find.match(/\.abele-github-find__count\s*\{([^}]+)\}/)?.[1]
  expect(count).not.toContain('min-width: 5em')
  expect(count).toContain('white-space: nowrap')
})
