# Guida Cloudflare per Astro Modular

Questa guida spiega perché il sito non si costruiva su Cloudflare e come
rendere un sito Astro Modular pronto al deploy con un solo comando.

## In breve

```bash
pnpm run setup:cloudflare
```

oppure, se lo script non è ancora registrato tra i comandi:

```bash
node scripts/setup-cloudflare.mjs
```

Lo script è **idempotente**: puoi lanciarlo quante volte vuoi. Cambia solo
ciò che manca e non tocca i tuoi contenuti in `src/content/`.

## Il problema

Collegando la repo a Cloudflare il build si fermava con:

```
ERROR  packages field missing or empty
```

E, superato quello, sarebbe fallito più avanti con:

```
Named export 'parseCookie' not found. The requested module 'cookie' is a CommonJS module...
```

Le cause erano due, entrambe legate a come Cloudflare installa le dipendenze
con pnpm rispetto al PC locale.

## Cosa fa lo script e perché

Lo script applica queste modifiche. Ecco cosa sono e a cosa servono.

### 1. `pnpm-workspace.yaml` → aggiunge `packages: ["."]`

```yaml
packages:
  - "."
```

**Perché:** quando esiste `pnpm-workspace.yaml`, pnpm 9/10+ pretende il campo
`packages`. Cloudflare usa una versione di pnpm che, senza quel campo, si
ferma con `packages field missing or empty`.

### 2. `package.json` → aggiunge `cookie` tra le dipendenze

```json
"cookie": "^2.0.1"
```

**Perché:** durante il build Astro importa `cookie` dal bundle di prerender.
Con pnpm le dipendenze indirette non sono visibili a livello superiore, quindi
il modulo non veniva trovato (`parseCookie not found`). Rendendola una
dipendenza diretta, pnpm la mette dove serve.

### 3. `package.json` → aggiunge lo script `setup:cloudflare`

```json
"setup:cloudflare": "node scripts/setup-cloudflare.mjs"
```

**Perché:** così puoi rilanciare il setup con `pnpm run setup:cloudflare`
anche in futuro.

### 4. `src/config.ts` → imposta `deployment.platform`

```ts
platform: "cloudflare-workers",
```

**Perché:** fa generare a `scripts/generate-deployment-config.js` i file
giusti per Cloudflare (`_redirects` e `_headers`) invece di `netlify.toml`.

### 5. `.npmrc` → rimuove il vecchio `frozen-lockfile=false`

**Perché:** era un workaround per far passare l'install. Con il lockfile
coerente non serve più. Lo script lo elimina **solo** se contiene
esclusivamente quella riga; se ci sono altre impostazioni non lo tocca e ti
avvisa.

### 6. `pnpm install`

Alla fine lo script rigenera `pnpm-lock.yaml` per allinearlo alle modifiche.
Se non vuoi (es. sei offline) usa:

```bash
node scripts/setup-cloudflare.mjs --no-install
```

**Nota sulla versione di pnpm:** lo script **non** imposta `packageManager`.
Cloudflare usa così la sua versione predefinita (oggi 9.10.0), che è quella
con cui i build funzionano. Se in futuro ti servisse pinnare una versione
diversa, aggiungi `"packageManager": "pnpm@x.y.z"` a mano e rigenera il
lockfile con quella stessa versione.

## Attenzione: branch e nome del Worker

Queste due cose non si sistemano con lo script, ma sono le cause più comuni
di "il sito non si aggiorna".

### Il branch giusto

Cloudflare pubblica **un solo branch** (production branch). Se tu lavori su
`main` ma Cloudflare deploya `master`, il sito resta fermo. Controlla in
Cloudflare → Worker → **Settings → Builds** qual è il production branch, e
assicurati che sia lo stesso branch su cui fai commit e push (di solito
`main`). Imposta lo stesso branch anche come default su GitHub
(**Settings → Branches**).

### Il nome del Worker

Il `name` in `wrangler.toml` deve combaciare con il nome del Worker nel
dashboard Cloudflare. Lo script può allinearlo:

```bash
node scripts/setup-cloudflare.mjs --worker-name mio-sito
```

Senza `--worker-name` lo script non tocca il nome (utile se è già corretto).

## Come usarlo su un nuovo sito

1. Copia la cartella `scripts/` (in particolare `setup-cloudflare.mjs`) nel
   nuovo progetto, se non c'è già.
2. Dalla cartella del progetto esegui:

   ```bash
   node scripts/setup-cloudflare.mjs
   ```

3. Controlla le modifiche:

   ```bash
   git diff
   ```

4. Committa e pusha:

   ```bash
   git add -A
   git commit -m "Cloudflare setup"
   git push
   ```

5. Su Cloudflare rilancia il deploy (se c'è l'opzione, svuota prima la build
   cache).

## Come verificare che funzioni

Nel log del deploy di Cloudflare, all'inizio, dovresti vedere:

```
Detected the following tools from environment: pnpm@12.18.0
```

invece di `pnpm@9.10.0`. E alla fine il build deve completare senza errori.

## Note importanti

- **Non tocca i contenuti:** lo script modifica solo configurazione, mai
  `src/content/`.
- **È sicuro rilanciarlo:** se una modifica è già presente, la salta.
- **Se aggiorni il tema** con `pnpm run update`, alcuni file (`package.json`,
  `pnpm-workspace.yaml`, `src/config.ts`) potrebbero essere sovrascritti.
  In quel caso rilancia `pnpm run setup:cloudflare` e ricontrolla.
- **Versione di pnpm:** se in futuro aggiorni pnpm sul PC, cambia
  `PNPM_VERSION` in cima a `scripts/setup-cloudflare.mjs` e rilancia lo script.
