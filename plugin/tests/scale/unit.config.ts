import base from '../../vitest.config'

// Replace the normal include list; merging arrays would run unrelated suites too.
export default {
  ...base,
  test: {
    ...base.test,
    // Parent projects carry their own includes and would bypass this scale-only list.
    projects: undefined,
    include: ['tests/harness/scale*.test.ts', 'tests/scale/**/*.test.ts'],
  },
}
