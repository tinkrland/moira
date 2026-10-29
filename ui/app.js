// moira surface: flippable personas, explicit lending. no framework, no
// build step. the owner secret lives in memory only, never in storage.
const state = { secret: null, personas: [], selected: null };

const $ = (sel) => document.querySelector(sel);
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

const fmtExpiry = (p) => {
  if (!p.expiresAt) return 'no expiry';
  const d = new Date(p.expiresAt);
  return `${p.standing ? 'standing until ' : 'until '}${d.toISOString().slice(0, 10)}`;
};

function card(p) {
  const el = document.createElement('article');
  el.className = 'card';
  const live = p.passes.filter((x) => !x.revoked && (x.expiresAt === null || x.expiresAt > Date.now()));
  el.innerHTML = `
    <div class="card-inner">
      <div class="face front">
        <div class="identity">${p.identity}${p.status === 'frozen' ? ' · frozen' : ''}</div>
        <h3>${p.name}</h3>
        <div class="row"><span>${p.sets.length} sets</span><span>${live.length} live passes</span></div>
        <div class="pillrow">${p.sets.slice(0, 4).map((s) => `<span class="pill">${s.name}</span>`).join('') || '<span class="pill">unfiled</span>'}</div>
        <button class="flip">turn over</button>
      </div>
      <div class="face back">
        <div class="identity">who can read this hat</div>
        ${live.length === 0 ? '<div class="empty">nobody yet. the default is isolation.</div>' : live.map((x) => `
          <div class="row"><span>${x.category}</span><span>${x.purpose}</span></div>
          <div class="row"><span class="pill ${x.scope === 'full' ? 'full' : ''}">${x.scope === 'full' ? 'full hat' : (x.sets || []).join(', ')}</span>
          <span class="pill ${x.standing ? 'standing' : ''}">${fmtExpiry(x)}</span></div>`).join('')}
        <button class="flip">back</button>
        <button class="flip lend">lend context…</button>
      </div>
    </div>`;
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('flip')) el.classList.toggle('flipped');
    if (e.target.classList.contains('lend')) openPanel(p);
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
    deck.innerHTML = '<div class="empty">no personas yet. create one on the owner surface.</div>';
  } else {
    state.personas.forEach((p) => deck.appendChild(card(p)));
  }
  status(`${state.personas.length} personas · nothing is shared by default`);
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
      ? 'an empty scope is the whole hat: tick the acknowledgement, or name sets.'
      : `declined: ${err.message}`;
    msg.classList.add('err');
  }
});
