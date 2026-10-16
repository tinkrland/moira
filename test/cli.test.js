// the cli: the owner surface, scriptable. proves the same commands a human
// would run - create a persona, add a fact, promote it to the core - work
// end to end over a persistent FileStore, across separate processes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../cli.js', import.meta.url).pathname;

function cli(dir, args, extraEnv = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOIRA_STATE: join(dir, 'state.json'),
      MOIRA_INSTANCE_KEY: 'a'.repeat(64),
      ...extraEnv
    }
  });
}

test('cli: help and the owner-confirmation gate', () => {
  const help = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /fact promote/);
  assert.match(help.stdout, /switch approve/);

  // without the owner env var, acting as owner is refused - even locally
  const dir = mkdtempSync(join(tmpdir(), 'moira-cli-'));
  const refused = cli(dir, ['core', 'list'], { MOIRA_OWNER_CONFIRMED: '' });
  assert.equal(refused.status, 1);
  const body = JSON.parse(refused.stderr);
  assert.equal(body.reason, 'owner_not_confirmed');
  rmSync(dir, { recursive: true, force: true });
});

test('cli: end-to-end over the file store - persona, fact, promote, core list, demote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moira-cli-'));
  try {
    const env = { MOIRA_OWNER_CONFIRMED: '1' };

    // create a persona
    const created = cli(dir, ['persona', 'create', '--name', 'student', '--identity', 'linked'], env);
    assert.equal(created.status, 0, created.stderr);
    const persona = JSON.parse(created.stdout);
    assert.equal(persona.outcome, 'results');
    const personaId = persona.id;

    // state persisted across processes
    const personas = cli(dir, ['personas', 'list'], env);
    assert.equal(JSON.parse(personas.stdout).personas.length, 1);

    // add a fact
    const added = cli(dir, ['fact', 'add', '--persona', personaId, '--content', 'builds moira', '--category', 'projects'], env);
    assert.equal(added.status, 0, added.stderr);
    const factId = JSON.parse(added.stdout).factId;

    // promote it to the core
    const promoted = cli(dir, ['fact', 'promote', '--id', factId], env);
    assert.equal(promoted.status, 0, promoted.stderr);
    assert.equal(JSON.parse(promoted.stdout).outcome, 'results');

    // the core lists it
    const coreList = cli(dir, ['core', 'list'], env);
    const core = JSON.parse(coreList.stdout);
    assert.equal(core.outcome, 'results');
    assert.equal(core.facts.length, 1);
    assert.equal(core.facts[0].movedFrom, personaId);

    // demote it into a second persona
    const alias = cli(dir, ['persona', 'create', '--name', 'alias', '--identity', 'pseudonymous'], env);
    const aliasId = JSON.parse(alias.stdout).id;
    const demoted = cli(dir, ['fact', 'demote', '--id', core.facts[0].id, '--to', aliasId], env);
    assert.equal(demoted.status, 0, demoted.stderr);
    assert.equal(JSON.parse(demoted.stdout).outcome, 'results');

    // the core is empty again
    const after = cli(dir, ['core', 'list'], env);
    assert.equal(JSON.parse(after.stdout).facts.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: switch inbox is reachable and empty without any requests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moira-cli-'));
  try {
    const res = cli(dir, ['switch', 'list'], { MOIRA_OWNER_CONFIRMED: '1' });
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).switches.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: insforge env selects the insforge store, not the local file store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moira-cli-'));
  // a bogus url: with the insforge env honored the command must fail loudly
  // trying to reach it; if the env is ignored it silently uses the file store
  // and exits 0 with empty results.
  const out = cli(dir, ['personas', 'list'], {
    MOIRA_OWNER_CONFIRMED: '1',
    INSFORGE_URL: 'https://insforge.invalid.example',
    INSFORGE_ADMIN_KEY: 'ik_test'
  });
  assert.notEqual(out.status, 0, 'insforge env must not fall back to the file store');
  assert.match(out.stderr, /request failed|fetch failed/i, `expected a network failure against the configured url, got: ${out.stderr.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
});
