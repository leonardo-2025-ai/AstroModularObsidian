import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const astroCacheDir = path.join(projectRoot, '.astro');
const viteCacheDir = path.join(projectRoot, 'node_modules', '.vite');

console.log('⚙️ Setting up development environment...');

// Wipe .astro completely so content layer and route cache are fresh every dev run
try {
  if (existsSync(astroCacheDir)) {
    console.log(`Cleaning .astro cache: ${astroCacheDir}`);
    rmSync(astroCacheDir, { recursive: true, force: true });
  }
  mkdirSync(astroCacheDir, { recursive: true });
} catch (error) {
  console.error(`Failed to clean .astro: ${error.message}`);
}

// Wipe Vite deps cache so modules are re-resolved
try {
  const viteDeps = path.join(viteCacheDir, 'deps');
  if (existsSync(viteDeps)) {
    console.log(`Cleaning Vite deps cache: ${viteDeps}`);
    rmSync(viteDeps, { recursive: true, force: true });
  }
  if (!existsSync(viteCacheDir)) {
    mkdirSync(viteCacheDir, { recursive: true });
  }
} catch (error) {
  console.error(`Failed to clean Vite cache: ${error.message}`);
}

console.log('✅ Development environment setup complete.');
