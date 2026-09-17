# Deploying with Docker (Raspberry Pi / ARM)

This guide covers running R34 Browser as a Docker container on a Raspberry Pi or other ARM device.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2+
- An API key from [rule34.xxx → Account → Options](https://rule34.xxx/index.php?page=account&s=options)

Published images are built for `linux/amd64` and `linux/arm64` (Raspberry Pi 3/4/5, 64-bit OS), and the `Dockerfile` builds on both as well.

## 1. Configure

You need `docker-compose.yaml` and a `.env` next to it — a clone is optional:

```sh
curl -O https://raw.githubusercontent.com/Akana404/R34App/main/docker-compose.yaml
```

Create `.env` with your credentials:

```env
API_KEY=your_api_key
USER_ID=your_user_id
```

Optional: `DB_PATH` is already set to `/app/data/r34-browser.sqlite` in `docker-compose.yaml`. The SQLite file lives in the named volume `r34app-data` so it persists across container updates.

## 2. Run

```sh
docker compose up -d
```

This pulls `ghcr.io/akana404/r34app:latest`, starts the container on port 3000
and creates the persistent volume for the database. Pin a version instead of
`latest` by editing the `image:` line (for example `:1.0`).

### Building from source instead

If you'd rather build the image yourself, clone the repository and add the
build overlay:

```sh
git clone <repo-url> && cd R34App
cp .env.example .env    # then fill in API_KEY and USER_ID
docker compose -f docker-compose.yaml -f docker-compose.build.yaml up -d --build
```

Check logs:

```sh
docker compose logs -f
```

The server stays quiet by design: Next.js logs no requests in production, and
the app only writes a line when something is worth knowing — rate limiting by
the rule34 API (429), missing credentials, an upstream error or timeout, and
every backup import with the counts it kept. No news really is good news here.
Add `-t` if you want timestamps.

## 3. Access on the network

From another device on the LAN:

```
http://<pi-ip>:3000
```

## 4. Updating

```sh
docker compose pull
docker compose up -d
```

Building from source instead:

```sh
git pull
docker compose -f docker-compose.yaml -f docker-compose.build.yaml up -d --build
```

The named volume `r34app-data` preserves your likes, dismissals, seed/blocked tags, and tag metadata across updates.

To get your data off the container — before a rebuild, or to move to another
machine — use **Export** on the Liked page. That downloads everything but the
caches as a JSON file, and **Import** puts it back. Reaching into the volume for
the SQLite file works too, but the buttons don't need a shell.