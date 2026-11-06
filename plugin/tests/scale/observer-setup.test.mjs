import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('qualification vault includes every observer module and config path', async () => {
  const observer = await readFile('plugin/tests/scale/observer.cjs', 'utf8')
  const driver = await readFile('plugin/tests/scale/run.mjs', 'utf8') +
    await readFile('plugin/tests/scale/observer-config.mjs', 'utf8')
  for (const [module, key] of [
    ['profile-only.cjs', 'profileOnly'],
    ['metadata-cache.cjs', 'metadataCache'],
    ['index-wait-capture.cjs', 'indexWaitCapture'],
  ]) {
    assert.match(observer, new RegExp(`config\\.${key}\\b`))
    assert.ok(driver.includes(`copyFile(join(here, '${module}'), join(observer, '${module}'))`), `${module} copied`)
    assert.ok(driver.includes(`${key}: join(observer, '${module}')`), `${key} configured`)
  }
})
