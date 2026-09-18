# Ryder Feedback

A public feedback board and roadmap, in the shape of Frill. Next.js App
Router, Firestore for data, Firebase Auth for identity, deployable to Vercel
on Firebase's free plan.

**[SETUP.md](./SETUP.md) is the install guide.** This file is about how it
works and why.

```
Board              vote, filter by board and status, sort by trending/top/new
Roadmap            Planned / In progress / Shipped, driven entirely by ticket status
Tickets            threaded comments, status history
Yours              your ideas (including ones still in review), votes, comments, activity
Admin              review queue, published ideas, validation analytics,
                   pinning, roadmap notes, duplicate merging
Search             one site-wide palette on ⌘K; the board's own box filters the
                   list in front of you and is labelled as a filter, not a search
```

---

## The shape of it

```
Browser ──── reads ────────────────────────────────► Firestore
   │         live onSnapshot listeners, public,
   │         no auth required
   │
   └──── writes ──► Next.js route handler ──────────► Firestore
                    verifies the ID token,
                    validates, rate limits,
                    checks admin access,
                    then uses the Admin SDK
```

**Reads go straight to Firestore and are realtime.** Open the board in two
windows and a vote in one moves the counter in the other. There is no
polling and no API layer in the read path.

**Writes never do.** Every mutation goes through a route handler under
`src/app/api/`, which verifies the caller's ID token server-side before
touching anything. `firestore.rules` grants clients no write access at all,
to any collection.

That asymmetry is the design. It is worth explaining the one decision
behind it, because the obvious alternative is subtly broken.

### Why voting is a server route

The tempting design lets the browser write both halves of a vote in one
batch — a receipt at `posts/{id}/votes/{uid}` and a `+1` on the post's
`voteCount` — with a security rule allowing the counter change only when it
moves by exactly one and no receipt exists yet. It reads as airtight.

It is not. **Rules evaluate each write in a batch independently, against
the state before the batch.** So the rule guarding the counter cannot tell
an increment that arrived with a new receipt from an increment sent on its
own. A client that simply never writes the receipt satisfies the "no receipt
yet" check every single time, and can increment the counter without limit.

I built that version first, and the rules test suite caught it. The test is
still there, now asserting the opposite:

```
it("blocks the batched-vote trick, receipt or no receipt")
```

So `voteCount` is not client-writable. `POST /api/posts/[id]/vote` owns it
inside a Firestore transaction that reads the receipt and writes the counter
together. Duplicate voting is not merely forbidden, it is unrepresentable:
the receipt's document id *is* the voter's uid, so there is nowhere for a
second vote by the same person to go.

The cost is one function invocation per vote and no offline voting. The UI
hides the latency by updating optimistically and rolling back on failure.
If offline voting ever matters more, the way to get it is a Cloud Function
triggered on the votes subcollection maintaining the counter — that needs
the Blaze plan, which is why it is not the default here.

### Identity without registration

Every visitor gets an anonymous Firebase Auth account on first load, which
means a stable uid, which is what makes one-vote-per-person enforceable
without a sign-up form. Name and email are optional and asked for only when
someone posts.

**Email never lands on a public document.** It goes to `users/{uid}`, which
only that user and admins can read. The post carries a display name and
nothing else. A board you can put in front of customers should not publish
their contact details, and the rules test asserts an unauthenticated read of
a profile is denied while the post itself stays public.

### Nothing is public until an admin says so

A submitted idea lands as `moderation: "pending"` and is visible to exactly
two audiences: its author, and an admin. It reaches the public board when
someone on the team approves it, and approving it assigns its pipeline
status in the same action.

Moderation is a **separate field from status**, not a seventh status value.
They answer different questions — "may the public see this" and "where is
this in our pipeline" — and a post can be any combination of the two. Folding
them together would have meant every status filter, roadmap column and count
remembering to exclude one magic value, and an admin unable to say "approved,
and Planned" in one move.

What the public board actually filters on is a third, denormalised field:

```
isPublic = moderation === "approved" && mergedInto === null
```

One boolean rather than two equality filters, for two reasons. It keeps the
composite index set the same size it was. And it is the field the *security
rules* key public reads off, so "hidden in the UI" and "unreadable from the
database" are the same condition rather than two that can drift apart.

The rule that does the work is worth reading, because `list` rules are widely
misunderstood:

```
allow list: if resource.data.isPublic == true
            || isAdmin()
            || (signedIn() && resource.data.authorId == uid());
```

Firestore does not evaluate a list rule per returned document. It checks
statically that the *query* can only return documents satisfying the rule. So
that first clause does not filter anything — it means a query without
`where("isPublic","==",true)` is **rejected outright**. Dropping the filter is
not a way to see the review queue; it is a permission error. An admin's claim
is request-level, so it short-circuits the whole expression.

The submitter is not left guessing. `/me` is the one surface where a pending
or declined idea is visible, along with the reviewer's note, and declining
*requires* a reason — enforced in `validate.ts`, so no UI can skip it.

### The roadmap is not a separate thing

There is no roadmap data. A column is every ticket whose `status` an admin
set to `planned`, `in-progress` or `shipped`, ordered by votes (or by ship
date, for shipped). The roadmap cannot drift from the board because it *is*
the board, grouped by one field. Status changes are also appended to a
per-ticket event log, so customers can see when something became "planned"
and who said so, instead of watching items teleport between columns.

### Trending

`src/lib/ranking.ts`. Votes and comments decayed by age, computed on the
client over a bounded candidate set that Firestore can index.

The alternative is storing a score, which means either a cron job rewriting
every document forever or a Cloud Function on every vote. Neither is free
and neither is necessary at this scale.

The decay constants are calibrated, not decorative. The usual Hacker News
values (age in hours, gravity 1.8) assume content that is stale within a
day; feedback tickets live for months. With those constants a three-day-old
post with 28 votes outranked a six-week-old one with 212, and the trending
tab came out sorted almost purely by recency — which is what the "New" tab
is already for. Age in days with a 0.6 exponent behaves. `npm run test:unit`
pins that with the exact regression case.

### Merging duplicates

Votes are transferred, not discarded. Every voter on the duplicate who has
not already voted on the target gets a real receipt there, and the target's
counter moves by exactly that number. Merging posts with 40 and 30 votes
that share 5 voters gives 65 — not 70, not 40. Getting this wrong is the
classic feedback-board bug: it either inflates demand or throws away the
signal you merged for. The e2e suite asserts the arithmetic.

---

## Data model

```
boards/{boardId}                    name, slug, description, order, postCount
                                    (postCount counts *published* ideas)
posts/{postId}                      title, body, boardId, status, moderation,
                                    isPublic, reviewedAt, reviewerName,
                                    reviewNote, authorId, authorName,
                                    voteCount, commentCount, pinned,
                                    mergedInto, roadmapNote, eta, tags
posts/{postId}/votes/{uid}          the receipt. Existence is the vote.
                                    Not listable — nobody can see who voted
                                    for what; the public aggregate is voteCount.
posts/{postId}/comments/{id}        body, authorName, isAdmin, parentId
posts/{postId}/events/{id}          status timeline: created / status / merged
users/{uid}                         displayName, email. Private to owner + admins.
users/{uid}/myVotes/{postId}        that user's own vote index. One query
                                    answers "what have I voted on?" instead
                                    of one read per card.
rateLimits/{uid}_{action}           server bookkeeping, closed to clients
```

Statuses: `open`, `under-review`, `planned`, `in-progress`, `shipped`,
`declined`. The middle three are the roadmap columns.

Moderation: `pending`, `approved`, `rejected` — a separate axis from status,
because they answer different questions. See "Nothing is public until an
admin says so" below.

---

## Tests

```bash
npm run test:unit    # ranking and sort logic. Pure functions, no emulator.
npm run test:rules   # 33 assertions against the Firestore emulator.
npm run test:e2e     # 22 assertions against the real route handlers.
```

`tests/rules.test.mjs` asserts every security claim this README makes,
because "the UI has no button for that" is not a security property. It
covers: the batched-vote trick, forging a receipt, deleting someone else's
vote, faking the vote index, creating a post from the browser, rewriting
someone else's text, moving an item onto the roadmap, pinning, merging,
posting a comment with a Ryder badge, forging a status event, reading
another user's email, enumerating voters, and reading the rate limit
ledger. Plus the approval gate: that a pending idea is unreadable by anyone
but its author and an admin, that a list query which drops the `isPublic`
filter is refused rather than quietly returning the review queue, that you
can list your own submissions and not someone else's, and that a
collection-group sweep of everybody's comments is refused while your own
are not. Plus one that matters: an **admin's** browser has no write access
either — privilege lives in the route handlers, so a leaked admin session
grants nothing at the database layer.

`tests/smoke.mjs` runs against real HTTP: anonymous sign-in, posting, the
vote transaction (double-tap idempotency, five concurrent taps from one
person collapsing into one vote, unvoting), comment badge stripping, the
admin gate before and after granting the claim, the merge arithmetic, and
rate limiting.

---

## Project layout

```
src/app/
  page.tsx                          board
  roadmap/page.tsx                  roadmap
  p/[id]/page.tsx                   ticket
  me/page.tsx                       your ideas, votes, comments, activity
  admin/layout.tsx                  admin shell: access gate and sub-nav
  admin/page.tsx                    review queue — approve / decline
  admin/ideas/page.tsx              published ideas, status editable in place
  admin/analytics/page.tsx          validation dashboard
  api/posts/route.ts                create a post (lands as pending)
  api/posts/[id]/vote/route.ts      the vote transaction
  api/posts/[id]/comments/route.ts  create a comment
  api/admin/posts/[id]/route.ts     moderation, status, pin, notes (PATCH)
                                    and merge (POST)
  api/admin/analytics/route.ts      the dashboard rollup
  api/me/route.ts                   server-verified identity, incl. admin access
  globals.css                       design tokens, light and dark

src/lib/
  firebase/client.ts                browser SDK, anonymous + Google sign-in
  access.ts                         who is an admin: the @ryder.id rule
  firebase/admin.ts                 Admin SDK, requireUser / requireAdmin
  ranking.ts                        trending decay and sorts
  validate.ts                       input parsing, limits, spam heuristics
  rate-limit.ts                     Firestore-backed sliding window
  types.ts                          domain types and status metadata

src/hooks/
  use-posts.ts                      live board query (public, or an admin scope)
  use-votes.ts                      optimistic voting
  use-post.ts                       one ticket: post, comments, events
  use-boards.ts                     live board list
  use-my-activity.ts                your ideas, comments and votes, for /me

firestore.rules                     the security model, commented
firestore.indexes.json              composite indexes for every query
scripts/seed.mjs                    boards, 18 published tickets, 2 pending
scripts/set-admin.mjs               stub; clears pre-SSO admin claims
scripts/backfill-moderation.mjs     one-off migration for boards that predate
                                    admin approval
```

---

## Design

Built on the Ryder colour system sheet. `globals.css` carries it in three
layers, and the layering is the point:

1. **The ramp.** Base 1–6 plus the brand, label, earn and UI palettes, as
   raw hex. This is the only block redefined for dark mode — the two ramps
   in the sheet are mirror images, so swapping six values swaps the theme.
2. **Roles.** `--page`, `--surface`, `--stroke`, `--ink`, `--ink-2` and the
   rest, written *once* against `--base-N`. Because they reference the ramp
   rather than a hex, they follow the theme for free. Derived states use
   `color-mix()` against `--base-6`, which darkens in light and lightens in
   dark from a single rule.
3. **A Tailwind bridge.** `@theme inline` re-exports the roles so components
   can write `bg-surface`, `text-ink-2`, `border-stroke`. `inline` keeps the
   `var()` in the generated utility, so a class re-resolves when the theme
   flips instead of being frozen at build time.

Two decisions worth flagging, both taken from the sheet rather than from
habit:

- **The primary button is Base 6, not brand blue.** The sheet maps Base 6 to
  "Text primary / Button primary", so the main action is ink-on-paper and
  paper-on-ink. Blue is kept for links, labels, focus and the voted state,
  which is what makes it mean something when it appears. `.btn-brand` exists
  if you want a blue CTA anyway.
- **Status chips use the Label pairs whole.** Each hue in the sheet ships a
  background *and* a content colour, per theme, so `StatusBadge` applies
  them directly instead of mixing its own. Six statuses against four label
  hues, so the extra separation comes from weight: the three states off the
  roadmap stay low-contrast, and `in-progress` takes the high-contrast
  Medium pair to be the loudest chip on the page.

Accessibility: real labels on every input, `aria-pressed` on the toggles,
`aria-live` on toasts, focus trapping and Escape in the dialogs, a combobox
role and `aria-activedescendant` on the command palette, a skip link, and
`prefers-reduced-motion` respected — including for the infinite vote spinner
and the confetti burst, which need their `animation-name` killed rather than
their duration clamped.

One known contrast shortfall, inherited from the sheet on purpose: the
light-theme Label green pair (`#00A354` on `#CFF8D9`) is 2.8:1 and Label red
(`#D40E23` on `#FFD9E0`) is 4.2:1, both under WCAG AA for body text. They
are the sheet's own values and the status they carry is never the only cue —
there is a dot and a text label too — but if the chips need to clear AA on
their own, those two content colours are the ones to darken.

## Keyboard

| Key | Does |
| --- | --- |
| `⌘K` / `Ctrl K` | Command palette: search ideas, jump, switch theme |
| `/` | Focus the board search |
| `N` | Suggest an idea |
| `G` then `F` / `R` / `A` | Feedback / Roadmap / Triage |
| `↑` `↓` `↵` `Esc` | Navigate, open and dismiss the palette |

Board filters are also mirrored into the query string (`?board=&status=
&sort=&q=`), so any filtered view is a shareable link.

---

## Known gaps

Deliberate omissions, roughly in the order I would add them:

- **Pagination.** The board loads up to 300 posts in one listener and
  filters by status, search and sort client-side. Filtering status here
  rather than in the query is what makes the counts on the status chips
  accurate. Fine into the low hundreds; past that it wants cursor paging
  with `startAfter`, and the counts want an aggregation query.
- **Search is client-side** over the loaded page. Real search over thousands
  of tickets needs Algolia or Typesense.
- **Analytics reads every post on each dashboard load.** Fine at board scale
  and honest about being current, but past a few thousand posts the rollup
  wants to be materialised on a schedule rather than computed per request.
  The comments-per-day series is also attributed to the day each idea was
  *submitted*, because bucketing it properly means reading every comment
  document — right for the shape of the curve, approximate for a single day,
  and labelled as such on the chart.
- **No notification when your idea is reviewed.** `/me` shows the decision
  and the reviewer's note, but the submitter has to come back and look.
  Addresses are already collected privately for exactly this.
- **Identity is per-browser.** `/me` is keyed to the anonymous Firebase uid,
  so clearing site data or switching device starts a fresh history. Real
  accounts would fix it; the page says so rather than letting someone find
  out by losing their submissions.
- **No email notifications.** Addresses are collected and stored privately
  for exactly this, but nothing sends yet. A Firebase Extension or Resend
  from a route handler is the short path.
- **No embeddable widget.** `next.config.ts` already relaxes
  `X-Frame-Options` for an `/embed` route that does not exist yet.
- **Comments cannot be edited or deleted** by their author.
- **App Check is not enabled.** See the hardening section in SETUP.md; this
  is the one I would do first.
