#!/usr/bin/env node
// the clock, as a command. moira deliberately runs no background loop: a
// scheduler inside the process would hold a store open and decide, on its own
// authority, when credentials must rotate. so the clock is the host's - and
// this is a clock a host can put in cron:
//
//   MOIRA_OWNER_CONFIRMED=1 MOIRA_STATE=~/.moira/state.json node scripts/sweep.mjs
//
// it does the two maintenance acts that are bookkeeping rather than judgement:
// stamp the asks past their deadline (so "pending" never includes a ghost), and
// report what is due for rotation. it rotates nothing: rotation needs new
// material from the provider, which is a person's act, not a timer's.
//
// json on stdout, so cron mail and a shell pipeline both work.

import { Moira } from '../src/index.js';
import { FileStore } from '../src/store.js';

if (process.env.MOIRA_OWNER_CONFIRMED !== '1') {
  console.error('refusing to run without MOIRA_OWNER_CONFIRMED=1 (local trust, until owner auth lands)');
  process.exit(2);
}

const store = process.env.MOIRA_STATE ? new FileStore(process.env.MOIRA_STATE) : undefined;
const moira = new Moira(store ? { store } : {});
const owner = moira.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'local-sweep' });

const expired = moira.owner.sweepAccessRequests(owner);
const due = moira.owner.dueRotations(owner);

const report = {
  at: new Date().toISOString(),
  asksExpired: expired.expired ?? 0,
  // the due list carries identity ids and accounts, never secrets
  rotationsDue: (due.identities ?? []).map((x) => ({
    identityId: x.identityId,
    connectorId: x.connectorId,
    account: x.account,
    reason: x.reason,
    overdueByMs: x.overdueByMs,
    rotationCount: x.rotationCount
  }))
};

console.log(JSON.stringify(report, null, 2));
// a due credential is not an error, but a cron that stays silent is: exit 0
// either way so a host's alerting reads the json rather than a code.
process.exit(0);
