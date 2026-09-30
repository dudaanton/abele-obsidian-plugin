import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
// Frozen pre-history stylesheet, built with its own locked dependencies. It supplies a
// theme-relative reference rather than a PNG tied to one font renderer, date, or theme.
const REFERENCE = '60cfabf4^'

export async function timelineStyleReference(): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', REFERENCE])
  const dir = resolve('node_modules/.cache/timeline-style-reference', stdout.trim() + '-production')
  const css = resolve(dir, 'plugin/build/main.css')
  if (existsSync(css)) return css
  mkdirSync(dir, { recursive: true })
  await exec('git', [
    '-C',
    resolve('..'),
    'archive',
    '--format=tar',
    '--output=' + resolve(dir, 'source.tar'),
    REFERENCE,
  ])
  await exec('tar', ['-xf', 'source.tar'], { cwd: dir })
  const cwd = resolve(dir, 'plugin')
  await exec('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd,
    timeout: 300000,
    maxBuffer: 1024 * 1024,
  })
  // Vitest sets NODE_ENV=test. Do not inherit that into Vite: normal build:test builds use
  // the production Vue compiler (with development plugin APIs), including source scope ids.
  await exec('npm', ['run', 'build:test'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 300000,
    maxBuffer: 1024 * 1024,
  })
  if (!readFileSync(css, 'utf8').includes('.abele-timeline__date-block'))
    throw new Error('The timeline style reference did not build')
  return css
}
