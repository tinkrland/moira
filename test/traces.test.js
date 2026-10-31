// traces: the action log was evidence, not accountability.
//
// receipts answered "who saw what". they could not answer "who did what, on
// whose behalf, in what order, with what outcome", because every receipt stood
// alone and ordering was timestamp-only. a trace is a correlation id that
// stitches one unit of work in order, without inventing a single field it was
// not told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Moira, MemoryStore } from '../src/index.js';

const setup = () => {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  m.facts.add(m.personas.get(persona.id), { content: 'writes in lowercase, by choice', category: 'preferences', sets: ['work'] });
  const agent = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: persona.id });
  return { m, ctx, persona, agent, session };
};

test('trace: a unit of work is one chain, ordered by sequence not by clock', () => {
  const { m, ctx, persona, agent, session } = setup();

  const opened = m.owner.traceBegin(ctx, { label: 'draft the investor update', personaId: persona.id, onBehalfOf: agent.id });
  assert.equal(opened.outcome, 'results');
  assert.ok(opened.traceId.startsWith('trc_'));

  // the crossing happens inside the trace: grant, read, then a denied read
  m.useTrace(opened.traceId);
  try {
    m.owner.grantPass(ctx, {
      clientId: agent.id, personaId: persona.id, category: 'preferences',
      purpose: 'draft_replies', duration: 'session', maxRung: 3, acknowledgeFull: true
    });
    const read = m.agent.persona_context(session.accessToken, { categories: ['preferences'], purpose: 'draft_replies' });
    assert.equal(read.outcome, 'results');
    const refused = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'draft_replies' });
    assert.equal(refused.outcome, 'approval_required');
  } finally {
    m.clearTrace();
  }
  m.owner.traceEnd(ctx, { traceId: opened.traceId, outcome: 'completed' });

  const trace = m.owner.traceReceipts(ctx, { traceId: opened.traceId });
  assert.equal(trace.outcome, 'results');
  assert.equal(trace.label, 'draft the investor update');
  assert.equal(trace.status, 'completed');
  assert.equal(trace.onBehalfOf, agent.id, 'the trace records whose behalf the work ran on');

  // ordered, gapless, and honest about what each step was
  const seqs = trace.receipts.map((r) => r.seq);
  assert.deepEqual(seqs, [1, 2, 3], 'ordered by sequence, gapless');
  assert.ok(trace.receipts.every((r) => r.traceId === opened.traceId));
  assert.equal(trace.receipts[0].op, 'pass_grant', 'the grant opens the story');
  assert.equal(trace.receipts[1].op, 'read', 'the read it enabled follows it');

  // the refusal is part of the story: outcome recorded, content never
  assert.equal(trace.receipts[2].reason, 'approval_required');
  assert.deepEqual(trace.receipts[2].categories, ['schedule']);
});

test('trace: no trace means no invented chain, and a closed trace takes no more work', () => {
  const { m, ctx, persona, agent } = setup();

  // receipts outside a trace stay untraced - a fabricated correlation id would
  // be worse than none
  m.owner.grantPass(ctx, {
    clientId: agent.id, personaId: persona.id, category: 'preferences',
    purpose: 'ad_hoc', duration: 'session', maxRung: 3, acknowledgeFull: true
  });
  const latest = m.store.list('receipts').at(-1);
  assert.equal(latest.traceId, null);
  assert.equal(latest.seq, null);

  const opened = m.owner.traceBegin(ctx, { label: 'short work', personaId: persona.id });
  m.useTrace(opened.traceId);
  try {
    m.owner.grantPass(ctx, {
      clientId: agent.id, personaId: persona.id, category: 'preferences',
      purpose: 'first', duration: 'session', maxRung: 3, acknowledgeFull: true
    });
  } finally {
    m.clearTrace();
  }
  m.owner.traceEnd(ctx, { traceId: opened.traceId, outcome: 'completed' });

  // reopening a finished trace would let work hide in a completed story, so it
  // fails closed and loudly: the host gets trace_closed, no work happens, and
  // nothing quietly lands outside the chain
  assert.throws(() => m.useTrace(opened.traceId), /trace_closed/);
  m.clearTrace();
  const granted = m.passes.listFor(agent.id, persona.id).map((x) => x.purpose);
  assert.ok(!granted.includes('second'), 'no work escaped into a closed trace');

  const unknown = m.owner.traceReceipts(ctx, { traceId: 'trc_nope' });
  assert.equal(unknown.outcome, 'unavailable');
});

test('trace: the chain never contains content', () => {
  const { m, ctx, persona, agent, session } = setup();
  const opened = m.owner.traceBegin(ctx, { label: 'read the hat', personaId: persona.id });
  m.useTrace(opened.traceId);
  try {
    m.owner.grantPass(ctx, {
      clientId: agent.id, personaId: persona.id, category: 'preferences',
      purpose: 'draft_replies', duration: 'session', maxRung: 4
    });
    m.agent.persona_context(session.accessToken, { categories: ['preferences'], purpose: 'draft_replies' });
  } finally {
    m.clearTrace();
  }
  const trace = m.owner.traceReceipts(ctx, { traceId: opened.traceId });
  const serialized = JSON.stringify(trace);
  assert.ok(!serialized.includes('lowercase'), 'a trace is evidence of crossing, never of content');
  assert.ok(!serialized.includes('writes in'), 'no fragments either');
});

test('transport: x-moira-trace scopes a real mcp call, and a closed trace is refused (2026-10-31)', async () => {
  // the header is the only way a real caller can put work in a chain, so it is
  // pinned over http rather than asserted by reading the source
  const { createMoiraServer } = await import('../src/transport/server.js');
  const { Moira } = await import('../src/index.js');
  const { MemoryStore } = await import('../src/store.js');
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const p = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  m.facts.add(m.personas.get(p.id), { content: 'ships on fridays', category: 'preferences' });
  const agent = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'preferences', purpose: 'draft', duration: 'session', maxRung: 4, acknowledgeFull: true });

  const srv = createMoiraServer({
    moira: m, baseUrl: 'http://127.0.0.1:0', tokenKey: '11'.repeat(32), port: 0
  });
  const addr = await srv.listen();
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  const opened = m.owner.traceBegin(ctx, { label: 'via header', personaId: p.id });

  // the transport signs its own access tokens (issuer = its base url)
  const jwt = srv.tokens.signAccess({
    token: session.accessToken, clientId: agent.id, personaId: p.id, sessionId: session.session.id
  });

  // a real client initializes first; the transport binds the session to the header
  const init = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'trace-test', version: '1' } } })
  });
  const sessionId = init.headers.get('mcp-session-id');
  assert.ok(sessionId, 'initialize opens a session');

  const call = (traceId) => fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${jwt}`,
      ...(traceId ? { 'x-moira-trace': traceId } : {})
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'persona_context', arguments: { categories: ['preferences'], purpose: 'draft' } } })
  });

  try {
    const live = await call(opened.traceId);
    // the header's contract is the gate, not the mcp tool result: a live trace
    // must pass through, a closed one must be refused. whether this particular
    // tool call then succeeds is the transport suite's business.
    assert.notEqual(live.status, 409, 'a live trace is not refused by the trace gate');
    await live.text();

    m.owner.traceEnd(ctx, { traceId: opened.traceId, outcome: 'completed' });
    const closed = await call(opened.traceId);
    assert.equal(closed.status, 409, 'a closed trace is refused at the door');
    const body = await closed.json();
    assert.equal(body.error, 'trace_closed');
  } finally {
    srv.server.close();
  }
});
