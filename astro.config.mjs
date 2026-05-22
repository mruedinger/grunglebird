import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://grunglebird.com',
  output: 'server',
  adapter: cloudflare(),
});
