// moira backend core. spec v0.5 (2026-10-15).
import { Moira } from './core/gateway.js';
import { AgentApi } from './facades/agentapi.js';
import { OwnerApi } from './facades/ownerapi.js';
import * as constants from './model/constants.js';
import * as policy from './core/policy.js';
import { MemoryStore, FileStore } from './store.js';
import { SupabaseStore } from './supabasestore.js';
import { InsForgeStore } from './insforgestore.js';
import { VaultKeyUnavailableError } from './core/errors.js';

// note: the OwnerContext class is deliberately NOT exported. the only minting
// path is moira.createOwnerContext(verifiedOwnerSession). the vault-key error
// IS exported: host applications must catch it to fail closed.
export { Moira, AgentApi, OwnerApi, MemoryStore, FileStore, SupabaseStore, InsForgeStore, constants, policy, VaultKeyUnavailableError };
export default Moira;
