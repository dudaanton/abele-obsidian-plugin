import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/** Hooks export repository context. Strip ALL Git variables, including config overrides,
 * before spawning a child; explicit -C plus cwd binds it to its intended repository. */
export function gitEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
}

export function gitAt(root, args, options = {}) {
  return execFileSync('git', ['-C', resolve(root), ...args], {
    cwd: resolve(root),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
    env: gitEnvironment(),
  }).trim()
}
