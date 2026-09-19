import type { MetadataRoute } from "next";

// Web app manifest — makes the site installable as a standalone app (the
// home-screen "app" experience). iOS uses the apple-icon + apple meta tags;
// Android/Chrome use this manifest. Colors match the dark notebook theme.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SomeOS",
    short_name: "SomeOS",
    description: "Private, filesystem-backed knowledge system.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#111514",
    theme_color: "#111514",
    icons: [
      // SVG scales crisply to any size (Dock/Launchpad); PNG fallback for
      // browsers that want a raster icon at install time.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
