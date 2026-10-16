// apply the moira schema to an insforge project (insforge is the ai-native
// hosted target; supabase remains supported for later self-host parity).
//
// insforge's rawsql endpoint splits multi-statement payloads on bare
// semicolons, which breaks do-blocks and dollar quoting. so this script does
// its own quote-aware splitting and sends statements one at a time.
//
// role adaptation, same spirit as the local verify stack (which creates
// supabase's roles itself): insforge does not allow role management, so
// `service_role` is rewritten to `project_admin`, the role the rawsql api
// actually runs as. project_admin owns the tables it creates, and table
// owners bypass rls - the same semantics the supabase service_role had.
// anon/authenticated already exist on insforge; rls default-deny protects
// every moira_ table either way (verified with the anon key).
//
// env: INSFORGE_URL (project base url), INSFORGE_ADMIN_KEY (ik_... key)
// run:   node scripts/apply-insforge.mjs

import { readFileSync } from 'node:fs';

const url = process.env.INSFORGE_URL?.replace(/\/$/, '');
const key = process.env.INSFORGE_ADMIN_KEY;
if (!url || !key) {
  console.error('need INSFORGE_URL and INSFORGE_ADMIN_KEY');
  process.exit(1);
}

// quote-aware statement splitter: handles 'strings', $tag$ dollar quoting $tag$,
// -- line comments and /* block comments */.
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  let dollarTag = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < n) {
    const rest = sql.slice(i);
    if (inLineComment) {
      if (sql[i] === '\n') inLineComment = false;
      buf += sql[i]; i++; continue;
    }
    if (inBlockComment) {
      if (rest.startsWith('*/')) { inBlockComment = false; buf += '*/'; i += 2; continue; }
      buf += sql[i]; i++; continue;
    }
    if (!dollarTag && rest.startsWith('--')) { inLineComment = true; buf += '--'; i += 2; continue; }
    if (!dollarTag && rest.startsWith('/*')) { inBlockComment = true; buf += '/*'; i += 2; continue; }
    if (!dollarTag) {
      const m = rest.match(/^\$([A-Za-z_]*)\$/);
      if (m) { dollarTag = m[0]; buf += m[0]; i += m[0].length; continue; }
      if (sql[i] === "'") {
        // consume the quoted string (with '' escapes) atomically
        let j = i + 1;
        while (j < n) {
          if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
          if (sql[j] === "'") break;
          j++;
        }
        buf += sql.slice(i, j + 1); i = j + 1; continue;
      }
      if (sql[i] === ';') { out.push(buf.trim()); buf = ''; i++; continue; }
    } else if (rest.startsWith(dollarTag)) {
      buf += dollarTag; i += dollarTag.length; dollarTag = null; continue;
    }
    buf += sql[i]; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

async function run(stmt) {
  const res = await fetch(`${url}/api/database/advance/rawsql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: stmt })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// fresh installs need only schema.sql - it already contains everything the
// three migrations add (their headers say so; they exist for pre-2026-10-16
// databases). verify with: select table_name from information_schema.tables
// where table_name like 'moira_%' - expect 21 tables.
const files = ['supabase/schema.sql'];

// insforge's rawsql endpoint splits on bare semicolons and only understands
// $$ dollar quoting, not custom $tag$ quotes - so normalize both: roles
// (insforge forbids role management; project_admin is the runtime role)
// and tags (these files only use $f$, and never nest $$ inside it).
// insforge adaptations, all transport-level (semantics identical, proven
// on the local pg15 verify stack):
// 1. role management is forbidden there; project_admin is the runtime role
//    and table owner (owner bypasses rls, matching service_role semantics).
// 2. insforge's rawsql validator rejects semicolons/parens inside $$
//    dollar-quoted format bodies but accepts single-quoted ones - so each
//    $f$..$f$ body becomes an escaped single-quoted string.
const transform = (sql) =>
  sql.replace(/\$f\$([\s\S]*?)\$f\$/g, (_m, body) => `'${body.replace(/'/g, "''")}'`)
     .replace(/\bservice_role\b/g, 'project_admin');

for (const file of files) {
  const raw = transform(readFileSync(file, 'utf8'));
  const stmts = splitStatements(raw);
  console.log(`${file}: ${stmts.length} statements`);
  for (let idx = 0; idx < stmts.length; idx++) {
    const stmt = stmts[idx];
    try {
      await run(stmt);
    } catch (e) {
      console.error(`FAILED ${file} [${idx}]: ${e.message}`);
      console.error(`--- statement ---\n${stmt.slice(0, 400)}\n--- len ${stmt.length}`);
      process.exit(1);
    }
  }
}
console.log('applied.');
