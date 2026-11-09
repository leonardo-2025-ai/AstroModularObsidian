#!/usr/bin/env node

/**
 * Astro Modular — Cloudflare setup
 *
 * Rende un sito Astro Modular pronto per il deploy su Cloudflare (Workers
 * Builds) senza dover rifare a mano le stesse modifiche ogni volta.
 *
 * Cosa fa:
 *   1. pnpm-workspace.yaml -> aggiunge `packages: ["."]`
 *   2. package.json        -> aggiunge la dipendenza diretta `cookie`
 *   3. package.json        -> aggiunge `packageManager: "pnpm@<versione>"`
 *   4. package.json        -> aggiunge lo script `setup:cloudflare`
 *   5. src/config.ts       -> imposta deployment.platform = "cloudflare-workers"
 *   6. .npmrc              -> rimuove il vecchio `frozen-lockfile=false`
 *   7. pnpm install        -> rigenera il lockfile (salvo --no-install)
 *
 * Uso:
 *   node scripts/setup-cloudflare.mjs
 *   pnpm run setup:cloudflare
 *   node scripts/setup-cloudflare.mjs --no-install
 *
 * Lo script è idempotente: puoi lanciarlo quante volte vuoi, cambia solo
 * ciò che manca e non tocca i tuoi contenuti in src/content.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PNPM_VERSION = '12.18.0';
const COOKIE_RANGE = '^2.0.1';
const PLATFORM = 'cloudflare-workers';
const SETUP_SCRIPT = 'node scripts/setup-cloudflare.mjs';

const args = new Set(process.argv.slice(2));
const SKIP_INSTALL = args.has('--no-install');

const summary = [];

function step(msg) {
  console.log(`\n> ${msg}`);
}

function ok(msg) {
  summary.push({ kind: 'ok', msg });
  console.log(`  = ${msg}`);
}

function change(msg) {
  summary.push({ kind: 'change', msg });
  console.log(`  + ${msg}`);
}

function warn(msg) {
  summary.push({ kind: 'warn', msg });
  console.log(`  ! ${msg}`);
}

function detectEol(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

/* 1. pnpm-workspace.yaml ------------------------------------------------ */
function ensureWorkspace() {
  step('pnpm-workspace.yaml');
  const file = join(ROOT, 'pnpm-workspace.yaml');

  if (!existsSync(file)) {
    const content = [
      'packages:',
      '  - "."',
      '',
      'allowBuilds:',
      '  esbuild: true',
      '  sharp: true',
      '  workerd: true',
      '',
    ].join('\n');
    writeFileSync(file, content, 'utf-8');
    change('Creato con packages + allowBuilds (esbuild, sharp, workerd).');
    return;
  }

  const raw = readFileSync(file, 'utf-8');
  if (/^packages\s*:/m.test(raw)) {
    ok('Campo "packages" già presente.');
    return;
  }

  const eol = detectEol(raw);
  writeFileSync(file, `packages:${eol}  - "."${eol}${eol}${raw}`, 'utf-8');
  change('Aggiunto packages: ["."].');
}

/* 2-4. package.json ----------------------------------------------------- */
function reorderPackageManager(pkg) {
  if (!('packageManager' in pkg)) return pkg;
  const value = pkg.packageManager;
  const out = {};
  for (const [key, val] of Object.entries(pkg)) {
    if (key === 'packageManager') continue;
    out[key] = val;
    if (key === 'version') out.packageManager = value;
  }
  if (!('packageManager' in out)) out.packageManager = value;
  return out;
}

function ensurePackageJson() {
  step('package.json');
  const file = join(ROOT, 'package.json');
  const raw = readFileSync(file, 'utf-8');
  const eol = detectEol(raw);
  const pkg = JSON.parse(raw);
  let changed = false;

  // 2. cookie come dipendenza diretta
  if (!pkg.dependencies) pkg.dependencies = {};
  if (!pkg.dependencies.cookie) {
    pkg.dependencies.cookie = COOKIE_RANGE;
    changed = true;
    change(`Aggiunta dipendenza "cookie": "${COOKIE_RANGE}".`);
  } else {
    ok(`Dipendenza "cookie" già presente (${pkg.dependencies.cookie}).`);
  }

  // 3. versione di pnpm pinnata nel codice
  const wantedPnpm = `pnpm@${PNPM_VERSION}`;
  if (pkg.packageManager === wantedPnpm) {
    ok(`packageManager già impostato (${wantedPnpm}).`);
  } else {
    pkg.packageManager = wantedPnpm;
    changed = true;
    change(`Impostato packageManager: "${wantedPnpm}".`);
  }

  // 4. comando di setup
  if (!pkg.scripts) pkg.scripts = {};
  if (pkg.scripts['setup:cloudflare'] !== SETUP_SCRIPT) {
    pkg.scripts['setup:cloudflare'] = SETUP_SCRIPT;
    changed = true;
    change('Aggiunto script "setup:cloudflare".');
  } else {
    ok('Script "setup:cloudflare" già presente.');
  }

  if (changed) {
    const out = JSON.stringify(reorderPackageManager(pkg), null, 2).replace(/\n/g, eol) + eol;
    writeFileSync(file, out, 'utf-8');
  }
}

/* 5. src/config.ts ------------------------------------------------------ */
function ensurePlatform() {
  step('src/config.ts');
  const file = join(ROOT, 'src', 'config.ts');

  if (!existsSync(file)) {
    warn('src/config.ts non trovato: salto (modifica a mano necessaria).');
    return;
  }

  const raw = readFileSync(file, 'utf-8');
  if (new RegExp(`platform:\\s*"${PLATFORM}"`).test(raw)) {
    ok(`deployment.platform già "${PLATFORM}".`);
    return;
  }

  const re = /(platform:\s*)"[^"]+"(,)/;
  if (!re.test(raw)) {
    warn('Riga "platform: \"...\"," non trovata: modifica a mano necessaria.');
    return;
  }

  writeFileSync(file, raw.replace(re, `$1"${PLATFORM}"$2`), 'utf-8');
  change(`deployment.platform impostato a "${PLATFORM}".`);
}

/* 6. .npmrc ------------------------------------------------------------- */
function removeLegacyNpmrc() {
  step('.npmrc');
  const file = join(ROOT, '.npmrc');

  if (!existsSync(file)) {
    ok('Nessun .npmrc da rimuovere.');
    return;
  }

  const raw = readFileSync(file, 'utf-8');
  const meaningful = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'));

  if (meaningful.length === 1 && /^frozen-lockfile\s*=\s*false$/.test(meaningful[0])) {
    rmSync(file);
    change('Rimosso .npmrc con "frozen-lockfile=false" (workaround non più necessario).');
  } else {
    warn('.npmrc contiene altre impostazioni: non lo tocco. Controlla a mano "frozen-lockfile".');
  }
}

/* 7. pnpm install ------------------------------------------------------- */
function runInstall() {
  if (SKIP_INSTALL) {
    step('pnpm install');
    ok('Saltato (--no-install). Ricordati di lanciarlo a mano.');
    return;
  }

  step('pnpm install');
  try {
    execSync('pnpm install', { cwd: ROOT, stdio: 'inherit' });
    ok('Lockfile rigenerato con pnpm.');
  } catch {
    warn('pnpm install non riuscito: lancialo a mano prima del build.');
  }
}

/* main ------------------------------------------------------------------ */
console.log('Astro Modular — setup Cloudflare');
console.log(`Cartella progetto: ${ROOT}`);

ensureWorkspace();
ensurePackageJson();
ensurePlatform();
removeLegacyNpmrc();
runInstall();

const changed = summary.filter((item) => item.kind === 'change').length;
const warnings = summary.filter((item) => item.kind === 'warn').length;

console.log('\n────────────────────────────────────────');
if (changed === 0) {
  console.log('Tutto già a posto: nessuna modifica necessaria.');
} else {
  console.log(`Fatto: ${changed} modifica/e applicata/e.`);
}
if (warnings > 0) {
  console.log(`${warnings} avviso/i da controllare (vedi sopra).`);
}
console.log('────────────────────────────────────────');
console.log('\nProssimi passi:');
console.log('  1. Controlla le modifiche:  git diff');
console.log('  2. Committa:                git add -A && git commit -m "Cloudflare setup"');
console.log('  3. Push e redeploy su Cloudflare.');
