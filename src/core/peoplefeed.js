// the wiring between a connector and the address book. deliberately thin: the
// hub unseals and calls, this maps rows onto events, people.ingest proposes.
//
// no scheduling lives here. a host calls capture() from whatever clock it owns,
// because "watch a mailbox forever" is a decision about standing access, and
// this layer does not get to make it on the owner's behalf.

import { OUTCOME } from '../model/constants.js';

export class PeopleFeedService {
  constructor({ connectors, people, now = Date.now }) {
    this.connectors = connectors;
    this.people = people;
    this.now = now;
  }

  async capture({ personaId, connectorId, project = null, workspace = null, account = null, params = {} } = {}) {
    if (!personaId || !connectorId) return { outcome: OUTCOME.DECLINED, reason: 'persona_and_connector_required' };
    const signals = await this.connectors.captureSignals({ personaId, connectorId, project, workspace, account, params });
    if (signals.outcome !== OUTCOME.RESULTS) return signals; // the refusal travels unchanged

    const ingested = this.people.ingest({
      events: signals.rows,
      source: { connectorId, project: signals.project ?? project ?? null }
    });
    return {
      ...ingested,
      captured: signals.rows.length,
      connectorId,
      // the book is untouched by construction, and this says so rather than
      // leaving the caller to assume it
      populated: false
    };
  }
}
