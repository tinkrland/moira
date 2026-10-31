// moira surface. the card kit (card-kit/builder.tsx) compiled to vanilla:
// same gradient card, 1.58 aspect, Space Mono, pointer tilt (±6°), spotlight,
// noise overlay, and the kit's flip easing. sections render as accent chips
// (p1..p5), the footer carries name + address like the kit's handle line.
const state = { secret: null, personas: [], selected: null };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const status = (msg, err = false) => { const el = $('#status'); el.textContent = msg; el.classList.toggle('err', err); };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-moira-owner': state.secret ?? '', ...(opts.headers ?? {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.reason || `http ${res.status}`), { body });
  return body;
}

const expiry = (p) => {
  if (!p.expiresAt) return 'no expiry';
  const d = new Date(p.expiresAt).toISOString().slice(0, 10);
  return `${p.standing ? 'standing → ' : '→ '}${d}`;
};

function chips(persona, side) {
  // front = the declared world (sets + categories); back = the consent record
  if (side === 'back') return '';
  const names = persona.sets.map((s) => s.name);
  const cats = [...new Set(persona.passes.filter((p) => !p.revoked).map((p) => p.category))];
  const all = [...names, ...cats];
  if (!all.length) return '<span class="chip p4">unfiled</span>';
  return all.slice(0, 8).map((t, i) => `<span class="chip p${(i % 5) + 1}">${esc(t)}</span>`).join('');
}

function rows(persona) {
  const live = persona.passes.filter((p) => !p.revoked && (p.expiresAt === null || p.expiresAt > Date.now()));
  if (!live.length) return '<div class="empty">nobody yet. isolation is the default.</div>';
  return live.map((p) => `
    <div class="row"><span>${esc(p.category)} · ${esc(p.purpose)}</span>
      <span class="${p.scope === 'full' ? 'full' : ''}">${p.scope === 'full' ? 'full hat' : esc((p.sets || []).join(', '))}</span></div>
    <div class="row"><span class="tag ${p.standing ? 'standing' : ''}">${p.standing ? 'standing' : esc(p.duration)}</span><span class="tag">${expiry(p)}</span></div>`).join('');
}

function card(p) {
  const el = document.createElement('article');
  el.className = 'card';
  const handle = p.email ? p.email.split('@')[0] : p.name.replace(/\s+/g, '');
  el.innerHTML = `
    <div class="card-inner">
      <div class="face front">
        <div class="chips">${chips(p, 'front')}</div>
        <div class="footer">
          <div>
            <div class="name">${esc(p.name)}</div>
            <div class="handle">${p.email ? esc(p.email) : '@' + esc(handle)} | moira</div>
          </div>
          <div class="stamp"><div>moira</div><div>prixie labs</div></div>
        </div>
      </div>
      <div class="face back">
        <div class="rows">${rows(p)}</div>
        <div class="actions">
          <button class="tiny flip">flip</button>
          <button class="tiny open">open</button>
          <button class="tiny lend">lend context…</button>
        </div>
      </div>
    </div>`;
  const inner = el.querySelector('.card-inner');
  // kit tilt + spotlight
  el.addEventListener('pointermove', (e) => {
    const r = inner.getBoundingClientRect();
    const ry = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 6;
    const rx = -((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 6;
    inner.style.setProperty('--ry', `${ry}deg`);
    inner.style.setProperty('--rx', `${rx}deg`);
    for (const f of el.querySelectorAll('.face')) {
      f.style.setProperty('--sx', `${((e.clientX - r.left) / r.width) * 100}%`);
      f.style.setProperty('--sy', `${((e.clientY - r.top) / r.height) * 100}%`);
    }
  });
  el.addEventListener('pointerleave', () => {
    inner.style.setProperty('--ry', '0deg');
    inner.style.setProperty('--rx', '0deg');
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('.lend')) return openPanel(p);
    if (e.target.closest('.open')) return openDetail(p).catch((err) => status(err.message, true));
    el.classList.toggle('flipped');
  });
  return el;
}

// the card, opened: facts by category, vault captures, declared stack/ai,
// sets, permissions. everything here is what moira actually holds.
function detailSection(title, body) {
  return `<div class="section"><h3>${esc(title)}</h3>${body}</div>`;
}

async function openDetail(p) {
  const [d, people] = await Promise.all([
    api(`/api/persona?id=${encodeURIComponent(p.id)}`),
    api(`/api/people?personaId=${encodeURIComponent(p.id)}`).catch(() => ({ people: [], circles: [] }))
  ]);
  $('#detail').hidden = false;
  $('#detail-name').textContent = `${d.persona.name} · ${d.persona.identity}${d.persona.email ? ' · ' + d.persona.email : ''}`;
  const cats = Object.entries(d.facts.byCategory ?? {});
  const factBody = cats.length
    ? cats.map(([cat, list]) => `<div class="meta">${esc(cat)} · ${list.length}</div><ul>${list.slice(0, 6).map((f) => `<li>${esc(f.content)}${(f.fields || []).length ? ` <span class="meta">${esc(f.fields.map((x) => cat + '.' + x).join(', '))}</span>` : ''}</li>`).join('')}</ul>`).join('')
    : '<div class="meta">no facts yet</div>';
  const vaultBody = d.vault.items.length
    ? `<ul>${d.vault.items.slice(0, 8).map((i) => `<li>${esc(i.title ?? i.kind)} <span class="meta">${esc(i.kind)}</span></li>`).join('')}</ul>`
    : '<div class="meta">vault empty</div>';
  const stackBody = d.stack.length
    ? `<ul>${d.stack.map((s) => `<li>${esc(s.tool)} <span class="meta">${esc((s.uses || []).join(', '))}</span></li>`).join('')}</ul>`
    : '<div class="meta">nothing declared</div>';
  const aiBody = d.ai.length
    ? `<ul>${d.ai.map((a) => `<li>${esc(a.job)} <span class="meta">${esc((a.tools || []).map((t) => t.tool).join(', '))}</span></li>`).join('')}</ul>`
    : '<div class="meta">nothing declared</div>';
  const setsBody = d.sets.length
    ? `<div class="chips">${d.sets.map((s, i) => `<span class="chip p${(i % 5) + 1}">${esc(s.name)} · ${s.count} <button class="x" data-set="${esc(s.name)}" title="untag everywhere">×</button></span>`).join('')}</div>
       <div class="meta">removing a set untags everything; nothing is deleted</div>`
    : '<div class="meta">no sets</div>';
  const permBody = d.passes.length
    ? `<ul>${d.passes.map((x) => `<li>${esc(x.category)} · ${esc(x.purpose)} <span class="meta">${x.scope === 'full' ? 'full hat' : esc((x.sets || []).join(', '))}</span></li>`).join('')}</ul>`
    : '<div class="meta">nothing lent. isolated.</div>';
  // people, per persona: circles are soft tags, importance is this persona's
  const peopleBody = (people.people ?? []).length
    ? `<div class="chips">${(people.circles ?? []).map((c, i) => `<span class="chip p${(i % 5) + 1}">${esc(c.name)} · ${c.count}</span>`).join('')}</div>
       <ul>${people.people.map((x) => `<li>${esc(x.name)} <span class="meta">${'●'.repeat(x.importance ?? 0)}${'○'.repeat(Math.max(0, 5 - (x.importance ?? 0)))} ${esc(x.circles.join(' · '))}</span></li>`).join('')}</ul>
       <button class="tiny add-person">+ person</button>`
    : `<div class="meta">nobody known to this persona yet</div><button class="tiny add-person">+ person</button>`;

  $('#detail-body').innerHTML = [
    detailSection(`people · ${(people.people ?? []).length}`, peopleBody),
    detailSection(`facts · ${d.facts.total}`, factBody),
    detailSection(`vault · ${d.vault.items.length}`, vaultBody),
    detailSection('stack', stackBody),
    detailSection('ai tools', aiBody),
    detailSection('sets', setsBody),
    detailSection('who can read', permBody)
  ].join('');

  const addBtn = $('#detail-body').querySelector('.add-person');
  if (addBtn) addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = prompt('who? (name as you know them)');
    if (!name) return;
    const circles = (prompt('circles for this persona (comma separated)') || '').split(',').map((c) => c.trim()).filter(Boolean);
    const importance = Math.min(5, Math.max(1, Number(prompt('importance 1-5 for this persona', '3')) || 3));
    const note = prompt('a note for this persona (optional)') || null;
    try {
      const made = await api('/api/people', { method: 'POST', body: JSON.stringify({ name }) });
      await api('/api/people/profile', {
        method: 'POST',
        body: JSON.stringify({ personaId: d.persona.id, personId: made.person.id, circles, importance, note })
      });
      await openDetail({ id: d.persona.id });
    } catch (err) { status(`person not added: ${err.message}`, true); }
  });

  for (const btn of $('#detail-body').querySelectorAll('button.x')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.set;
      if (!confirm(`untag "${name}" everywhere? nothing is deleted.`)) return;
      try {
        await api('/api/set', { method: 'POST', body: JSON.stringify({ personaId: d.persona.id, name }) });
        await Promise.all([load(), openDetail({ id: d.persona.id })]);
      } catch (err) { status(`set removal declined: ${err.message}`, true); }
    });
  }
}

function openPanel(p) {
  state.selected = p;
  $('#panel').hidden = false;
  $('#panel-title').textContent = `share ${p.name}`;
  $('#pass-msg').textContent = '';
}

// the request inbox: who is asking, why, for what, for how long. approving
// can only narrow (the api refuses widening), and denying grants nothing.
async function loadInbox() {
  const [out, disc] = await Promise.all([
    api('/api/requests?status=pending'),
    api('/api/disclosures?status=pending').catch(() => ({ disclosures: [] }))
  ]);
  const body = $('#inbox-body');
  $('#req-count').textContent = String(out.requests.length + (disc.disclosures?.length ?? 0));
  if (!out.requests.length) {
    body.innerHTML = '<div class="empty">nothing pending. silence is the default.</div>';
    return;
  }
  const discCards = (disc.disclosures ?? []).map((d) => `
    <div class="ask" data-disc="${esc(d.id)}">
      <div class="from">${esc(d.clientId)} → ${esc(d.personaId)}</div>
      <div class="why">directed disclosure: deliver to <b>${esc(d.destination)}</b></div>
      <div class="want">wants ${esc(d.fields.join(', '))} · purpose ${esc(d.purpose)} · one delivery, values never returned to the app</div>
      <div class="verdict">
        <button class="tiny approve-disc">deliver once</button>
        <button class="tiny deny-disc">deny</button>
      </div>
    </div>`).join('');

  body.innerHTML = discCards + out.requests.map((r) => `
    <div class="ask" data-id="${esc(r.id)}">
      <div class="from">${esc(r.clientId)} → ${esc(r.personaId)}</div>
      <div class="why">${r.note ? esc(r.note) : 'no note'}</div>
      <div class="want">wants ${esc(r.categories.join(', '))}${r.fields ? ' · ' + esc(r.fields.join(', ')) : ''} · purpose ${esc(r.purpose)} · ${esc(r.duration)}${r.sets ? ' · sets ' + esc(r.sets.join(', ')) : ' · whole hat (will need acknowledgement)'}</div>
      <div class="form-row">
        <label>sets <input name="sets" value="${r.sets ? esc(r.sets.join(', ')) : ''}" placeholder="work" /></label>
        <label>rung <select name="maxRung">
          ${[4, 3, 2, 1].map((n) => `<option value="${n}">${n}</option>`).join('')}
        </select></label>
        ${r.fields ? `<label>fields <input name="fields" value="${esc(r.fields.join(', '))}" /></label>` : ''}
        <label>for <select name="duration">
          ${['one_time', 'session', 'permanent'].map((d) => `<option value="${d}" ${d === r.duration ? 'selected' : ''}>${d}</option>`).join('')}
        </select></label>
      </div>
      <div class="verdict">
        <button class="tiny approve">approve</button>
        <button class="tiny deny">deny</button>
      </div>
    </div>`).join('');

  for (const card of body.querySelectorAll('.ask[data-disc]')) {
    const id = card.dataset.disc;
    card.querySelector('.approve-disc').addEventListener('click', async () => {
      try {
        await api('/api/disclosures/decide', { method: 'POST', body: JSON.stringify({ disclosureId: id, action: 'approve' }) });
        await Promise.all([loadInbox(), load()]);
      } catch (err) { status(`delivery declined: ${err.message}`, true); }
    });
    card.querySelector('.deny-disc').addEventListener('click', async () => {
      try {
        await api('/api/disclosures/decide', { method: 'POST', body: JSON.stringify({ disclosureId: id, action: 'deny', reason: 'owner declined' }) });
        await loadInbox();
      } catch (err) { status(err.message, true); }
    });
  }

  for (const card of body.querySelectorAll('.ask')) {
    const id = card.dataset.id;
    card.querySelector('.approve').addEventListener('click', async () => {
      const sets = card.querySelector('[name=sets]').value.split(',').map((s) => s.trim()).filter(Boolean);
      const fieldsEl = card.querySelector('[name=fields]');
      const fields = fieldsEl ? fieldsEl.value.split(',').map((f) => f.trim()).filter(Boolean) : null;
      const edits = {
        maxRung: Number(card.querySelector('[name=maxRung]').value),
        duration: card.querySelector('[name=duration]').value,
        ...(sets.length ? { sets } : {}),
        ...(fields ? { fields } : {})
      };
      try {
        await api('/api/requests/decide', { method: 'POST', body: JSON.stringify({ requestId: id, action: 'approve', edits }) });
        await Promise.all([loadInbox(), load()]);
      } catch (err) { status(`declined: ${err.message}`, true); }
    });
    card.querySelector('.deny').addEventListener('click', async () => {
      try {
        await api('/api/requests/decide', { method: 'POST', body: JSON.stringify({ requestId: id, action: 'deny', reason: 'owner declined' }) });
        await loadInbox();
      } catch (err) { status(`deny failed: ${err.message}`, true); }
    });
  }
}

async function load() {
  const out = await api('/api/overview');
  state.personas = out.personas;
  const deck = $('#deck');
  deck.textContent = '';
  if (!state.personas.length) {
    deck.innerHTML = '<div class="empty">no personas yet. seed one: node scripts/seed-demo.mjs</div>';
  } else {
    state.personas.forEach((p) => deck.appendChild(card(p)));
  }
  status(`${state.personas.length} persona${state.personas.length === 1 ? '' : 's'} · nothing is shared by default`);
  await loadInbox().catch(() => {});
}

$('#auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.secret = $('#secret').value;
  try { await load(); } catch (err) { status(`open failed: ${err.message}`, true); }
});

$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const sets = String(fd.get('sets') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const body = {
    personaId: state.selected?.id,
    clientId: fd.get('clientId'),
    category: fd.get('category'),
    purpose: fd.get('purpose'),
    duration: fd.get('duration'),
    maxRung: 4, // owner direction: full content by default; lower rungs are opt-in
    ...(sets.length ? { sets } : {}),
    ...(fd.get('acknowledgeFull') === 'on' ? { acknowledgeFull: true } : {})
  };
  const msg = $('#pass-msg');
  try {
    await api('/api/pass', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'lent. it expires or is revoked, never handed over.';
    msg.classList.remove('err');
    await load();
  } catch (err) {
    msg.textContent = err.message === 'full_scope_requires_acknowledgement'
      ? 'an empty scope is the whole hat: tick the acknowledgement or name sets.'
      : `declined: ${err.message}`;
    msg.classList.add('err');
  }
});


$('#detail-close').addEventListener('click', () => { $('#detail').hidden = true; });
$('#new-persona').addEventListener('click', () => { $('#create').hidden = false; $('#create-msg').textContent = ''; });
$('#create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const msg = $('#create-msg');
  try {
    await api('/api/persona', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        identity: fd.get('identity'),
        ...(String(fd.get('email') || '').trim() ? { email: String(fd.get('email')).trim() } : {})
      })
    });
    msg.textContent = 'created.';
    msg.classList.remove('err');
    e.target.reset();
    $('#create').hidden = true;
    await load();
  } catch (err) {
    msg.textContent = `declined: ${err.message}`;
    msg.classList.add('err');
  }
});


$('#requests').addEventListener('click', async () => {
  $('#inbox').hidden = false;
  try { await loadInbox(); } catch (err) { status(err.message, true); }
});
$('#inbox-close').addEventListener('click', () => { $('#inbox').hidden = true; });
