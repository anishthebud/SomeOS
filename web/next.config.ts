import type { NextConfig } from "next";

// The app reads/writes the markdown vault one directory up (its parent).
// Nothing special is needed for that at runtime (server-side fs), but we keep
// the config explicit so the vault root can be overridden via env if moved.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Make sure the bundled serif font is available to the icon generators.
  outputFileTracingIncludes: {
    "/icon": ["./assets/**"],
    "/apple-icon": ["./assets/**"],
  },
};

export default nextConfig;
