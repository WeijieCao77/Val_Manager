import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checks, label, planShards, commandFor, runChecks, main } from './run-audit.mjs'

test('all checks occur exactly once across four nonempty deterministic shards', () => {
  const shards = planShards(checks, 4)
  assert.ok(shards.every(shard => shard.length > 0))
  assert.deepEqual(shards.flat().map(label).sort(), checks.map(label).sort())
  assert.equal(new Set(checks.map(label)).size, checks.length)
  assert.deepEqual(shards, planShards(checks, 4))
  assert.deepEqual(planShards(checks, 1), [checks])
  for (const check of checks) {
    assert.ok(existsSync(check.file), check.file)
    assert.ok(commandFor(check)[0])
  }
  const smoke = checks.filter(check => check.file === 'scripts/smoke.ts')
  assert.equal(smoke.length, 2)
  assert.deepEqual(smoke.map(check => check.env ?? {}), [{}, { RULESET: 'vct-2026' }])
})

test('bad shard arguments fail instead of silently running an empty audit', async () => {
  for (const shard of ['0/4', '5/4', '1/0', 'x/4', '1/9999']) {
    await assert.rejects(main(['--shard', shard]))
  }
  await assert.rejects(main(['--unknown']))
  await assert.rejects(main(['--report']))
})

test('runner preserves args/env, records timing and stops on a failing child', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-runner-'))
  try {
    const fixture = join(dir, 'fixture.mjs'), marker = join(dir, 'marker')
    writeFileSync(fixture, `import { writeFileSync } from 'node:fs';
      if (process.argv[2] === 'ok') {
        if (process.env.AUDIT_TEST_VALUE !== 'test value') process.exit(9);
      } else if (process.argv[2] === 'fail') process.exit(7);
      else writeFileSync(process.argv[2], 'should not run');`)
    const results = await runChecks([
      { runtime: 'node', file: fixture, args: ['ok'], env: { AUDIT_TEST_VALUE: 'test value' } },
      { runtime: 'node', file: fixture, args: ['fail'] },
      { runtime: 'node', file: fixture, args: [marker] },
    ])
    assert.deepEqual(results.map(result => result.code), [0, 7])
    assert.ok(results.every(result => result.seconds >= 0))
    assert.equal(existsSync(marker), false)
    const missing = await runChecks([{ runtime: 'node', file: join(dir, 'missing.mjs') }])
    assert.notEqual(missing[0].code, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
