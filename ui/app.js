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

// --- rooms: shared memory, one hat at a time --------------------------------
// a room is the one place in moira where several hats see the same thing. the
// rules are the service's, not the panel's: nothing enters except an item a
// member posted, every read re-checks membership, and attendance crosses as a
// count unless the owner shares the name. so the panel has three jobs only -
// ask, show, and make the sharing choice explicit at the moment it is made.

const whoIs = (personaId) => state.personas.find((x) => x.id === personaId)?.name ?? 'guest';
const dayOf = (at) => (at ? new Date(at).toISOString().slice(0, 10) : '');

function roomRow(room) {
  const bits = [room.state];
  if (room.items !== null) bits.push(`${room.items} item${room.items === 1 ? '' : 's'}`);
  if (room.memberCount !== null) bits.push(`${room.memberCount} member${room.memberCount === 1 ? '' : 's'}`);
  if (room.owner) bits.push('opened by this hat');
  const acts = room.state === 'active'
    ? `<button class="tiny room-open" data-id="${esc(room.roomId)}" data-name="${esc(room.name)}">open</button>`
    : room.state === 'invited'
      ? `<button class="tiny room-accept" data-id="${esc(room.roomId)}">join</button>
         <button class="tiny room-decline" data-id="${esc(room.roomId)}">decline</button>`
      : '<span class="meta">left</span>';
  return `<div class="room-row"><span class="room-name">${esc(room.name)}</span>
    <span class="meta">${esc(bits.join(' · '))}</span><span class="acts">${acts}</span></div>`;
}

function roomsSectionHtml(rooms) {
  const list = rooms.length
    ? rooms.map(roomRow).join('')
    : '<div class="meta">no rooms. a room is shared memory for more than one hat.</div>';
  return `${list}
    <form id="room-form" class="form-row">
      <label>new room <input name="name" placeholder="atlas build" maxlength="80" required /></label>
      <button type="submit">open room</button>
    </form>
    <p id="room-msg" class="msg" role="status"></p>`;
}

function mountRooms(personaId, refresh) {
  const form = $('#room-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#room-msg');
    try {
      await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ personaId, name: form.querySelector('[name=name]').value })
      });
      await refresh();
    } catch (err) {
      msg.textContent = `declined: ${err.message}`;
      msg.classList.add('err');
    }
  });

  for (const btn of document.querySelectorAll('.room-open')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRoom(personaId, btn.dataset.id, btn.dataset.name).catch((err) => status(err.message, true));
    });
  }
  for (const btn of document.querySelectorAll('.room-accept, .room-decline')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const accept = btn.classList.contains('room-accept');
      try {
        // declining an invite is the same act as leaving: it ends membership.
        // an invitation that could only be accepted would be a queue, not consent.
        await api('/api/rooms/join', {
          method: 'POST',
          body: JSON.stringify({ roomId: btn.dataset.id, personaId, action: accept ? 'accept' : 'leave' })
        });
        status(accept ? 'joined. this hat can read the room now.' : 'declined. nothing was joined.');
        await refresh();
      } catch (err) { status(`room refused: ${err.message}`, true); }
    });
  }
}

async function openRoom(personaId, roomId, name) {
  const q = `roomId=${encodeURIComponent(roomId)}&personaId=${encodeURIComponent(personaId)}`;
  const [tl, brief, people] = await Promise.all([
    api(`/api/rooms/timeline?${q}`),
    api(`/api/rooms/brief?${q}`),
    api(`/api/people?personaId=${encodeURIComponent(personaId)}`).catch(() => ({ people: [] }))
  ]);
  $('#room').hidden = false;
  const active = (brief.members ?? []).filter((m) => m.state === 'active').length;
  $('#room-name').textContent = `${name} · ${active} member${active === 1 ? '' : 's'}`;

  const kinds = Object.entries(brief.kinds ?? {});
  const itemsBody = tl.items.length
    ? `<ul class="timeline">${tl.items.map((i) => `<li class="item"><span class="kind">${esc(i.kind)}</span>${esc(i.body)}
        <span class="who">${esc(whoIs(i.from))} · ${esc(dayOf(i.at))}</span></li>`).join('')}</ul>`
    : '<div class="meta">empty. a room remembers only what a member posts.</div>';

  const known = people.people ?? [];
  const attendBody = known.length
    ? `<div class="chips">${known.map((x) => `<label class="ack"><input type="checkbox" name="person" value="${esc(x.personId)}" /> ${esc(x.name)}</label>`).join('')}</div>
       <label class="ack"><input type="checkbox" name="share" />
         share their names with the room; otherwise they cross as a count</label>
       <button type="submit" class="tiny">record attendance</button>`
    : '<div class="meta">this hat knows nobody yet, so there is nobody to attach to the room</div>';

  const seen = brief.participation ?? [];
  const seenBody = seen.length
    ? `<ul>${seen.map((x) => `<li>${esc(x.name ?? 'a person')} <span class="meta">×${x.count} · last ${esc(dayOf(x.lastAt))}</span></li>`).join('')}</ul>`
    : brief.attendance > 0
      ? '<div class="meta">counted, not named</div>'
      : '<div class="meta">nobody recorded yet</div>';
  const gaps = (brief.unknown ?? []).map((u) => `<div class="gap">${esc(u)}</div>`).join('');

  $('#room-body').innerHTML = `
    <div class="section">
      <h3>timeline · ${brief.items}</h3>
      ${itemsBody}
      <form id="item-form" class="form-row">
        <label>kind <select name="kind">
          ${['note', 'link', 'decision', 'file'].map((k) => `<option value="${k}">${k}</option>`).join('')}
        </select></label>
        <label>item <input name="body" placeholder="what the room should remember" maxlength="4000" required /></label>
        <button type="submit">post</button>
      </form>
      <p id="item-msg" class="msg" role="status"></p>
    </div>
    <div class="section">
      <h3>attendance · ${brief.attendance}</h3>
      <form id="attend-form">${attendBody}</form>
      ${seenBody}
      ${gaps}
      <p id="attend-msg" class="msg" role="status"></p>
    </div>
    <div class="section">
      <h3>the room itself</h3>
      <div class="meta">${kinds.length ? kinds.map(([k, n]) => `${esc(k)} ${n}`).join(' · ') : 'no items yet'}</div>
      <div class="meta">a room never absorbs facts or notes from a hat. leaving ends future reads; it does not unshare the past.</div>
      <button id="room-leave" class="tiny">leave this room</button>
    </div>`;

  const repaint = () => openRoom(personaId, roomId, name);

  $('#item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#item-msg');
    try {
      await api('/api/rooms/item', {
        method: 'POST',
        body: JSON.stringify({ roomId, personaId, kind: form.querySelector('[name=kind]').value, body: form.querySelector('[name=body]').value })
      });
      await repaint();
    } catch (err) {
      msg.textContent = `declined: ${err.message}`;
      msg.classList.add('err');
    }
  });

  $('#attend-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#attend-msg');
    const personIds = [...form.querySelectorAll('input[name=person]:checked')].map((el) => el.value);
    const share = form.querySelector('input[name=share]').checked;
    if (!personIds.length) { msg.textContent = 'pick at least one person.'; msg.classList.add('err'); return; }
    try {
      await api('/api/rooms/attend', { method: 'POST', body: JSON.stringify({ roomId, personaId, personIds, share }) });
      await repaint();
    } catch (err) {
      msg.textContent = `declined: ${err.message}`;
      msg.classList.add('err');
    }
  });

  $('#room-leave').addEventListener('click', async () => {
    if (!confirm('leave this room? future items stop here for this hat; what was read cannot be unread.')) return;
    try {
      await api('/api/rooms/join', { method: 'POST', body: JSON.stringify({ roomId, personaId, action: 'leave' }) });
      $('#room').hidden = true;
      status('left. the room keeps its history for the members who stayed.');
      await load();
    } catch (err) { status(`leave refused: ${err.message}`, true); }
  });
}
// --- rooms end

async function openDetail(p) {
  const [d, people, conns, roomList] = await Promise.all([
    api(`/api/persona?id=${encodeURIComponent(p.id)}`),
    api(`/api/people?personaId=${encodeURIComponent(p.id)}`).catch(() => ({ people: [], circles: [] })),
    // the connection surface: what this hat holds, and how each provider may be
    // shared. the classification comes from the api, not from the panel.
    api(`/api/connectors?personaId=${encodeURIComponent(p.id)}`).catch(() => ({ connectors: [], providers: [] })),
    // rooms are per hat: this persona's membership, with counts only where the
    // membership is real. an invite shows a name and nothing inside.
    api(`/api/rooms?personaId=${encodeURIComponent(p.id)}`).catch(() => ({ rooms: [] }))
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

  const held = conns.connectors ?? [];
  // every connected provider is listed, but a planned one is disabled: the api
  // refuses it today, so it is not a button that pretends to work.
  const connectable = (conns.providers ?? []).filter((x) => x.kind === 'connected');
  const heldBody = held.length
    ? `<ul>${held.map((c) => `<li>${esc(c.connectorId)} <span class="meta">${esc(c.account)} · ${c.mine ? 'this hat\'s' : 'borrowed, shared with this hat'} <button class="x revoke" data-id="${esc(c.identityId)}" title="revoke for everyone">×</button></span></li>`).join('')}</ul>`
    : '<div class="meta">no accounts connected to this hat</div>';
  const connBody = `${heldBody}
    <form id="conn-form" class="form-row">
      <label>provider <select name="connectorId">
        ${connectable.map((x) => `<option value="${esc(x.id)}"${x.status === 'active' ? '' : ' disabled'}>${esc(x.id)} · ${esc(x.scope === 'shareable' ? 'a key for a plan' : x.scope === 'persona' ? 'an account with a face' : 'unclassified')}${x.status === 'active' ? '' : ' · planned'}</option>`).join('')}
      </select></label>
      <label>credential <input name="credentials" placeholder="token or key" autocomplete="off" required /></label>
      <div class="share-slot"></div>
      <button type="submit">connect</button>
    </form>
    <p id="conn-msg" class="msg" role="status"></p>`;
  const roomRows = roomList.rooms ?? [];
  $('#detail-body').innerHTML = [
    detailSection(`people · ${(people.people ?? []).length}`, peopleBody),
    detailSection(`rooms · ${roomRows.length}`, roomsSectionHtml(roomRows)),
    detailSection(`connections · ${held.length}`, connBody),
    detailSection(`facts · ${d.facts.total}`, factBody),
    detailSection(`vault · ${d.vault.items.length}`, vaultBody),
    detailSection('stack', stackBody),
    detailSection('ai tools', aiBody),
    detailSection('sets', setsBody),
    detailSection('who can read', permBody),
    detailSection('inference check', '<div class="meta">measuring what each connected agent could infer…</div><div id="leaks"></div>')
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

  mountRooms(d.persona.id, () => openDetail({ id: d.persona.id }));

  // connections: connect an account to THIS hat, and offer to share it only
  // where the classification says sharing is honest - a key for a plan, never
  // an account with a face. the panel renders the gate the api sends; it does
  // not decide it.
  const connForm = $('#conn-form');
  if (connForm) {
    const slot = connForm.querySelector('.share-slot');
    const others = state.personas.filter((x) => x.id !== d.persona.id);
    const boxes = () => others.map((x) => `<label class="ack"><input type="checkbox" name="sharedWith" value="${esc(x.id)}" /> ${esc(x.name)}</label>`).join('');
    const paintShare = () => {
      const providerId = connForm.querySelector('[name=connectorId]').value;
      const hint = (conns.providers ?? []).find((x) => x.id === providerId) ?? {};
      if (!others.length) {
        slot.innerHTML = '<div class="meta">this is the only hat, so there is nobody to share with</div>';
        return;
      }
      if (hint.shareable === true) {
        slot.innerHTML = `<div class="meta">share this key with</div>${boxes()}
          <div class="meta">still borrowed per hat: each one needs its own pass</div>`;
        return;
      }
      // an account with a face: the classification says no, so the boxes stay
      // hidden behind an acknowledgement that names what is being joined. the
      // owner can still choose it - the hub records the share either way - but
      // never by accident, which is the whole point of the classification.
      const aware = slot.querySelector('input[name=shareAnyway]')?.checked === true;
      slot.innerHTML = `<div class="meta">${esc(hint.reason ?? 'unclassified: assumed to be an account, so not shareable')}</div>
        <label class="ack"><input type="checkbox" name="shareAnyway"${aware ? ' checked' : ''} />
          share this account anyway; it joins the hats at ${esc(providerId)}</label>
        ${aware ? `<div class="meta">share with</div>${boxes()}` : ''}`;
      slot.querySelector('input[name=shareAnyway]').addEventListener('change', paintShare);
    };
    connForm.querySelector('[name=connectorId]').addEventListener('change', paintShare);
    paintShare();
    connForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#conn-msg');
      const raw = String(connForm.querySelector('[name=credentials]').value || '').trim();
      const shared = [...slot.querySelectorAll('input[name=sharedWith]:checked')].map((el) => el.value);
      try {
        await api('/api/connectors/connect', {
          method: 'POST',
          body: JSON.stringify({
            personaId: d.persona.id,
            connectorId: connForm.querySelector('[name=connectorId]').value,
            credentials: { token: raw },
            // an empty list is not "shared with nobody", it is malformed; the
            // api refuses it. no boxes ticked means no shareScope at all.
            ...(shared.length ? { sharedWith: shared } : {})
          })
        });
        // the view re-renders from the store below, so the confirmation goes to
        // the header line: an inline message would be wiped by the re-render
        status(shared.length
          ? 'connected, and declared shared. each hat still needs its own pass.'
          : 'connected. this hat only.');
        await openDetail({ id: d.persona.id });
      } catch (err) {
        msg.textContent = `declined: ${err.message}`;
        msg.classList.add('err');
      }
    });
  }

  for (const btn of $('#detail-body').querySelectorAll('button.revoke')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('revoke this credential? it ends for every hat it was shared with.')) return;
      try {
        await api('/api/connectors/revoke', { method: 'POST', body: JSON.stringify({ identityId: btn.dataset.id }) });
        await openDetail({ id: d.persona.id });
      } catch (err) { status(`revoke failed: ${err.message}`, true); }
    });
  }

  // inference check runs after paint: one audit per agent holding a pass
  (async () => {
    const agents = [...new Set(d.passes.map((x) => x.clientId))];
    const box = $('#leaks');
    if (!box) return;
    if (!agents.length) { box.innerHTML = '<div class="meta">nobody is connected, so nothing can leak</div>'; return; }
    const rows = [];
    for (const clientId of agents) {
      try {
        const a = await api(`/api/leakage?personaId=${encodeURIComponent(d.persona.id)}&clientId=${encodeURIComponent(clientId)}`);
        rows.push(a.findings.length
          ? `<li>${esc(clientId)} <span class="meta">${a.findings.length} inferable · ${a.findings.map((f) => f.kind + ' ' + f.score + ' (' + f.tier + ')').join(', ')}</span></li>`
          : `<li>${esc(clientId)} <span class="meta">nothing inferable</span></li>`);
      } catch { rows.push(`<li>${esc(clientId)} <span class="meta">audit failed</span></li>`); }
    }
    // direct leakage would be a serving bug; inference is a measured risk, so
    // the guard is an explicit opt-in, not a default
    const guard = d.persona.inferenceGuard === 'coarsen' ? 'coarsen' : 'off';
    box.innerHTML = `<ul>${rows.join('')}</ul>
      <div class="meta">token containment, threshold 0.6. counts, not content.</div>
      <label class="meta" style="display:flex;gap:.4rem;align-items:center;margin-top:.4rem">
        <select id="guard-mode">
          <option value="off"${guard === 'off' ? ' selected' : ''}>serve as asked</option>
          <option value="coarsen"${guard === 'coarsen' ? ' selected' : ''}>coarsen colliding facts</option>
        </select>
        <span>inference guard</span>
      </label>`;
    const sel = $('#guard-mode');
    if (sel) sel.addEventListener('change', async () => {
      try {
        await api('/api/leakage/guard', { method: 'POST', body: JSON.stringify({ personaId: d.persona.id, mode: sel.value }) });
        status(sel.value === 'coarsen' ? 'colliding facts now serve as their exists rung' : 'guard off: facts serve as asked');
        await openDetail({ id: d.persona.id });
      } catch (err) { status(`guard unchanged: ${err.message}`, true); }
    });
  })();

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
        <label>basis <select name="basis" title="what the pass may see, by why it is believed">
          <option value="">everything asked</option>
          <option value="liking">liking only (stated + freely chosen)</option>
          <option value="constraint">under constraint only (work-mandated)</option>
          <option value="availability">availability only (free credits, free tier)</option>
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
      const basisEl = card.querySelector('[name=basis]');
      const chosenBasis = basisEl ? basisEl.value : '';
      const edits = {
        maxRung: Number(card.querySelector('[name=maxRung]').value),
        duration: card.querySelector('[name=duration]').value,
        ...(sets.length ? { sets } : {}),
        ...(fields ? { fields } : {}),
        // empty = leave the ask alone; a choice here can only narrow it
        ...(chosenBasis ? { basis: [chosenBasis] } : {})
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
$('#room-close').addEventListener('click', () => { $('#room').hidden = true; });
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
