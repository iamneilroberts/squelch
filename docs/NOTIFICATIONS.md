# Notifications

Squelch can send a push notification when something notable happens on your channels: a working fire, a pursuit, an aircraft in trouble. It uses standard **Web Push**, so there's no app to install and no third-party account. Messages are end-to-end encrypted on their way through the browser maker's push service (Apple, Google or Mozilla).

## How it decides

- Every transmission updates its channel's **story** (subject, key facts, chronology), and the same AI call scores the story from 0 to 1 for how much it deserves a notification. There's no extra AI cost.
- Each browser has its own **sensitivity**: Quiet (0.8+, major events), Normal (0.6+, significant incidents) or Chatty (0.4+). Its **favourite channels** count 1.4× toward that.
- **One notification per story.** Another one comes only if the story escalates (its score rises by 0.25 or more), and it replaces the earlier one on the device.
- At most 6 an hour per browser, except major events (0.9+).
- Tapping a notification opens the receiver on that story.

## Set up (once, about 5 minutes)

1. Generate a key pair and add it to `.env`:
   ```
   npm run vapid >> .env
   ```
2. In `.env`, change `VAPID_SUBJECT` to your email (`mailto:you@example.com`) or your site's `https://` address. Push services use it to contact you if something goes wrong.
3. Restart Squelch.
4. Push needs a secure page: `https://`, or `http://localhost` on the machine itself. A plain `http://192.168.x.x` LAN address won't work. The Cloudflare Tunnel in [SHARING.md](SHARING.md) gives you `https://`.
5. Open the receiver and tap the **bell** on the speaker grille, then **Turn on**. Pick a sensitivity and star your favourite channels. **Send a test** checks the whole path.

Keep the keys: if they change, every browser has to turn notifications on again.

## On iPhone and iPad

iOS only delivers web push to sites added to the Home Screen (iOS 16.4 or later):

1. Open the receiver in Safari, tap **Share → Add to Home Screen**.
2. Open it from the Home Screen icon (not from Safari).
3. Tap the bell → **Turn on**, and allow notifications.

## Guests

Only owners can turn notifications on: anyone on your LAN, plus `OWNER_EMAILS` through Cloudflare Access. To let tunnel guests try them as a demo, open the bell and tick **Let guests turn on notifications**. Each guest's browser gets its own sensitivity and favourites. Untick it to stop sending to guests; their subscriptions are kept, so ticking it again resumes them.

Notifications carry the story's subject, its "why" and a couple of key facts: the same information as the story card. They never include raw transcripts.

## Troubleshooting

- **No bell on the grille:** guests only see it while guest notifications are on. Owners always see it; it explains if keys are missing.
- **"Not set up on this receiver yet":** the VAPID keys aren't in `.env`, or Squelch wasn't restarted.
- **Test doesn't arrive:** check the browser and the operating system allow notifications for the site. On a Mac, check System Settings → Notifications for your browser.
- **Notifications stopped after a while:** browsers sometimes expire subscriptions. Squelch removes dead ones automatically; turn notifications on again.
