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
    el.classList.toggle('flipped');
  });
  return el;
}

function openPanel(p) {
  state.selected = p;
  $('#panel').hidden = false;
  $('#panel-title').textContent = `share ${p.name}`;
  $('#pass-msg').textContent = '';
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
    maxRung: 2,
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
