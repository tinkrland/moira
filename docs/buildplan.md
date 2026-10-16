# buildplan

what is built, what is next, and the reasoning for the order. the log of
what actually shipped (with commits and bug hunts) is
`technobabble/journal.md`; this file is the plan.

## done

- **phase 0 - core.** policy engine, personas, facts, passes, bridges,
  packs, handoffs, ledger, router, receipts, key shredding. all
  pinned by tests, no phantom verification anywhere.
- **phase 0.5 - hardening.** append-only receipts at the db level, rls
  default-deny, role hygiene.
- **phase 1 - persistence.** insforge as primary (supabase adapter
  retained), cas rpc, live verification battery against the real
  project.
- **phase 2 - transport and auth.** mcp streamable http, oidc-shaped
  pkce + device flow, jose tokens.
- **phase 3 - connectors.** the job-node registry, the files wave, the
  hub.
- **unplanned but shipped:** persona switching (request/approve/
  collect), shared core with promote/demote, the cli, the insforge
  migration, the docs overhaul.

## next, in order

1. **owner session auth (phase 2.5) - the decision that gates hosted
   use.** today the gateway mints an owner capability after the host's
   own verification; a hosted deployment needs a real owner auth
   story. the proposal on the table: passkeys + recovery codes,
   no passwords. this is awaiting the owner's call.
2. **the browser surface.** moira is browser-first by design; the
   backend is ready (owner surface, receipts, connectors) and the web
   app is the next big work item. personas, passes, receipts, and the
   connector tree as visible, touchable things.
3. **second connector wave.** the knowledge jobs (projects: linear,
   craft, notion; time: google calendar, notion calendar; publish:
   substack, medium) - each needs its oauth app registration and
   adapter. mega last in its wave (encrypted rpc client).
4. **live provider verification.** the files adapters are
   fixture-tested; live runs need each provider's oauth credentials
   registered. until then, honestly not verified.
5. **people connections.** persona-to-persona bridges between two
   owners - connect codes exist; the product surface around them
   (accept/decline, per-persona relationship management) comes with
   the browser surface.
6. **evie (separate branch, taste engine).** fuel line is registered;
   activates only when evie does. deliberately last among majors:
   taste without consent infrastructure is just another profiler.

## deferred deliberately (v2+)

- payments and booking actions
- the on-device sovereign mediator
- nfc tappable cards - the pass model is the right shape for it, but
  nothing is built and nothing will pretend to be

## the ordering logic

consent infrastructure before surfaces, surfaces before new
connections, connections before taste. every phase so far has kept the
core deterministic and the verification honest; the plan is sequenced
so that never has to change.
