# Deploying on a Raspberry Pi

This guide covers running R34 Browser as a persistent service on a Raspberry Pi.

> Faster route: a prebuilt `linux/arm64` image is published for every release,
> so the Pi never has to run `next build` or compile `better-sqlite3`. See the
> [Docker guide](deployment-docker.md). The steps below are for running it
> directly under systemd instead.

## 1. Install Node.js

Node.js >= 20.9 is required. Using [nvm](https://github.com/nvm-sh/nvm) is the simplest path:

```sh
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22
```

`better-sqlite3` is a native module. Most Pi models (64-bit OS) get a prebuilt binary automatically. On 32-bit installs, or if no prebuilt binary is available, `npm ci` falls back to compiling it, which needs build tools:

```sh
sudo apt install build-essential python3
```

## 2. Clone and install

```sh
git clone <repo-url>
cd R34App
npm ci
```

## 3. Configure environment

```sh
cp .env.example .env
```

Edit `.env` and set `API_KEY` and `USER_ID` (see [rule34.xxx → Account → Options](https://rule34.xxx/index.php?page=account&s=options)).

Optionally set `DB_PATH` if the SQLite file should live outside `data/` — for example on an external SSD instead of the SD card, to reduce write wear.

## 4. Build

```sh
npm run build
```

This also runs the TypeScript check.

## 5. Run as a systemd service

Create `/etc/systemd/system/r34-browser.service`:

```ini
[Unit]
Description=R34 Browser
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/r34-browser
ExecStart=/usr/bin/npm run start
Restart=always
User=pi
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Adjust `WorkingDirectory`, `User`, and the `npm` path (`which npm`) to match your setup.

Enable and start it:

```sh
sudo systemctl enable --now r34-browser
```

Check status/logs:

```sh
sudo systemctl status r34-browser
journalctl -u r34-browser -f
```

Expect a quiet log: Next.js logs no requests in production, and the app only
writes a line for something worth knowing — rate limiting by the rule34 API
(429), missing credentials, an upstream error or timeout, and every backup
import with the counts it kept.

## 6. Access on the network

Next.js listens on port 3000 by default. From another device on the LAN:

```
http://<pi-ip>:3000
```

For port 80/443 or a domain with HTTPS, put nginx (or Caddy) in front as a reverse proxy.

## Updating

```sh
cd r34-browser
git pull
npm ci
npm run build
sudo systemctl restart r34-browser
```

Use **Export** on the Liked page to pull your likes, dismissals, seed and
blocked tags off the Pi as a JSON file, and **Import** to put them back.
Copying the SQLite file under `data/` (or `DB_PATH`) works as a backup too.