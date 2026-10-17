# Notifications

Squelch can send a push notification when something notable happens on your channels: a working fire, a pursuit, an aircraft in trouble. It uses standard **Web Push**, so there's no app to install and no third-party account. Messages are end-to-end encrypted on their way through the browser maker's push service (Apple, Google or Mozilla).

## How it decides

- Every transmission updates its channel's **story** (subject, key facts, chronology), and the same AI call scores the story from 0 to 1 for how much it deserves a notification. There's no extra AI cost.
- Each browser has its own **sensitivity**: Quiet (0.8+, major events), Normal (0.6+, significant incidents) or Chatty (0.4+). Its **favourite channels** count 1.4× toward that.
- **One notification per story.** Another one comes only if the story escalates (its score rises by 0.25 or more), and it replaces the earlier one on the device.
- At most 6 an hour per browser, except major events (0.9+).
- Tapping a notification opens the receiver on that story.

### Learning what you care about

Each browser learns from its own notifications. Every notification counts as evidence about its **channel** and its **story type** (fire, medical, pursuit, aviation…):

| What you did | Evidence |
|---|---|
| **More like this** | +2 |
| **Fewer like this** | −2 |
| Opened it and stayed 60 s or more | +1 (15 s or more: +0.5; less: 0) |
| Didn't open it within 30 minutes | −0.5 (ignored) |

- Evidence fades by half every 14 days, so preferences drift back to neutral.
- Each channel and type ends up with a weight from ×0.25 to ×2. A notification's score is multiplied by the average of its two.
- Ignoring alone can't push a weight below ×0.76: ignored kinds stop reaching borderline scores but keep coming for big events. Only **Fewer** goes all the way down to ×0.25.
- A major event (0.9+) on a favourite channel always gets through.

Where to give feedback:
- **Android and desktop:** More/Fewer buttons on the notification itself.
- **Everywhere:** the story card the notification opens has a "Worth a notification?" row. iPhone notifications have no buttons, so this is the iPhone route.

The bell's card lists **What I've learned**, e.g. "×2 aviation stories", with a **Reset** button.

Squelch records only what it needs for this, per browser, on your own server: when a notification was opened, for how long the page stayed in view (up to 10 minutes), and your More/Fewer choices.

### Listener surges

Every 3 minutes Squelch reads each Broadcastify feed's listener count, minus its own recorder. It learns each feed's usual audience: the median for that hour and weekday over 4 weeks, falling back to that hour of day over a week, then the last day. So surge detection starts after about a day of history.

- A surge is at least 3× usual and +5 listeners, with 6 or more tuned in.
- It triggers one closer-look AI call on the channel's current story, which can raise its score. The story card then shows a fact like "Listeners: 21 (usually 2)", and the notification says "11× usual listeners".
- If nothing has been transcribed on that channel lately (or it's a listen-only feed), a surge of 5× usual and 10+ listeners becomes its own "Listener surge" story.
- At most one closer look per feed every 45 minutes. Set `LISTENER_POLL_S=0` in `.env` to turn surge detection off.

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
