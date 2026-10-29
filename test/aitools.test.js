// ai tool declarations: the same anti-hallucination treatment as the stack,
// but for ai tools, where the primary axis is the JOB: for scraping you use
// firecrawl and querit, for search tavily, and no agent should guess.
// entries are per-persona, owner-stated (basis 'stated'), served structured
// and pass-gated. the job is required: an ai tool is always declared as "the
// tool i use FOR this job", mirroring the connector registry's job shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [founder.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: founder.id });
  return { m, ctx, founder, student, agentId, sess };
}

test('ai tools: declare a job with its tools in one call (firecrawl vs brightdata vs querit vs tavily)', () => {
  const { m, ctx, founder } = setup();

  const add = m.owner.aiAdd(ctx, {
    personaId: founder.id, job: 'scraping',
    tools: [{ tool: 'firecrawl' }, { tool: 'querit' }]
  });
  assert.equal(add.outcome, 'results');
  assert.equal(add.entries.length, 2);

  const list = m.owner.aiList(ctx, { personaId: founder.id });
  assert.equal(list.jobs.length, 1);
  assert.equal(list.jobs[0].job, 'scraping');
  assert.deepEqual(list.jobs[0].tools.map((t) => t.tool).sort(), ['firecrawl', 'querit']);

  // a competing provider joins the same job later, nothing is replaced
  const more = m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'tavily', uses: ['search'] }] });
  assert.equal(more.outcome, 'results');
  const list2 = m.owner.aiList(ctx, { personaId: founder.id });
  assert.equal(list2.jobs[0].tools.length, 3, 'the job accumulates providers');

  // a second job alongside
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'summarization', tools: [{ tool: 'claude' }] });
  assert.equal(m.owner.aiList(ctx, { personaId: founder.id }).jobs.length, 2);
});

test('ai tools: single-tool flow too, and uses union like the stack', () => {
  const { m, ctx, founder } = setup();

  const one = m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tool: 'firecrawl', uses: ['crawl'] });
  assert.equal(one.outcome, 'results');

  const two = m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tool: 'firecrawl', uses: ['extract'] });
  assert.deepEqual(two.entry.uses, ['crawl', 'extract'], 'uses union, never replace');

  // the same tool can serve two jobs: scraping tavily and search tavily are
  // two declarations, not a conflict
  const search = m.owner.aiAdd(ctx, { personaId: founder.id, job: 'search', tool: 'tavily' });
  assert.equal(search.outcome, 'results');
  const scrape = m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tool: 'tavily' });
  assert.equal(scrape.outcome, 'results');
  assert.equal(m.owner.aiList(ctx, { personaId: founder.id }).jobs.length, 2);
});

test('ai tools: job required, malformed input declines, batches are all-or-nothing', () => {
  const { m, ctx, founder } = setup();
  // no job: an ai tool is always "for this job"
  assert.equal(m.owner.aiAdd(ctx, { personaId: founder.id, tool: 'firecrawl' }).outcome, 'declined');
  assert.equal(m.owner.aiAdd(ctx, { personaId: founder.id, job: '', tools: [{ tool: 'x' }] }).outcome, 'declined');
  assert.equal(m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: ['firecrawl'] }).outcome, 'declined');
  // both shapes at once
  assert.equal(m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tool: 'a', tools: [] }).outcome, 'declined');
  // a bad entry in a batch declines the whole call, nothing half-applies
  const bad = m.owner.aiAdd(ctx, {
    personaId: founder.id, job: 'scraping',
    tools: [{ tool: 'firecrawl' }, { tool: '' }]
  });
  assert.equal(bad.outcome, 'declined');
  assert.equal(m.owner.aiList(ctx, { personaId: founder.id }).jobs.length, 0, 'all-or-nothing');
  assert.equal(m.owner.aiAdd(ctx, { personaId: 'psn_missing', job: 'scraping', tools: [{ tool: 'x' }] }).outcome, 'unavailable');
});

test('ai tools: per-persona isolation and frozen personas decline', () => {
  const { m, ctx, founder, student } = setup();
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'firecrawl' }] });
  m.owner.aiAdd(ctx, { personaId: student.id, job: 'scraping', tools: [{ tool: 'brightdata' }] });

  const f = m.owner.aiList(ctx, { personaId: founder.id });
  const s = m.owner.aiList(ctx, { personaId: student.id });
  assert.deepEqual(f.jobs[0].tools.map((t) => t.tool), ['firecrawl']);
  assert.deepEqual(s.jobs[0].tools.map((t) => t.tool), ['brightdata'], 'each hat picks its own scraper');

  m.owner.freezePersona(ctx, founder.id);
  assert.equal(m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'tavily' }] }).outcome, 'declined');
  m.owner.thawPersona(ctx, founder.id);
  assert.equal(m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'tavily' }] }).outcome, 'results');
});

test('ai tools: removal, a provider, a whole job, or single uses', () => {
  const { m, ctx, founder } = setup();
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tool: 'firecrawl', uses: ['crawl', 'extract'] });
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tool: 'tavily' });

  const use = m.owner.aiRemove(ctx, { personaId: founder.id, job: 'scraping', tool: 'firecrawl', uses: ['extract'] });
  assert.equal(use.outcome, 'results');
  assert.deepEqual(use.entry.uses, ['crawl']);

  const tool = m.owner.aiRemove(ctx, { personaId: founder.id, job: 'scraping', tool: 'firecrawl' });
  assert.equal(tool.outcome, 'results');
  const list = m.owner.aiList(ctx, { personaId: founder.id });
  assert.deepEqual(list.jobs[0].tools.map((t) => t.tool), ['tavily']);

  const job = m.owner.aiRemove(ctx, { personaId: founder.id, job: 'scraping' });
  assert.equal(job.outcome, 'results');
  assert.equal(m.owner.aiList(ctx, { personaId: founder.id }).jobs.length, 0);

  assert.equal(m.owner.aiRemove(ctx, { personaId: founder.id, job: 'scraping' }).outcome, 'unavailable');
});

test('ai tools: agents read them pass-gated, structured, never another persona\'s', () => {
  const { m, ctx, founder, student, agentId, sess } = setup();
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'firecrawl', uses: ['crawl'] }, { tool: 'querit' }] });
  m.owner.aiAdd(ctx, { personaId: student.id, job: 'scraping', tools: [{ tool: 'brightdata' }] });

  const denied = m.agent.ai_get(sess.accessToken, {});
  assert.equal(denied.outcome, 'approval_required', 'a pass is needed, like every read');

  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'ai', purpose: 'context', duration: 'permanent' , acknowledgeFull: true });
  const got = m.agent.ai_get(sess.accessToken, {});
  assert.equal(got.outcome, 'results');
  assert.equal(got.jobs.length, 1);
  assert.equal(got.jobs[0].job, 'scraping');
  assert.deepEqual(got.jobs[0].tools.map((t) => t.tool).sort(), ['firecrawl', 'querit']);
  assert.ok(!JSON.stringify(got).includes('brightdata'), 'the student hat\'s scraper never crosses over');

  const recs = m.receipts.query({ personaId: founder.id });
  assert.ok(recs.some((r) => r.op === 'read' && r.reason === 'ai_tools'), 'ai tool reads are audited');
});
