# explain

how moira works, explained for a person rather than an engineer. the
mechanical version is `../technobabble/underthehood.md`.

## the metaphor: a house with a good concierge

your context lives in one house. the house has rooms - one per persona
(student, founder, character, alter ego). each room has its own lock.

- **you** are the owner. you have the master keyring.
- **apps and agents** are visitors. they never get keys - they get
  tickets (passes) that open one shelf of one room, for a stated
  purpose, until a stated time.
- **the concierge** (the backend) checks every ticket, records every
  visit in a guest book (receipts), and never lets a visitor wander
  into a room the ticket doesn't name.
- **bridges** are doors between two rooms - and a door only works if
  both rooms agreed to it, and only lets through what the door's
  settings allow.
- **connectors** are the delivery service: your drive, your calendar,
  your rss reader bring things INTO a room, clearly labeled
  "delivered, not believed".
- **deleting a room** means melting the lock. everything in it stays
  encrypted forever; nobody, including the concierge, can ever open it
  again.

## a day in the life

1. you create personas: "founder", "student". the founder persona
   connects a google drive (the files connector) and a calendar.
2. you ask an ai assistant to help with investor updates. it asks moira
   for founder context; you grant a pass: founder persona, category
   "notes", purpose "investor update", 24 hours.
3. the assistant reads exactly that shelf, through the ticket, for one
   day. every read is stamped in your guest book: which visitor, what
   category, how many facts, when.
4. mid-chat, the assistant asks to work as your student persona
   instead (a persona switch). moira parks the request in your inbox.
   nothing changes until you approve; approval mints a fresh session
   for the new persona, and the old one is untouched.
5. you retire the student persona at graduation. its keys are
   shredded. the receipts remain - content-free stubs proving what was
   shared, when, without keeping what was said.

## what "untrusted" means here

when drive or a calendar imports text, moira stamps it untrusted with
its source. untrusted text can inform a conversation but never becomes
a preference you're assumed to hold until you say so. platforms
describe you; you decide who you are.

## what the receipts prove

only that sharing happened - actor, persona, categories, counts,
timestamps. never the content. so the audit trail answers "who got
what kind of thing from me, when" without becoming a second copy of
your data.

## why deterministic matters to you

every access decision is a pure function - the same request gives the
same answer, forever. that means the rules you set behave exactly as
written, can be replayed and tested, and no "intelligent" guesswork
ever widens your consent. judgment lives with you; the machine only
follows the rules you wrote.
