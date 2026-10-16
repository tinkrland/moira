// insforgestore: the store over insforge's hosted postgres records api.
//
// insforge is postgREST-shaped (the same dialect the supabase store speaks),
// verified live against the project on 2026-10-16:
//   - records at /api/database/records/{table}, rpc at /api/database/rpc/{fn}
//   - bare-array responses, Prefer: return=representation honored,
//     data->> json-path filters, Range/count=exact pagination, apikey
//     header tolerated (harmless; only the bearer key is read)
//   - moira_cas_update returns the row data directly on hit, and json null
//     with http 200 on a cas miss (supabase/postgrest returns 204 + empty
//     there) - handled explicitly below rather than by accident.
//
// insforge does not allow role management: the schema's service_role grants
// are rewritten to project_admin by scripts/apply-insforge.mjs (the runtime
// role and table owner; owners bypass rls, same semantics as supabase's
// service_role). anon is locked out at the grant level - verified: reads and
// rpc calls return permission denied with the anon key.
//
// env: INSFORGE_URL (project base url) + INSFORGE_ADMIN_KEY (ik_... key).

import { SupabaseStore } from './supabasestore.js';

export class InsForgeStore extends SupabaseStore {
  constructor({ url = process.env.INSFORGE_URL, key = process.env.INSFORGE_ADMIN_KEY, timeoutMs = 15000, now = Date.now } = {}) {
    if (!url || !key) {
      throw new Error('InsForgeStore requires INSFORGE_URL and INSFORGE_ADMIN_KEY');
    }
    super({ url, key, timeoutMs, now });
    // parent appends '/rest/v1'; insforge's records live under
    // /api/database. keep the raw base and map paths per request instead.
    this.url = url.replace(/\/$/, '');
    this.insforge = true;
  }

  static fromEnv() {
    return new InsForgeStore({});
  }

  // map postgrest-style paths to insforge's api layout. the only rpc call in
  // the store is moira_cas_update; every other path is a table name.
  _request(method, path, opts = {}) {
    if (path.startsWith('/rpc/')) {
      return super._request(method, `/api/database${path}`, opts);
    }
    return super._request(method, `/api/database/records${path}`, opts);
  }

  // insforge's rpc returns 200 with json null on a cas miss; the parent's
  // 204 check stays (harmless) and this makes the miss explicit.
  _casMiss(resp) {
    return resp.status === 204 || (resp.status === 200 && resp.json === null);
  }
}
