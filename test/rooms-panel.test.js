// the rooms surface (2026-11-13).
//
// the surface is a zero-dependency classic script, so this is a source-level
// check like the connector panel's: it pins that the panel asks the room api,
// that every act has a button (including refusing an invite), and that the
// room view carries no judgement axes - a room can say who was there, never
// how much they matter.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../ui/ui.css', import.meta.url), 'utf8');

test('rooms panel: the overlay exists and is closable', () => {
  assert.match(html, /id="room"/, 'a room view has its own overlay');
  assert.match(html, /id="room-name"/);
  assert.match(html, /id="room-close"/);
  assert.match(js, /'#room-close'\)\.addEventListener\('click'/, 'the overlay closes');
  assert.match(css, /\.room-/, 'the room view is styled, not naked html');
});

test('rooms panel: every act the api offers has a control', () => {
  assert.match(js, /\/api\/rooms\?personaId=/, 'the list is read per persona');
  assert.match(js, /const roomsSection|rooms ·/i, 'the section is rendered with a count');
  assert.match(js, /id="room-form"/, 'create');
  assert.match(js, /\/api\/rooms\/item/, 'post an item');
  assert.match(js, /action: accept \? 'accept' : 'leave'/, 'accept an invite');
  assert.match(js, /action: 'leave'/, 'decline an invite or leave');
  assert.match(js, /\/api\/rooms\/attend/, 'record attendance');
  assert.match(js, /\/api\/rooms\/timeline/, 'read the timeline');
  assert.match(js, /\/api\/rooms\/brief/, 'read the group brief');
});

test('rooms panel: a name crosses only when it was shared', () => {
  // the share choice is stated in words next to the checkbox, because it is the
  // one control in here that changes what another person can read
  assert.match(js, /otherwise they cross as a count/i);
  assert.match(js, /counted, not named/i);
  assert.match(js, /attendance not shared|brief\.unknown|unknown\.includes/, 'a gap is shown, not narrated away');
});

test('rooms panel: the room view never reads a persona judgement', () => {
  // take the room rendering functions and prove the forbidden words are absent.
  // importance/interaction/circles live in the people section, not this one.
  const start = js.indexOf('// --- rooms');
  const end = js.indexOf('// --- rooms end');
  assert.ok(start > -1 && end > start, 'the rooms block is identifiable, marker to marker');
  const block = js.slice(start, end);
  for (const forbidden of ['importance', 'interaction', 'circles', 'note:']) {
    assert.equal(block.includes(forbidden), false, `the room view must not carry ${forbidden}`);
  }
});
