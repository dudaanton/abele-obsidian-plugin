import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

it('fixture Git commands cannot alter a decoy pointed to by inherited hook variables', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'abele-git-isolation-'))
  const decoy = join(scratch, 'decoy')
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  )
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', scratch, ...args], { env: cleanEnv, encoding: 'utf8' }).trim()
  try {
    git('init', '-q', decoy)
    const decoyGit = (...args: string[]) =>
      execFileSync('git', ['-C', decoy, `--git-dir=${join(decoy, '.git')}`, ...args], {
        env: cleanEnv,
        encoding: 'utf8',
      }).trim()
    writeFileSync(join(decoy, 'sample.txt'), 'Decoy contents')
    decoyGit('add', '.')
    decoyGit(
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'feat: sample decoy'
    )
    const before = {
      head: decoyGit('rev-parse', 'HEAD'),
      tags: decoyGit('tag', '-l'),
      config: readFileSync(join(decoy, '.git/config')),
      index: readFileSync(join(decoy, '.git/index')),
      status: decoyGit('status', '--porcelain'),
    }
    const module = resolve('scripts/changelog-git.mjs')
    const worker = `
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { gitAt, gitEnvironment } from ${JSON.stringify(module)};
      import { generateChangelog } from ${JSON.stringify(resolve('scripts/changelog.mjs'))};
      const root = ${JSON.stringify(join(scratch, 'fixture'))};
      mkdirSync(root);
      if (Object.keys(gitEnvironment()).some(key => key.startsWith('GIT_'))) throw Error('inherited Git variable');
      gitAt(root, ['init', '-q']);
      gitAt(root, ['config', 'sample.fixture', 'true']);
      writeFileSync(root + '/sample.txt', 'Fixture contents');
      writeFileSync(root + '/manifest.json', '{"version":"1.0.0"}');
      writeFileSync(root + '/package.json', '{"version":"1.0.0"}');
      gitAt(root, ['add', '.']);
      gitAt(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'feat: fixture only']);
      gitAt(root, ['tag', '1.0.0']);
      if (gitAt(root, ['tag', '-l']) !== '1.0.0') throw Error('wrong repository');
      const releases = generateChangelog(root, { historical: [] });
      if (releases[0]?.features[0] !== 'Fixture only') throw Error('generator read decoy');
    `
    execFileSync(process.execPath, ['--input-type=module', '-e', worker], {
      cwd: scratch,
      env: {
        ...cleanEnv,
        GIT_DIR: join(decoy, '.git'),
        GIT_INDEX_FILE: join(decoy, '.git/index'),
        GIT_WORK_TREE: decoy,
        GIT_COMMON_DIR: join(decoy, '.git'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.bare',
        GIT_CONFIG_VALUE_0: 'true',
        GIT_TEST_UNKNOWN_CONTEXT: 'must be removed',
      },
    })
    expect(decoyGit('rev-parse', 'HEAD')).toBe(before.head)
    expect(decoyGit('tag', '-l')).toBe(before.tags)
    expect(readFileSync(join(decoy, '.git/config'))).toEqual(before.config)
    expect(readFileSync(join(decoy, '.git/index'))).toEqual(before.index)
    expect(decoyGit('status', '--porcelain')).toBe(before.status)
    expect(readFileSync(join(decoy, 'sample.txt'), 'utf8')).toBe('Decoy contents')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
