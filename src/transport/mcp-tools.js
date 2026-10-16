// the mcp tool manifest: the agent surface (agentapi) expressed as mcp tools.
//
// this file is the ONLY place where tool metadata lives. tool names are the
// agentapi method names verbatim, so a reviewer can diff the manifest against
// the facade mechanically. schemas are deliberately loose: the policy engine
// in core does the real validation and returns explicit outcomes; the schema
// exists for client-side ui and argument shaping.

const CAT = { type: 'string', description: 'preference category' };
const PURPOSE = { type: 'string', description: 'why this read/write happens (receipted)' };

export const MCP_TOOLS = [
  {
    name: 'moira_status',
    description: 'call first. persona id, budget known/unknown, active passes, inbox count. never reports unknown state as empty.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    method: 'moira_status'
  },
  {
    name: 'persona_context',
    description: 'read the persona\'s context by category at a rung permitted by passes and policy. explicit outcomes, never silent empty.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: { type: 'array', items: CAT, description: 'omit for all permitted categories' },
        purpose: PURPOSE,
        predicate: { type: 'string', description: 'optional narrow-by string evaluated by the policy engine' }
      },
      required: ['purpose']
    },
    method: 'persona_context'
  },
  {
    name: 'remember',
    description: 'write a fact for the persona. lands in the proposal inbox unless standing rules allow direct writes.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        category: CAT,
        basis: { type: 'string', description: 'basis label for the write' },
        derivedFrom: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        preferenceBasis: { type: 'string', description: 'required for preference categories (stated/inferred/chosen_freely/availability_driven)' },
        rungs: { type: 'object', description: 'rung ladder authored at write time, e.g. {summary, conclusion}' },
        policy: { type: 'object', description: 'taint: linkability, allowedPurposes, etc.' },
        inferred: { type: 'boolean' }
      },
      required: ['content', 'category']
    },
    method: 'remember'
  },
  {
    name: 'forget',
    description: 'request deletion of a fact by id.',
    inputSchema: {
      type: 'object',
      properties: { factId: { type: 'string' } },
      required: ['factId']
    },
    method: 'forget'
  },
  {
    name: 'bridge_request',
    description: 'read across a two-sided persona bridge at a permitted rung, with egress transforms and privacy budget.',
    inputSchema: {
      type: 'object',
      properties: {
        srcPersonaId: { type: 'string' },
        query: { type: ['string', 'null'], description: 'optional filter' },
        purpose: PURPOSE,
        maxRung: { type: ['integer', 'null'] }
      },
      required: ['srcPersonaId', 'purpose']
    },
    method: 'bridge_request'
  },
  {
    name: 'bridge_list',
    description: 'list the persona\'s outgoing bridges.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    method: 'bridge_list'
  },
  {
    name: 'bridge_revoke',
    description: 'revoke a bridge by id.',
    inputSchema: {
      type: 'object',
      properties: { bridgeId: { type: 'string' } },
      required: ['bridgeId']
    },
    method: 'bridge_revoke'
  },
  {
    name: 'bridge_keep',
    description: 'keep an item brought across a bridge into the destination persona.',
    inputSchema: {
      type: 'object',
      properties: { item: { type: 'object' } },
      required: ['item']
    },
    method: 'bridge_keep'
  },
  {
    name: 'workspace_append',
    description: 'append an entry to the shared agent workspace journal.',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'object' },
        taskId: { type: 'string' }
      },
      required: ['entry']
    },
    method: 'workspace_append'
  },
  {
    name: 'workspace_read',
    description: 'read the workspace journal, newest first.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, limit: { type: 'integer' } }
    },
    method: 'workspace_read'
  },
  {
    name: 'budget_status',
    description: 'the persona\'s resource accounts with headroom per unit. unknown budget is reported as unknown, never as unlimited.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    method: 'budget_status'
  },
  {
    name: 'budget_route',
    description: 'rank accounts eligible for a task and mint a lease for the best. returns approval_required/unknown_budget when the owner has not set limits.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'object', description: 'requirements, e.g. { models: [...] }' },
        constraints: { type: 'object', description: 'e.g. { estimatedCost, taskCap }' }
      },
      required: ['task']
    },
    method: 'budget_route'
  },
  {
    name: 'lease_request',
    description: 'request a provider lease against a specific account, capped.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        maxSpend: { type: 'number' },
        ttlMs: { type: 'integer' },
        models: { type: 'array', items: { type: 'string' } }
      },
      required: ['accountId', 'maxSpend', 'ttlMs']
    },
    method: 'lease_request'
  },
  {
    name: 'lease_revoke',
    description: 'revoke a lease by id.',
    inputSchema: {
      type: 'object',
      properties: { leaseId: { type: 'string' } },
      required: ['leaseId']
    },
    method: 'lease_revoke'
  },
  {
    name: 'ledger_propose',
    description: 'propose a resource account (owner approves via the proposal flow). secrets are sealed.',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'object', description: 'provider, kind, limits, expiresAt, capabilities, secret' } },
      required: ['account']
    },
    method: 'ledger_propose'
  },
  {
    name: 'context_pack_create',
    description: 'create a signed, expiring context pack bound to one recipient agent. no_reshare only in the mvp.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientAgentId: { type: 'string' },
        brief: { type: 'string' },
        factSelections: { type: 'array', items: { type: 'object' } },
        ttlMs: { type: 'integer' },
        reshare: { type: 'string' },
        voiceAttachment: { type: 'object' }
      },
      required: ['recipientAgentId', 'brief', 'factSelections', 'ttlMs']
    },
    method: 'context_pack_create'
  },
  {
    name: 'context_pack_redeem',
    description: 'redeem a context pack issued to this agent.',
    inputSchema: {
      type: 'object',
      properties: { packId: { type: 'string' } },
      required: ['packId']
    },
    method: 'context_pack_redeem'
  },
  {
    name: 'handoff_create',
    description: 'hand a task to another agent: pack, budget, return contract, ttl.',
    inputSchema: {
      type: 'object',
      properties: {
        toAgentId: { type: 'string' },
        packId: { type: 'string' },
        task: { type: 'object' },
        budget: { type: 'object' },
        returnContract: { type: 'object' },
        ttlMs: { type: 'integer' }
      },
      required: ['toAgentId', 'packId', 'task', 'budget', 'returnContract', 'ttlMs']
    },
    method: 'handoff_create'
  },
  {
    name: 'handoff_accept',
    description: 'accept a handoff issued to this agent.',
    inputSchema: {
      type: 'object',
      properties: { handoffId: { type: 'string' } },
      required: ['handoffId']
    },
    method: 'handoff_accept'
  },
  {
    name: 'handoff_return',
    description: 'return a typed result from a handoff, with proposed writes and spend.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffId: { type: 'string' },
        answer: { type: 'object' },
        proposedWrites: { type: 'array', items: { type: 'object' } },
        spend: { type: 'number' }
      },
      required: ['handoffId', 'answer']
    },
    method: 'handoff_return'
  },
  {
    name: 'handoff_cancel',
    description: 'cancel a handoff this agent created.',
    inputSchema: {
      type: 'object',
      properties: { handoffId: { type: 'string' } },
      required: ['handoffId']
    },
    method: 'handoff_cancel'
  },
  {
    name: 'voice_get',
    description: 'the persona\'s voice profile: guidelines, ai-tells, registers.',
    inputSchema: {
      type: 'object',
      properties: { register: { type: ['string', 'null'] } }
    },
    method: 'voice_get'
  },
  {
    name: 'voice_check',
    description: 'check a draft against the persona\'s voice profile.',
    inputSchema: {
      type: 'object',
      properties: { draft: { type: 'string' }, register: { type: ['string', 'null'] } },
      required: ['draft']
    },
    method: 'voice_check'
  },
  {
    name: 'voice_feedback',
    description: 'submit a draft plus the owner-edited final text for voice learning.',
    inputSchema: {
      type: 'object',
      properties: { draft: { type: 'string' }, final: { type: 'string' } },
      required: ['draft', 'final']
    },
    method: 'voice_feedback'
  },
  {
    name: 'audit_receipts',
    description: 'the persona\'s own signed, content-free receipts.',
    inputSchema: {
      type: 'object',
      properties: { since: { type: ['integer', 'null'] }, op: { type: ['string', 'null'] } }
    },
    method: 'audit_receipts'
  },
  {
    name: 'requestPersonaSwitch',
    description: 'ask the owner to operate as another persona. nothing changes until they approve; approval mints a new session, it never mutates the current one',
    inputSchema: {
      type: 'object',
      properties: {
        toPersonaId: { type: 'string', description: 'target persona id' },
        purpose: { type: 'string', description: 'why the switch is needed, shown to the owner' }
      },
      required: ['toPersonaId']
    },
    method: 'requestPersonaSwitch'
  },
  {
    name: 'collectPersonaSwitch',
    description: 'collect the new session tokens after the owner approved a persona switch. one-time',
    inputSchema: {
      type: 'object',
      properties: { switchId: { type: 'string', description: 'switch id from requestPersonaSwitch' } },
      required: ['switchId']
    },
    method: 'collectPersonaSwitch'
  },
  {
    name: 'connector_list',
    description: 'list the context connectors this persona has connected. no credential material is ever returned.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    method: 'connector_list'
  },
  {
    name: 'connector_read',
    description: 'read through a connected context connector (files block first wave: google_drive, onedrive, dropbox, mega). requires a connector pass; every returned row is untrusted-tagged with source attribution.',
    inputSchema: {
      type: 'object',
      required: ['connectorId', 'operation', 'scope', 'purpose'],
      properties: {
        connectorId: { type: 'string', description: 'registry id, e.g. google_drive' },
        operation: { type: 'string', enum: ['list', 'read'] },
        params: { type: 'object', description: 'operation params, e.g. { folderId, fileId }' },
        scope: { type: 'string', enum: ['files.list', 'files.read'], description: 'pass scope required' },
        purpose: { type: 'string', description: 'what this read is for; must match the pass purpose' }
      },
      additionalProperties: false
    },
    method: 'connector_read'
  },
  {
    name: 'request_disclosure',
    description: 'request one-time, owner-approved delivery of protected fields to one exact https destination.',
    inputSchema: {
      type: 'object',
      properties: {
        fields: { type: 'array', items: { type: 'string' } },
        destination: { type: 'string' },
        purpose: PURPOSE
      },
      required: ['fields', 'destination', 'purpose']
    },
    method: 'request_disclosure'
  }
];

export function toolByName(name) {
  return MCP_TOOLS.find((t) => t.name === name) || null;
}
