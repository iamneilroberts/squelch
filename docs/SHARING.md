# Sharing your receiver

Squelch runs on your own machine. To let a few people in from outside your network, put it behind a **Cloudflare Tunnel** (no open ports) and **Cloudflare Access** (only the emails you list get in). You need a domain on Cloudflare; Access is free for small teams.

## 1. Tunnel + Access (about 15 minutes)

1. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. In the Cloudflare dashboard → **Zero Trust → Access → Applications → Add → Self-hosted**: domain `scanner.example.com`, policy **Allow** with **Include → Emails** = the people you're inviting, login method **One-time PIN**. Create this *before* step 4 so the site is never public.
3. **Zero Trust → Networks → Tunnels → Create**, name it `squelch`, add a public hostname `scanner.example.com` → `http://127.0.0.1:8077`. Copy the tunnel token into a private file (`chmod 600`).
4. Run the connector: `cloudflared tunnel --no-autoupdate run --token-file /path/to/token`.
5. Check from a phone off your Wi-Fi: you should get the Cloudflare login page, then the receiver.

## 2. Who sees what

| | Your LAN | Owners (in `OWNER_EMAILS`) | Other invited visitors |
|---|---|---|---|
| Map, incidents, daily log, Scan | ✓ | ✓ | ✓ |
| Raw transcripts + Raw traffic tab | ✓ | ✓ | only while the **Remote transcripts** switch is on |
| Flip the Remote transcripts switch | ✓ | ✓ | — |
| Live audio on the dial | your Broadcastify account | your Broadcastify account | **their own** Broadcastify Premium login (kept in memory only) |

Set owners in `.env`: `OWNER_EMAILS=you@example.com`. Squelch reads the signed-in email from the `Cf-Access-Authenticated-User-Email` header Cloudflare Access adds; anyone who reaches the app without the tunnel is treated as LAN, so don't expose port 8077 directly.

## 3. Keep it running (systemd, Linux)

`~/.config/systemd/user/squelch.service`:

```ini
[Unit]
Description=Squelch scanner receiver
After=network-online.target

[Service]
WorkingDirectory=/home/you/squelch
Environment=PORT=8077
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning --env-file-if-exists=.env src/server.mjs
KillSignal=SIGTERM
TimeoutStopSec=15
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`~/.config/systemd/user/squelch-tunnel.service`:

```ini
[Unit]
Description=Cloudflare tunnel for Squelch
After=network-online.target squelch.service

[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate run --token-file /home/you/.cloudflared/squelch.token
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload`, `systemctl --user enable --now squelch squelch-tunnel`, and `loginctl enable-linger $USER` so they start at boot without a login. SIGTERM lets Squelch stop its ffmpeg readers cleanly.
