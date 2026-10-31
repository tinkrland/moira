// moira composition root (spec sections 6, 11).
//
// the gateway wires the core services and exposes exactly two facades:
//  - `moira.agent` (agentapi): the mcp tool surface. token in, one persona,
//    policy engine, receipts. no owner methods whatsoever.
//  - `moira.owner` (ownerapi): the owner surface. every method takes an
//    OwnerContext capability minted by createOwnerContext(verifiedOwnerSession).
//
// session lifecycle (refresh, connect-code redemption) stays here: it is the
// bootstrap layer phase 2 wires to oidc/device flows, not a tool surface.
//
// outcomes are explicit everywhere (results, empty, approval_required,
// declined, expired, locked, unavailable, not_available). a locked or
// unavailable store is never reported as "no memories"; unknown budget state
// is never "no limits".

import { MemoryStore } from '../store.js';
import { KeyService } from './keyservice.js';
import { ReceiptLedger } from './receipts.js';
import { PersonaService } from './personas.js';
import { FactService } from './facts.js';
import { AgentService, SessionService } from './agents.js';
import { PassService } from './passes.js';
import { BridgeService } from './bridges.js';
import { AccessRequestService } from './requests.js';
import { PackService } from './packs.js';
import { HandoffService } from './handoffs.js';
import { LedgerService } from './ledger.js';
import { RouterService } from './router.js';
import { LinkageService } from './linkage.js';
import { StackService } from './stack.js';
import { AIToolsService } from './aitools.js';
import { SetsService } from './sets.js';
import { randomId } from '../util/crypto.js';
import { SupabaseStore } from '../supabasestore.js';
import { InsForgeStore } from '../insforgestore.js';
import { AgentApi } from '../facades/agentapi.js';
import { OwnerApi } from '../facades/ownerapi.js';
import { OwnerContext, isValidOwnerSession } from '../facades/ownercontext.js';
import { OUTCOME } from '../model/constants.js';
import { ConnectorHub } from '../connectors/hub.js';
import { VaultService } from './vault.js';
import { SwitchService } from './switching.js';
import { CoreService } from './core.js';
import { DisclosureService } from './disclosures.js';
import { PeopleService } from './people.js';

function defaultStore() {
  if (process.env.INSFORGE_URL && process.env.INSFORGE_ADMIN_KEY) {
    return InsForgeStore.fromEnv();
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return SupabaseStore.fromEnv();
  }
  return new MemoryStore();
}

function loadInstanceKey() {
  // stable across restarts when set; hex of 32 bytes (openssl rand -hex 32).
  // required for persistent stores (see the constructor check).
  const hex = process.env.MOIRA_INSTANCE_KEY;
  if (!hex) return undefined;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error('MOIRA_INSTANCE_KEY must be hex of 32 bytes (openssl rand -hex 32)');
  return buf;
}

export class Moira {
  constructor({ store = defaultStore(), now = () => this._nowMs(), instanceKey = loadInstanceKey(), io = {} } = {}) {
    this.io = io; // injectable adapters/fetch; the core stays offline and deterministic
    // key safety: a persistent store without a stable instance key would wrap
    // every persona key under a key that changes per process, locking (or
    // silently re-keying) every vault after a restart. refuse to start.
    if (store?.persistent === true && instanceKey === undefined) {
      throw new Error(
        'persistent store (supabase) requires MOIRA_INSTANCE_KEY: generate one with `openssl rand -hex 32` ' +
        'and set it once per deployment; without it vaults cannot survive restarts'
      );
    }
    this.store = store;
    this._nowMs = () => Date.now();
    this.now = now;
    // keyStore: wrapped persona keys persist through the same store, so
    // vaults survive restarts on persistent deployments (supabase).
    this.keys = new KeyService({ instanceKey, keyStore: this.store, now });
    this.receipts = new ReceiptLedger({ store, keys: this.keys, now });
    this.personas = new PersonaService({ store, keys: this.keys, now });
    this.facts = new FactService({ store, keys: this.keys, personas: this.personas, now: () => this._nowMs() });
    this.agents = new AgentService({ store, receipts: this.receipts, now });
    this.sessions = new SessionService({ store, agents: this.agents, now });
    this.passes = new PassService({ store, agents: this.agents, receipts: this.receipts, now });
    this.people = new PeopleService({ store, personas: this.personas, receipts: this.receipts, now });
    this.disclosures = new DisclosureService({
      store, personas: this.personas, facts: this.facts, keys: this.keys, receipts: this.receipts, now
    });
    this.requests = new AccessRequestService({
      store, personas: this.personas, agents: this.agents, passes: this.passes, receipts: this.receipts, now
    });
    this.bridges = new BridgeService({ store, personas: this.personas, facts: this.facts, receipts: this.receipts, now });
    this.packs = new PackService({ store, personas: this.personas, facts: this.facts, receipts: this.receipts, keys: this.keys, now });
    this.ledger = new LedgerService({ store, personas: this.personas, keys: this.keys, receipts: this.receipts, now });
    this.linkage = new LinkageService({ store, personas: this.personas, ledger: this.ledger, keys: this.keys, now });
    this.stack = new StackService({ store, personas: this.personas, receipts: this.receipts, now });
    this.aitools = new AIToolsService({ store, personas: this.personas, receipts: this.receipts, now });
    this.sets = new SetsService({ store, personas: this.personas });
    this.router = new RouterService({ store, ledger: this.ledger, agents: this.agents, personas: this.personas, receipts: this.receipts, linkage: this.linkage, now });
    this.handoffs = new HandoffService({ store, personas: this.personas, agents: this.agents, packs: this.packs, receipts: this.receipts, router: this.router, facts: this.facts, now });

    // the two facades (spec section 6). there is no third surface.
    this.core = new CoreService({ store: this.store, keys: this.keys, personas: this.personas, facts: this.facts, receipts: this.receipts, now: () => this._nowMs() });
    this.switching = new SwitchService({ store: this.store, keys: this.keys, agents: this.agents, personas: this.personas, sessions: this.sessions, facts: this.facts, receipts: this.receipts, now: () => this._nowMs() });
    this.connectors = new ConnectorHub({ store: this.store, keys: this.keys, receipts: this.receipts, agents: this.agents, now: () => this._nowMs(), io });
    this.vault = new VaultService({ store: this.store, personas: this.personas, keys: this.keys, receipts: this.receipts, now: () => this._nowMs() });
    this.sets.vault = this.vault; // one set vocabulary spans declared context, facts and the vault
    this.agent = new AgentApi(this);
    this.owner = new OwnerApi(this);
  }

  // the ONLY place owner authority is minted. `verifiedOwnerSession` is the
  // output of the owner authenticator (phase 2: supabase auth or passkeys);
  // until that lands, host applications construct the session after their own
  // owner verification. a session must carry kind/verified/ownerRef; anything
  // else (including a bare { owner: true }) is rejected.
  createOwnerContext(verifiedOwnerSession) {
    if (!isValidOwnerSession(verifiedOwnerSession)) {
      throw new Error('createOwnerContext requires a verified owner session { kind: "owner_session", verified: true, ownerRef }');
    }
    return new OwnerContext(verifiedOwnerSession);
  }

  // --- session lifecycle (bootstrap; phase 2 wires oidc / device flow) -------

  refreshSession(refreshToken) {
    return this.sessions.refresh(refreshToken);
  }

  // connect-code redemption is the unverified-agent bootstrap: the code itself
  // is the capability, so this is not an owner method. the owner approves the
  // resulting pending session out of band (ownerapi.approveConnect).
  redeemConnectCode({ code, agentName }) {
    const found = this.store.list('connectCodes', (c) => c.code === code && !c.used, { code }).find((c) => c.expiresAt > this.now());
    if (!found) return { outcome: OUTCOME.DECLINED, reason: 'code_invalid_or_expired' };
    const agent = this.agents.register({ name: agentName, tier: 'unverified', personasAllowed: [] });
    this.store.update('connectCodes', found.id, (c) => ({ ...c, used: true }));
    const session = { id: randomId('pend'), agentId: agent.id, personaId: found.personaId };
    this.store.put('pendingConnects', session.id, session);
    return { outcome: OUTCOME.APPROVAL_REQUIRED, agentId: agent.id, pendingId: session.id, nameShownAs: 'unverified' };
  }
}
