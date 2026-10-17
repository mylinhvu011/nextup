# Next Up — pickup game board (Cloudflare, free)

A live, phone-friendly replacement for the sign-up whiteboards at pickup games. It runs on **Cloudflare Workers + Durable Objects** and fits comfortably in Cloudflare's **free plan** — no credit card, no server to keep running.

- **Organizers** create an account, start an event for the day, set the rules, and run the games: start/pause timers, add or remove time, end & clear a game, swap pinnies, reorder games, add walk-ups, remove people, send announcements.
- **Players** open the site, type the event's **4-digit code** (or the organizer's custom password) and **just their name**. They see who's on the field, the line, and who has pinnies, and they get **push notifications**:
  - "You're signed in as …" when they turn alerts on
  - "You're up next!" when their game reaches the front of the line
  - "Get ready" a few minutes before the current game ends (configurable)
  - "You're on!" when the current game's time runs out
  - "Game N is on — you're on the pinnies team" when their game starts
  - Organizer announcements
- Every phone updates **live**, no refreshing.

---

## Put it online (about 10 minutes, free)

You need a computer with **Node.js 18+** (download from nodejs.org) and a free **Cloudflare account** (dash.cloudflare.com/sign-up).

1. Unzip this folder and open a terminal in it.
2. Install the tools:
   ```bash
   npm install
   ```
3. Log in to Cloudflare (opens your browser):
   ```bash
   npx wrangler login
   ```
4. Open `wrangler.jsonc` and change `VAPID_SUBJECT` to your email (e.g. `"mailto:you@gmail.com"`). Push services use it to contact you if something goes wrong.
5. Deploy:
   ```bash
   npm run deploy
   ```
   The first time, Wrangler may ask you to pick a free `workers.dev` subdomain. When it finishes it prints your address, like
   `https://next-up.<your-subdomain>.workers.dev` — that's the site. Share it, or print the QR code from the organizer screen.

That's it. To update later, edit the files and run `npm run deploy` again — events, accounts and phones' alert sign-ups are kept.

### Lock down organizer sign-ups (recommended)
By default anyone who finds the site could create an organizer account. To require a code:
```bash
npx wrangler secret put MANAGER_SIGNUP_CODE
```
Type a code when asked. New organizers then need that code to create an account.

### Email for account recovery (password reset, forgot username)

Organizers sign up with an email so they can reset a forgotten password or get their username sent to them. To actually send those emails, connect one free email service. Until you do, the forgot-password screens show a note that email isn't set up yet.

**Option A: Brevo (no domain needed).** Free plan: 300 emails a day; free emails carry a small "Sent with Brevo" footer.
1. Sign up at brevo.com.
2. Add and verify a sender: Senders, Domains & Dedicated IPs → Senders → Add a sender (use the email you want resets to come from).
3. Create an API key: SMTP & API → API Keys → Generate.
4. Run `npx wrangler secret put BREVO_API_KEY` and paste the key.
5. In `wrangler.jsonc`, set `"MAIL_FROM"` to the sender email you verified, then `npm run deploy`.

**Option B: Resend (needs a domain you own).** Free plan: 3,000 emails a month, 100 a day.
1. Sign up at resend.com, add your domain and add the DNS records it shows.
2. Create an API key, then run `npx wrangler secret put RESEND_API_KEY`.
3. Set `"MAIL_FROM"` to an address on that domain (e.g. `noreply@yourdomain.com`), then `npm run deploy`.

Optional: set `APP_URL` (e.g. `https://next-up.yourname.workers.dev`) if you want reset links to always use one address. Reset links work once, for 1 hour, and at most one is sent per account per minute. Resetting or changing a password signs the organizer out on every other device.

Test it: on the organizer sign-in page tap **Forgot password?**, enter your username, and check your inbox (and spam folder).

### Use your own domain (optional)
In the Cloudflare dashboard → Workers & Pages → next-up → Settings → Domains & Routes → Add custom domain.

---

## Run it on your own computer

```bash
npm install
npm run dev        # opens http://localhost:8787
npm test           # checks the rules, live updates, timers and push encryption
```

---

## Organizer settings (per event, changeable any time)

| Setting | What it does |
|---|---|
| Players per team | 5 = 5v5 = 10 names per game |
| Game length | Timer length in minutes |
| Boards in the line | How many waiting games are shown at once (like 3 whiteboards). The line is always filled to this number with empty boards; the game on the field doesn't count. Or **Unlimited** |
| Sign-ups per person | How many games one person can be on at a time (1, 2, 3…), or **Unlimited** |
| Games at the same time | Number of fields running at once |
| Event ends | After a number of hours (default 12) or at a set time; then it closes on its own and frees the code |
| Heads-up alert | Minutes before the end to tell the next game to get ready (0 = off) |
| Pinnies go to | Which team gets pinnies on new games (swap per game any time) |
| Players choose their team | Otherwise names are split evenly automatically |
| Players can take their name off | Otherwise only the organizer can |
| Friends each player can add | Players tap **+ Add a friend** on a game to put a friend's name down (unlimited by default; 0 turns it off). The person who added them can pick and switch the friend's team or take them off a waiting game, and gets the friend's alerts. If the friend joins on their own phone with that name, the spot becomes theirs. |
| Colors | Pick a scheme (Pitch green, Midnight, Crimson, Royal, Ocean, Sunset) or your own main / highlight / pinnie colors. Every phone on the event updates instantly when you save. |

**Last call:** the organizer can tap 🏁 **Last call** to stop new boards from being added. Games already on the board still play out, people can still take open spots on them, and everyone gets a notification. When the last game ends the organizer is told it's a wrap; **Reopen the line** undoes it.

**Event end:** every event closes on its own so a forgotten event doesn't keep its code or stay live overnight. By default that's **12 hours after it opens**; in Settings → Event you can pick a different length (1–24 hours) or **an end time** (e.g. 10:30 PM, in your time zone). The event screen shows when it will close, with **Keep open 1 more hour** if games run late. When it closes, the code is freed, the organizer gets an alert, and players see that it's closed for the day. Ended events can't be reopened — start a new event (the code can be reused right away).

**Repeating events:** on New event, choose **When → Repeats**: how often (every week, every 2 weeks… up to 8), which days, when games start, when sign-ups open (at start time up to 2 hours before), a first date and an optional last date. Each date opens on its own as a normal event with the same settings and **the same code every time**, then closes at its end time. Between dates the code says *"No game right now. Tuesday Night Pickup is next on Tue, Oct 27 at 6:30 PM."* The code stays reserved for the repeating event, so no other event can take it. From the repeating event's page you can skip a date (and undo), **Open now** (starts an extra event right away with the same code; scheduled dates aren't used up — if today is a scheduled date, that date just opens early), change the name, days, time or game settings (applies from the next date), see past dates, or **Stop repeating** (frees the code; past dates stay in your events).

Built-in rules: nobody can sign up twice for the same game; names are unique within an event. With a board count of 3, the line always shows 3 waiting boards (empty or filling up); when a game starts it moves to the field and a fresh empty board joins the end of the line. Lowering the count only removes empty boards. With Unlimited, a new board opens whenever every board is full.

---

## Notifications on players' phones

- **Android / computers (Chrome, Edge, Firefox):** tap **Turn on** in the yellow bar and allow notifications. No install needed.
- **iPhone / iPad (iOS 16.4+):** Apple only allows web notifications for sites on the Home Screen. Open the site in Safari → Share → **Add to Home Screen** → open Next Up from the new icon → **Turn on**. The app shows these steps automatically.
- With the page open, it also beeps, vibrates and shows a banner when you're up.
- The alerts banner stays at the top with **Turn on / Turn off**, so anyone can opt out (and back in) any time. Organizers have the same toggle for their own time's-up alerts.

---

### Getting it on phones as an app
- Phones see a **"Get it as an app first"** card on the join screens (code and name) and on organizer sign-in, linking to a **help page** (`/#/install`) with steps for the exact phone and browser. On Android, Chrome's one-tap **Add to Home Screen** button appears right in the card.
- Joined in the browser first? On iPhone the Home Screen app doesn't share sign-ins with Safari, so the help page gives a **move code** (6 letters, single use, 30 minutes). Typing it into the app's code box signs them in as the same person with the same game spots — no second name.

---

## Will it stay free?

Cloudflare's free plan allows 100,000 requests a day plus generous Durable Object limits. A pickup night with 50 players uses a tiny fraction of that:

- Phones stay connected with WebSockets that "hibernate" when nothing is happening, so idle time costs nothing.
- Game timers use Durable Object alarms — the server only wakes up when a timer needs to fire.
- Notifications are sent in batches of 40 to stay inside the free plan's per-request limits.

If you ever go over a daily limit, requests fail until midnight UTC — you're never charged unless you upgrade.

---

## How it's built

```
src/index.js      Worker: routes /api/* to the right Durable Object; everything else is the website
src/registry.js   Registry DO (one): organizer accounts, sessions, join codes, push keys
src/room.js       EventRoom DO (one per event): rules, timers (alarms), live WebSockets, push queue
src/webpush.js    Web Push for Workers (VAPID + aes128gcm encryption) using WebCrypto
public/           The installable web app (HTML/CSS/JS, service worker, icons) — no build step
test/             Push encryption check + full end-to-end test against `wrangler dev`
wrangler.jsonc    Cloudflare config (free-plan SQLite Durable Objects)
```

Push-notification keys are created automatically on first use and stored in the Registry, so there are no secrets to set up. If you prefer to manage them yourself, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as Wrangler secrets.
