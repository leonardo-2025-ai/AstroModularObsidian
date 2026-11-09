/**
 * Astro 6 dev: when content files change, call the content layer refresh API
 * then full-reload so the next request gets fresh getCollection/render.
 * Uses the official 'astro:server:setup' refreshContent helper.
 */
import type { AstroIntegration } from 'astro';
import path from 'node:path';

export default function refreshContentOnChange(): AstroIntegration {
  return {
    name: 'astro-modular-refresh-content-on-change',
    hooks: {
      'astro:server:setup': async ({ server, refreshContent }) => {
        if (typeof refreshContent !== 'function') return;

        const contentDir = path.resolve(process.cwd(), 'src', 'content').replace(/\\/g, '/');
        server.watcher.add(contentDir);

        const handle = async (file: string) => {
          const normalized = path.normalize(file).replace(/\\/g, '/');
          if (!normalized.startsWith(contentDir)) return;
          try {
            await refreshContent({});
          } catch (_) {
            // refreshContent may not exist or signature may differ; still reload
          }
          server.ws.send({ type: 'full-reload' });
        };

        server.watcher.on('change', handle);
        server.watcher.on('add', handle);
        server.watcher.on('unlink', handle);
      },
    },
  };
}
