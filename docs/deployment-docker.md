# Deploying with Docker (Raspberry Pi / ARM)

This guide covers running R34 Browser as a Docker container on a Raspberry Pi or other ARM device.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2+
- An API key from [rule34.xxx → Account → Options](https://rule34.xxx/index.php?page=account&s=options)

The provided `Dockerfile` is multi-arch and works on both `linux/amd64` and `linux/arm64` (Raspberry Pi 3/4/5, 64-bit OS).

## 1. Clone and configure

```sh
git clone <repo-url>
cd R34App
```

Create `.env` from the template:

```sh
cp .env.example .env
```

Edit `.env` and set:

```env
API_KEY=your_api_key
USER_ID=your_user_id
```

Optional: `DB_PATH` is already set to `/app/data/r34-browser.sqlite` in `docker-compose.yaml`. The SQLite file lives in the named volume `r34app-data` so it persists across container updates.

## 2. Build and run

```sh
docker compose up -d --build
```

This will:
- Build the image
- Start the container on port 3000
- Create the persistent volume for the database

Check logs:

```sh
docker compose logs -f
```

## 3. Access on the network

From another device on the LAN:

```
http://<pi-ip>:3000
```

## 4. Updating

```sh
cd R34App
git pull
docker compose up -d --build
```

The named volume `r34app-data` preserves your likes, dismissals, seed/blocked tags, and tag metadata across updates.