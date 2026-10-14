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
| Boards | How many games can be on the list at once (like 3 whiteboards), or **Unlimited** |
| Sign-ups per person | How many games one person can be on at a time (1, 2, 3…), or **Unlimited** |
| Games at the same time | Number of fields running at once |
| Heads-up alert | Minutes before the end to tell the next game to get ready (0 = off) |
| Pinnies go to | Which team gets pinnies on new games (swap per game any time) |
| Players choose their team | Otherwise names are split evenly automatically |
| Players can take their name off | Otherwise only the organizer can |

Built-in rules: nobody can sign up twice for the same game; names are unique within an event; a new board opens automatically when the current ones fill (until the board limit); ending a game clears its board and opens a fresh one — like erasing a whiteboard.

---

## Notifications on players' phones

- **Android / computers (Chrome, Edge, Firefox):** tap **Turn on** in the yellow bar and allow notifications. No install needed.
- **iPhone / iPad (iOS 16.4+):** Apple only allows web notifications for sites on the Home Screen. Open the site in Safari → Share → **Add to Home Screen** → open Next Up from the new icon → **Turn on**. The app shows these steps automatically.
- With the page open, it also beeps, vibrates and shows a banner when you're up.

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
