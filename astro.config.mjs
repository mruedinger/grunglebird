import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://grunglebird.com',
  output: 'server',
  adapter: cloudflare(),
  redirects: {
    // Points at the current event; temporary so it's free to move next season.
    '/donate': { status: 302, destination: '/events/framily-beach-bar-2026' },
  },
});
