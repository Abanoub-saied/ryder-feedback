# Setup

Start to finish this is about fifteen minutes, most of it waiting on the
Firebase console. Steps 1 to 6 get you a working local board. Step 7 puts it
online.

Nothing here needs the Blaze (pay-as-you-go) plan. The whole thing runs on
the free Spark plan because there are no Cloud Functions — the server-side
work happens in Next.js route handlers on Vercel.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it something like `ryder-feedback`. Google Analytics is not needed;
   turn it off.
3. Wait for it to finish provisioning.

## 2. Create the Firestore database

1. In the left nav: **Build → Firestore Database → Create database**.
2. Choose **Start in production mode**. Not test mode — test mode leaves the
   database open to the world for 30 days, and the rules in this repo are
   the whole point.
3. Pick a location close to your users and create it.

You do not need to create any collections by hand. `npm run seed` does that.

## 3. Enable sign-in

1. **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab.
3. Enable **Anonymous** — every visitor, so one-vote-per-person is
   enforceable without asking anyone to register.
4. Enable **Google** — admins. Access is a verified Google account on
   `@ryder.id`, checked in `src/lib/access.ts` and again in
   `firestore.rules`.

Do not enable **Email/password** unless you have read `src/lib/access.ts`
first. The admin rule trusts a Google-issued address; a provider that lets
people choose their own address is a provider that lets people choose to be
`ceo@ryder.id`. The rule requires `sign_in_provider == 'google.com'` for
exactly this reason, and `tests/rules.test.mjs` asserts it, but the safest
version is not to turn it on.

## 4. Get your credentials

Two sets. They are different and it matters.

**Public config** (safe in the browser):

1. **Project settings** (the gear) **→ General**.
2. Under *Your apps*, click the web icon `</>` and register an app. Skip
   hosting.
3. Copy the values out of the `firebaseConfig` snippet it shows you.

**Service account** (server only, never commit):

1. **Project settings → Service accounts**.
2. Click **Generate new private key** and save the JSON file somewhere safe.
3. You need three fields from it: `project_id`, `client_email`,
   `private_key`.

Now:

```bash
cp .env.local.example .env.local
```

and fill it in. The private key spans multiple lines in the JSON — keep it
on one line in `.env.local`, wrapped in double quotes, with the `\n`
sequences left as literal backslash-n. The comments in the example file say
which console screen each value comes from.

## 5. Deploy the security rules

```bash
npm install
npx firebase login
npx firebase use --add          # pick the project you just created
npm run deploy:rules
```

That pushes `firestore.rules` and `firestore.indexes.json`. Do this before
you open the app, otherwise production mode denies every read and the board
shows a Firebase error banner.

The indexes take a minute or two to build. If the board shows an index error
in the meantime, the message contains a direct link that creates the missing
index in one click.

## 6. Seed and run

```bash
npm run seed
npm run dev
```

Open <http://localhost:3000>. You should see four boards and eighteen
published tickets spread across every status, with the roadmap populated,
plus two submissions sitting unreviewed in the admin queue.

`npm run seed` is safe to run repeatedly — it skips anything already there.
`npm run seed -- --reset` wipes all posts and users first.

### Become an admin

Open `/admin` and press **Sign in with @ryder.id**. That is the whole
process: a verified Google account on the domain is the credential, so
joining the company grants access and leaving revokes it — Workspace
suspends the account, the refresh token stops working, and the portal stops
serving them. Nobody has to remember to run anything.

Signing in *links* Google to the anonymous session already in your browser,
so the votes and submissions you made before being an admin stay yours.

An **Admin** tab appears in the header, and with it three sections:

| | |
|---|---|
| `/admin` | the review queue — approve and publish, or decline with a reason |
| `/admin/ideas` | everything published, with status editable in place |
| `/admin/analytics` | queue health, demand signal, and the submitted-to-shipped funnel |

Approve/decline controls also appear inline on any ticket you open.

There is no way in for anyone else — no allowlist, no custom claim, no env
var. That is the point of the design rather than a gap in it: access is
*derived* from the domain instead of granted, so nobody has to remember to
un-grant it. Widening it is a one-line change to `ADMIN_DOMAIN` in
`src/lib/access.ts` and the matching line in `firestore.rules`, with a diff
and a review, which is the only place that decision belongs.

The trade is worth stating plainly: if Google Workspace is down, nobody can
administer the board until it is back. Everything the public sees keeps
working — reads go straight to Firestore, and voting and submitting only
need an anonymous session.

(`scripts/set-admin.mjs` is a stub now. It grants nothing; `--revoke` still
clears a leftover `admin` claim from before this change, which no longer
does anything but is worth tidying off the accounts that hold it.)

### If you already had a board running

Posts written before admin approval existed carry no `moderation` field, and
under the new rules a post with no `isPublic` field is **not listable by the
public** — so migrate before deploying the rules:

```bash
npm run backfill              # dry run: prints what it would change
npm run backfill -- --write   # apply
npm run deploy:rules          # then publish rules + indexes
```

Existing posts become `approved`, because they are already on a live board
and people have already voted on them. Pass `--write --pending` instead if
you genuinely want to re-review the back catalogue. Either way the script is
idempotent and never overwrites a decision an admin has already made.

## 7. Deploy to Vercel

```bash
npx vercel
```

Then in the Vercel dashboard, **Settings → Environment Variables**, add
every variable from your `.env.local` for Production, Preview and
Development. Two things people get wrong here:

- **`FIREBASE_PRIVATE_KEY`**: paste it exactly as it is in `.env.local`,
  including the `\n` sequences. `src/lib/firebase/admin.ts` converts them
  back to real newlines. Do not paste a version with real line breaks.
- **`NEXT_PUBLIC_*` variables are baked in at build time.** Changing one
  requires a redeploy, not just a restart.

Finally, back in Firebase: **Authentication → Settings → Authorized
domains**, add your Vercel domain. Anonymous sign-in fails silently from an
unlisted domain, which looks exactly like "voting is broken".

---

## Running the tests

Three suites. The first needs nothing; the other two need the Firebase
emulators, which need Java 11+ installed.

```bash
npm run test:unit     # trending/sort logic, pure functions, no emulator
npm run test:rules    # security rules against the Firestore emulator
npm test              # both of the above
```

The end-to-end suite additionally boots a dev server and exercises the real
route handlers — anonymous sign-in, posting, the vote transaction, the admin
gate, a merge with overlapping voters, rate limiting:

```bash
bash scripts/make-smoke-env.sh   # once: generates .env.smoke with a throwaway key
npm run test:e2e
```

`.env.smoke` points everything at the emulators and holds a locally
generated RSA key that exists only to satisfy the Admin SDK's credential
parser — the emulator never verifies it. It is gitignored. Your real
project is never touched.

If you would rather poke at the emulators by hand:

```bash
npm run emu    # Firestore on 8080, Auth on 9099, UI on 4000
```

and set `NEXT_PUBLIC_USE_EMULATORS=1` in `.env.local` so the browser client
connects to them too.

---

## Hardening before you point real customers at it

The board is safe to ship as it stands: nobody can forge a post, inflate a
vote, or move an item onto the roadmap. Two things are worth doing before
it gets traffic.

**Turn on App Check.** Anonymous auth means one determined person can mint
new uids in a loop, and while each one only gets one vote per ticket, that
is still ballot stuffing. App Check with reCAPTCHA Enterprise attests that
requests come from your actual web app. Register it under **Build → App
Check**, then add to `src/lib/firebase/client.ts`:

```ts
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

initializeAppCheck(getFirebaseApp(), {
  provider: new ReCaptchaEnterpriseProvider(process.env.NEXT_PUBLIC_RECAPTCHA_KEY!),
  isTokenAutoRefreshEnabled: true,
});
```

and enforce it on Firestore in the console. The per-uid rate limits in
`src/lib/rate-limit.ts` are the cheap first line; App Check is the real one.

**Set a budget alert.** Firestore reads are the cost driver, and the board
uses live listeners. Nothing here is expensive at feedback-board scale, but
an alert means you find out from an email rather than from a bill.

---

## When something does not work

**Every read fails with "Missing or insufficient permissions."**
The rules are not deployed. Run `npm run deploy:rules`.

**"The query requires an index."**
A composite index is missing. The error contains a link that creates it.
`npm run deploy:rules` deploys all of them from
`firestore.indexes.json`.

**Voting returns 401.**
The browser has no Auth session. Check Anonymous sign-in is enabled
(step 3) and that your domain is in Authorized domains (step 7).

**Admin tab does not appear after granting the claim.**
ID tokens are cached for up to an hour. Sign out and back in. `/api/me`
verifies the token with `checkRevoked` on every call, so it will tell you
the truth as soon as the token refreshes.

**`FIREBASE_PRIVATE_KEY` errors on Vercel but works locally.**
The `\n` sequences were converted to real newlines somewhere in the paste.
Re-paste the single-line form.

**Seed script says credentials are missing.**
It reads `.env.local` from the directory you run it in. Run it from the
project root.
