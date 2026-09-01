import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt-in for opening the dev server from another device on the LAN
  // (e.g. a phone): set ALLOWED_DEV_ORIGIN to that device-facing IP.
  ...(process.env.ALLOWED_DEV_ORIGIN
    ? { allowedDevOrigins: [process.env.ALLOWED_DEV_ORIGIN] }
    : {}),
};

export default nextConfig;
