import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

function css(component: string) {
  const source = readFileSync(`src/components/github/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)?.[1] ?? '').css
}

it('sizes blame against its code pane rather than the window on desktop and phone', () => {
  const blame = css('GithubBlameRange')
  expect(blame).not.toMatch(/\b\d+vw\b/)
  for (const selector of ['.abele-github-blame', '.abele-github-blame-range']) {
    const rule = blame.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`))?.[1]
    expect(rule).toContain('35cqi')
  }
  expect(css('GithubCode')).toContain('container-type: inline-size')
})

it('reserves readable code width and scrolls long lines instead of wrapping under blame', () => {
  const code = css('GithubCode')
  const content = code.match(/:has\(\.abele-github-blame\) \.cm-content\s*\{([^}]+)\}/)?.[1]
  expect(content).toContain('min-width: 24ch')
  expect(content).toContain('white-space: pre')
  expect(content).toContain('overflow-wrap: normal')
})

it('gives find input the remaining column without reserving empty counter space', () => {
  const find = css('GithubFindBar')
  const bar = find.match(/\.abele-github-find\s*\{([^}]+)\}/)?.[1]
  expect(bar).toContain('grid-template-columns: minmax(0, 1fr) max-content max-content')
  const count = find.match(/\.abele-github-find__count\s*\{([^}]+)\}/)?.[1]
  expect(count).not.toContain('min-width: 5em')
  expect(count).toContain('white-space: nowrap')
})
