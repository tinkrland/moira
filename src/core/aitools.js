// ai tool declarations: the anti-hallucination layer for ai tools, where the
// primary axis is the JOB (mirroring the connector registry's shape). the
// owner declares, per persona, which tools they use for which job: for
// scraping firecrawl and querit, for search tavily. the job is always
// required because an ai tool is declared as "the tool i use FOR this job",
// never as a floating brand. competing providers under one job accumulate
// (firecrawl vs brightdata vs querit vs tavily is a valid full house), and
// the same tool may serve several jobs. entries are owner-stated
// (basis 'stated'), per-persona, served to agents structured and
// pass-gated.

import { randomId } from '../util/crypto.js';
import { OUTCOME, PERSONA_STATUS } from '../model/constants.js';

export class AIToolsService {
  constructor({ store, personas, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.receipts = receipts;
    this.now = now;
  }

  _list(personaId) {
    return this.store.list('aiToolEntries', (e) => e.personaId === personaId, { personaId });
  }

  _gate(personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    return null;
  }

  // two declaration flows, the owner's choice, both job-first:
  //   single tool: { job, tool, uses }
  //   job batch: { job, tools: [{ tool, uses }] }
  // re-declaring a (job, tool) unions uses; a batch is all-or-nothing.
  add(personaId, spec) {
    const gate = this._gate(personaId);
    if (gate) return gate;
    const job = typeof spec.job === 'string' ? spec.job.trim() : '';
    if (!job) return { outcome: OUTCOME.DECLINED, reason: 'job_required' };

    const hasTool = spec.tool !== undefined && spec.tool !== null;
    const hasTools = spec.tools !== undefined && spec.tools !== null;
    if (hasTool && hasTools) return { outcome: OUTCOME.DECLINED, reason: 'pick_one_flow' };
    if (!hasTool && !hasTools) return { outcome: OUTCOME.DECLINED, reason: 'tool_required' };

    if (hasTools) {
      if (!Array.isArray(spec.tools) || spec.tools.length === 0) {
        return { outcome: OUTCOME.DECLINED, reason: 'tools_required' };
      }
      if (!spec.tools.every((e) => e && typeof e === 'object' && typeof e.tool === 'string' && e.tool.trim() !== '')) {
        return { outcome: OUTCOME.DECLINED, reason: 'tools_entries_invalid' };
      }
      const results = [];
      for (const e of spec.tools) {
        const res = this._upsert(personaId, job, { tool: e.tool, uses: e.uses });
        if (res.outcome !== OUTCOME.RESULTS) return res; // all-or-nothing
        results.push(res.entry);
      }
      this.receipts.write({ actor: 'owner', personaId, op: 'read', reason: 'ai_tools_declared' });
      return { outcome: OUTCOME.RESULTS, entries: results };
    }
    const res = this._upsert(personaId, job, { tool: spec.tool, uses: spec.uses });
    if (res.outcome === OUTCOME.RESULTS) {
      this.receipts.write({ actor: 'owner', personaId, op: 'read', reason: 'ai_tools_declared' });
    }
    return res;
  }

  _upsert(personaId, job, { tool, uses }) {
    const t = typeof tool === 'string' ? tool.trim() : '';
    if (!t) return { outcome: OUTCOME.DECLINED, reason: 'tool_required' };
    if (uses !== undefined && uses !== null && (!Array.isArray(uses) || !uses.every((u) => typeof u === 'string' && u.trim() !== ''))) {
      return { outcome: OUTCOME.DECLINED, reason: 'uses_required' };
    }
    const given = Array.isArray(uses) ? uses : [];
    const existing = this._list(personaId).find((e) => e.job === job && e.tool.toLowerCase() === t.toLowerCase());
    if (existing) {
      const merged = [...new Set([...existing.uses, ...given.map((u) => u.trim())])].sort();
      this.store.update('aiToolEntries', existing.id, (e) => ({ ...e, uses: merged, updatedAt: this.now() }));
      return { outcome: OUTCOME.RESULTS, entry: { ...existing, uses: merged } };
    }
    const entry = {
      id: randomId('aitool'),
      personaId,
      job,
      tool: t,
      uses: [...new Set(given.map((u) => u.trim()))].sort(),
      basis: 'stated', // owner-stated, never inferred
      createdAt: this.now(),
      updatedAt: this.now()
    };
    this.store.put('aiToolEntries', entry.id, entry);
    return { outcome: OUTCOME.RESULTS, entry };
  }

  // remove a whole job, one tool, or single uses of a tool
  remove(personaId, { job, tool = null, uses = null }) {
    const gate = this._gate(personaId);
    if (gate) return gate;
    if (typeof job !== 'string' || job.trim() === '') {
      return { outcome: OUTCOME.DECLINED, reason: 'job_required' };
    }
    const j = job.trim();
    const inJob = this._list(personaId).filter((e) => e.job === j);
    if (inJob.length === 0) return { outcome: OUTCOME.UNAVAILABLE, reason: 'ai_job_not_found' };

    if (tool == null) {
      for (const e of inJob) this.store.del('aiToolEntries', e.id);
      return { outcome: OUTCOME.RESULTS, removed: 'job' };
    }
    const t = String(tool).trim().toLowerCase();
    const entry = inJob.find((e) => e.tool.toLowerCase() === t);
    if (!entry) return { outcome: OUTCOME.UNAVAILABLE, reason: 'ai_tool_not_found' };
    if (uses == null) {
      this.store.del('aiToolEntries', entry.id);
      return { outcome: OUTCOME.RESULTS, removed: 'tool' };
    }
    if (!Array.isArray(uses) || uses.length === 0) {
      return { outcome: OUTCOME.DECLINED, reason: 'uses_required' };
    }
    const drop = new Set(uses.map((u) => u.trim().toLowerCase()));
    const kept = entry.uses.filter((u) => !drop.has(u.toLowerCase())).sort();
    if (kept.length === 0) {
      this.store.del('aiToolEntries', entry.id);
      return { outcome: OUTCOME.RESULTS, removed: 'tool' };
    }
    this.store.update('aiToolEntries', entry.id, (e) => ({ ...e, uses: kept, updatedAt: this.now() }));
    return { outcome: OUTCOME.RESULTS, entry: { ...entry, uses: kept } };
  }

  // grouped by job: [{ job, tools: [{ tool, uses }] }]
  list(personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const byJob = new Map();
    for (const e of this._list(personaId)) {
      if (!byJob.has(e.job)) byJob.set(e.job, []);
      byJob.get(e.job).push({ tool: e.tool, uses: e.uses });
    }
    const jobs = [...byJob.entries()]
      .map(([job, tools]) => ({ job, tools: tools.sort((a, b) => a.tool.localeCompare(b.tool)) }))
      .sort((a, b) => a.job.localeCompare(b.job));
    return { outcome: OUTCOME.RESULTS, jobs };
  }
}
