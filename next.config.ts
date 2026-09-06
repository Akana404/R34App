import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: it has to stay an external require on
  // the server instead of being bundled, or the .node binding never resolves.
  serverExternalPackages: ["better-sqlite3"],

  // Opt-in for opening the dev server from another device on the LAN
  // (e.g. a phone): set ALLOWED_DEV_ORIGIN to that device-facing IP.
  ...(process.env.ALLOWED_DEV_ORIGIN
    ? { allowedDevOrigins: [process.env.ALLOWED_DEV_ORIGIN] }
    : {}),
};

export default nextConfig;
