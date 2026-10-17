#!/usr/bin/env node
// moira cli - the owner's local surface. technically the whole owner api is
// scriptable from here; every command is one facade call.
//
// trust model, honestly: until passkey owner auth lands (phase 2.5), the cli
// mints an OwnerContext when MOIRA_OWNER_CONFIRMED=1 is set. that env var is
// the owner's own machine saying "yes, it's me" - the same trust a local
// first-run setup grants. never set it in shared or hosted environments.
//
// state: MOIRA_STATE path (default ~/.moira/state.json, a FileStore). for a
// hosted deployment set INSFORGE_URL + INSFORGE_ADMIN_KEY (or, on supabase,
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and the same commands run against
// the real database.
//
// usage: node cli.js <command> [subcommand] [flags]
//   personas list
//   core list [--category <c>]
//   fact promote --id <factId>
//   fact demote --id <factId> --to <personaId>
//   switch list [--status pending|approved|denied]
//   switch approve <switchId> | switch deny <switchId>
// everything prints json. exit code 0 on results, 1 on declined/unavailable.

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Moira, FileStore } from './src/index.js';

const HELP = `moira cli - owner surface
  personas list
  persona create --name <n> --identity <linked|pseudonymous|heteronymous> [--sheet <json>]
  persona freeze --id <personaId>   (put on ice instead of deleting; thaw brings it back)
  stack add --persona <id> --tool <supabase> --uses <auth,postgres,storage>   (stack context: tool + its uses)
  ai add --persona <id> --job <scraping> --tools <firecrawl,querit,tavily>   (ai tools by job)
  sets list --persona <id> | sets remove --persona <id> --name <work>   (context sets; --sets flag on stack/ai add)
  fact add --persona <personaId> --content <text> --category <c>
  core list [--category <c>]
  fact promote --id <factId>
  fact demote --id <factId> --to <personaId>
  switch list [--status pending|approved|denied]
  switch approve <switchId>
  switch deny <switchId>`;

function parse(argv) {
  const args = argv.slice(2);
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else pos.push(args[i]);
  }
  return { pos, flags };
}

function boot() {
  let store;
  if ((process.env.INSFORGE_URL && process.env.INSFORGE_ADMIN_KEY) ||
      (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    store = undefined; // gateway auto-picks InsForgeStore/SupabaseStore from env
  } else {
    const path = process.env.MOIRA_STATE ?? join(homedir(), '.moira', 'state.json');
    mkdirSync(dirname(path), { recursive: true });
    store = new FileStore(path);
  }
  return new Moira(store ? { store } : {});
}

function run() {
  const { pos, flags } = parse(process.argv);
  const [cmd, sub] = pos;

  if (!cmd || cmd === 'help' || (cmd === '--help' && !sub)) {
    console.log(HELP);
    return 0;
  }

  if (process.env.MOIRA_OWNER_CONFIRMED !== '1') {
    console.error(JSON.stringify({
      outcome: 'declined', reason: 'owner_not_confirmed',
      detail: 'set MOIRA_OWNER_CONFIRMED=1 on your own machine to act as the owner'
    }));
    return 1;
  }

  const m = boot();
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

  let res;
  switch (cmd) {
    case 'personas': {
      if (sub !== 'list') return fail('unknown personas subcommand');
      res = { outcome: 'results', personas: m.personas.list().map((p) => ({ id: p.id, name: p.name, identity: p.identity, storage: p.storage, inheritsCore: p.inheritsCore })) };
      break;
    }
    case 'persona': {
      if (sub === 'freeze') { res = m.owner.freezePersona(ctx, flags.id); break; }
      if (sub === 'thaw') { res = m.owner.thawPersona(ctx, flags.id); break; }
      if (sub !== 'create') return fail('unknown persona subcommand');
      const spec = { name: flags.name, identity: flags.identity };
      if (flags.sheet) spec.characterSheet = JSON.parse(flags.sheet);
      const created = m.owner.createPersona(ctx, spec); // returns the persona, not an outcome envelope
      res = { ...created, outcome: 'results' };
      break;
    }
    case 'fact': {
      if (sub === 'add') {
        const persona = m.personas.get(flags.persona);
        if (!persona) { res = { outcome: 'unavailable', reason: 'persona_missing' }; break; }
        res = m.facts.add(persona, { content: flags.content, category: flags.category, basis: 'stated' });
        if (res.outcome === 'results') res = { outcome: 'results', factId: res.fact.id };
      } else if (sub === 'promote') res = m.owner.promoteFact(ctx, { factId: flags.id });
      else if (sub === 'demote') res = m.owner.demoteFact(ctx, { factId: flags.id, toPersonaId: flags.to });
      else return fail('unknown fact subcommand');
      break;
    }
    case 'stack': {
      if (sub === 'add') {
        const spec = { personaId: flags.persona, tool: flags.tool, uses: String(flags.uses ?? '').split(',').filter(Boolean), sets: flags.sets ? String(flags.sets).split(',').filter(Boolean) : undefined };
        if (flags.category) {
          // category-first: --category frontend --tools react,tailwindcss
          spec.category = flags.category;
          spec.tools = String(flags.tools ?? '').split(',').filter(Boolean).map((tool) => ({ tool }));
          delete spec.tool; delete spec.uses;
        }
        res = m.owner.stackAdd(ctx, spec);
      }
      else if (sub === 'remove') res = m.owner.stackRemove(ctx, { personaId: flags.persona, tool: flags.tool, uses: flags.uses ? String(flags.uses).split(',').filter(Boolean) : null });
      else if (sub === 'list') res = m.owner.stackList(ctx, { personaId: flags.persona });
      else return fail('unknown stack subcommand');
      break;
    }
    case 'ai': {
      if (sub === 'add') {
        const spec = { personaId: flags.persona, job: flags.job, tool: flags.tool, uses: String(flags.uses ?? '').split(',').filter(Boolean), sets: flags.sets ? String(flags.sets).split(',').filter(Boolean) : undefined };
        if (flags.tools) {
          spec.tools = String(flags.tools).split(',').filter(Boolean).map((tool) => ({ tool }));
          delete spec.tool; delete spec.uses;
        }
        res = m.owner.aiAdd(ctx, spec);
      } else if (sub === 'remove') res = m.owner.aiRemove(ctx, { personaId: flags.persona, job: flags.job, tool: flags.tool ?? null, uses: flags.uses ? String(flags.uses).split(',').filter(Boolean) : null });
      else if (sub === 'list') res = m.owner.aiList(ctx, { personaId: flags.persona });
      else return fail('unknown ai subcommand');
      break;
    }
    case 'sets': {
      if (sub === 'list') res = m.owner.setList(ctx, { personaId: flags.persona });
      else if (sub === 'remove') res = m.owner.setRemove(ctx, { personaId: flags.persona, name: flags.name });
      else return fail('unknown sets subcommand');
      break;
    }
    case 'core': {
      if (sub !== 'list') return fail('unknown core subcommand');
      res = m.owner.listCoreFacts(ctx, { category: flags.category ?? null });
      break;
    }
    case 'switch': {
      if (sub === 'list') res = m.owner.listPersonaSwitches(ctx, { status: flags.status ?? null });
      else if (sub === 'approve') res = m.owner.approvePersonaSwitch(ctx, { switchId: pos[2] });
      else if (sub === 'deny') res = m.owner.denyPersonaSwitch(ctx, { switchId: pos[2] });
      else return fail('unknown switch subcommand');
      break;
    }
    default:
      return fail(`unknown command: ${cmd} (try 'help')`);
  }

  console.log(JSON.stringify(res, null, 2));
  return res.outcome === 'results' ? 0 : 1;
}

function fail(message) {
  console.error(JSON.stringify({ outcome: 'declined', reason: message }));
  return 1;
}

process.exit(run());
