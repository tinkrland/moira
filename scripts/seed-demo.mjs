// seed the demo card: "moira airidian" at moira@dearagent.shop.
// idempotent: running twice does not duplicate the persona.
//
//   node scripts/seed-demo.mjs            (same env as the server)

import { Moira } from '../src/index.js';
import { FileStore } from '../src/store.js';

export function seedDemo(moira, ctx) {
  const existing = moira.owner.overview(ctx).personas.find((p) => p.name === 'moira airidian');
  if (existing) return { created: false, persona: existing };

  const persona = moira.owner.createPersona(ctx, {
    name: 'moira airidian',
    identity: 'linked',
    email: 'moira@dearagent.shop',
    characterSheet: { bio: 'the demo hat: what a persona card looks like with a little context on it.' }
  });

  // a little declared context so the card face has sections to show
  moira.owner.stackAdd(ctx, { personaId: persona.id, tool: 'supabase', uses: ['auth', 'postgres'], sets: ['work'] });
  moira.owner.aiAdd(ctx, { personaId: persona.id, job: 'scraping', tools: ['firecrawl', 'tavily'], sets: ['work'] });
  moira.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'note', note: 'the first thing moira airidian ever saved.', sets: ['work'], tags: ['first'] });
  // a fact the owner declares directly (the trusted path; agents only propose)
  moira.facts.add(moira.personas.get(persona.id), {
    content: 'writes in lowercase, by choice', category: 'preferences', sets: ['work']
  });

  return { created: true, persona: { id: persona.id, name: persona.name } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hosted = (process.env.INSFORGE_URL && process.env.INSFORGE_ADMIN_KEY) || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const store = hosted ? undefined : (process.env.MOIRA_STATE ? new FileStore(process.env.MOIRA_STATE) : undefined);
  const moira = new Moira({ store });
  const ctx = moira.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const out = seedDemo(moira, ctx);
  console.log(out.created ? `seeded: ${out.persona.name}` : `already seeded: ${out.persona.name}`);
}
