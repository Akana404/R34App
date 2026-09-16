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

## 5. Backup / Restore

The SQLite database is the single source of truth. To back up:

```sh
docker compose exec r34app cat /app/data/r34-browser.sqlite > backup.sqlite
```

To restore on a fresh instance:

```sh
docker compose down
docker volume rm r34app_r34app-data
docker compose up -d
docker compose exec -T r34app cat > /app/data/r34-browser.sqlite < backup.sqlite
docker compose restart r34app
```

## 6. Troubleshooting

**Port already in use**
```sh
# Check what's on 3000
ss -ltnp | grep :3000
# Or change the port in docker-compose.yaml
```

**Permission denied on volume**
```sh
# The container runs as UID 1001. If you bind-mount instead of using a named volume:
# chown -R 1001:1001 ./data
```

**API returns 429 (rate limited)**
The upstream API rate limits per IP. The app surfaces this as a "rate limited" banner in the grid. Wait a few minutes or reduce concurrent requests.

**Container exits immediately**
```sh
docker compose logs r34app
# Common cause: missing API_KEY / USER_ID in .env
```

**Database migration after update**
The app handles schema changes automatically on startup. No manual migration needed.