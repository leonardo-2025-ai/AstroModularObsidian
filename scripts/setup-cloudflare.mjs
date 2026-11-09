#!/usr/bin/env node

/**
 * Astro Modular — Cloudflare setup
 *
 * Rende un sito Astro Modular pronto per il deploy su Cloudflare (Workers
 * Builds) senza dover rifare a mano le stesse modifiche ogni volta.
 *
 * Cosa fa:
 *   1. pnpm-workspace.yaml -> aggiunge `packages: ["."]` e `minimumReleaseAge: 0`
 *   2. package.json        -> aggiunge la dipendenza diretta `cookie`
 *   3. package.json        -> aggiunge lo script `setup:cloudflare`
 *   4. src/config.ts       -> imposta deployment.platform = "cloudflare-workers"
 *   5. wrangler.toml       -> allinea il nome al Worker (con --worker-name)
 *   6. .npmrc              -> rimuove il vecchio `frozen-lockfile=false`
 *   7. pnpm install        -> rigenera il lockfile (salvo --no-install)
 *
 * Nota: NON impostiamo `packageManager`, così Cloudflare usa la sua versione
 * di pnpm predefinita (9.10.0), che è quella con cui i build funzionano.
 * Se vuoi comunque pinnarla, aggiungi `"packageManager": "pnpm@..."` a mano.
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

const COOKIE_RANGE = '^2.0.1';
const PLATFORM = 'cloudflare-workers';
const SETUP_SCRIPT = 'node scripts/setup-cloudflare.mjs';

const args = new Set(process.argv.slice(2));
const SKIP_INSTALL = args.has('--no-install');

// Nome del Worker su Cloudflare (deve combaciare con il nome nel dashboard).
// Esempio: node scripts/setup-cloudflare.mjs --worker-name astromodularobsidian
const workerNameIndex = process.argv.indexOf('--worker-name');
const WORKER_NAME = workerNameIndex !== -1 ? process.argv[workerNameIndex + 1] : null;

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
      'minimumReleaseAge: 0',
      '',
      'allowBuilds:',
      '  esbuild: true',
      '  sharp: true',
      '  workerd: true',
      '',
    ].join('\n');
    writeFileSync(file, content, 'utf-8');
    change('Creato con packages + minimumReleaseAge + allowBuilds.');
    return;
  }

  let raw = readFileSync(file, 'utf-8');
  const eol = detectEol(raw);
  let changed = false;

  // `packages` è richiesto da pnpm quando esiste pnpm-workspace.yaml.
  if (!/^packages\s*:/m.test(raw)) {
    raw = `packages:${eol}  - "."${eol}${eol}${raw}`;
    changed = true;
    change('Aggiunto packages: ["."].');
  } else {
    ok('Campo "packages" già presente.');
  }

  // pnpm 11+ blocca i pacchetti pubblicati da meno di 24h; il lockfile del
  // sito può contenerli perché viene rigenerato con pnpm 9.10.0 (Cloudflare).
  if (!/^minimumReleaseAge\s*:/m.test(raw)) {
    raw = `minimumReleaseAge: 0${eol}${eol}${raw}`;
    changed = true;
    change('Aggiunto minimumReleaseAge: 0 (evita ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION in locale).');
  } else {
    ok('minimumReleaseAge già impostato.');
  }

  if (changed) writeFileSync(file, raw, 'utf-8');
}

/* 2-4. package.json ----------------------------------------------------- */
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

  // 3. comando di setup
  if (!pkg.scripts) pkg.scripts = {};
  if (pkg.scripts['setup:cloudflare'] !== SETUP_SCRIPT) {
    pkg.scripts['setup:cloudflare'] = SETUP_SCRIPT;
    changed = true;
    change('Aggiunto script "setup:cloudflare".');
  } else {
    ok('Script "setup:cloudflare" già presente.');
  }

  // 5. nome del Worker (solo se passato con --worker-name)
  if (WORKER_NAME && pkg.name !== WORKER_NAME) {
    pkg.name = WORKER_NAME;
    changed = true;
    change(`Impostato name: "${WORKER_NAME}" (deve combaciare col Worker Cloudflare).`);
  } else if (WORKER_NAME) {
    ok(`name già allineato al Worker ("${WORKER_NAME}").`);
  }

  if (changed) {
    const out = JSON.stringify(pkg, null, 2).replace(/\n/g, eol) + eol;
    writeFileSync(file, out, 'utf-8');
  }
}

/* 5b. wrangler.toml ------------------------------------------------------ */
function ensureWranglerName() {
  step('wrangler.toml');
  const file = join(ROOT, 'wrangler.toml');

  if (!WORKER_NAME) {
    ok('Nome Worker non specificato (usa --worker-name <nome> se serve).');
    return;
  }

  if (!existsSync(file)) {
    warn('wrangler.toml non trovato: verrà creato al primo build.');
    return;
  }

  const raw = readFileSync(file, 'utf-8');
  if (new RegExp(`^name\\s*=\\s*"${WORKER_NAME}"`, 'm').test(raw)) {
    ok(`name = "${WORKER_NAME}" già presente.`);
    return;
  }

  if (!/^name\s*=\s*"[^"]*"/m.test(raw)) {
    warn('Riga "name = ..." non trovata in wrangler.toml: modifica a mano.');
    return;
  }

  writeFileSync(file, raw.replace(/^name\s*=\s*"[^"]*"/m, `name = "${WORKER_NAME}"`), 'utf-8');
  change(`wrangler.toml name impostato a "${WORKER_NAME}".`);
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
ensureWranglerName();
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
