# Guida Cloudflare per Astro Modular

Questa guida raccoglie **tutto** quello che è stato fatto per far funzionare il
sito su Cloudflare partendo da Obsidian, i problemi incontrati e come risolverli.
Serve anche come promemoria per un nuovo sito o per quando qualcosa smette di
aggiornarsi.

## In breve

```bash
# su un nuovo sito / dopo aver aggiornato il tema
pnpm run setup:cloudflare
# oppure
node scripts/setup-cloudflare.mjs
```

Lo script è **idempotente**: puoi lanciarlo quante volte vuoi, cambia solo ciò
che manca e non tocca i contenuti in `src/content/`.

---

## La catena di pubblicazione

```
Obsidian (modifichi una nota)
   ↓  Obsidian Git (commit + push)
GitHub (branch main)
   ↓  Cloudflare Workers Builds
Cloudflare (build + deploy)
   ↓
Sito online
```

Quando "il sito non si aggiorna", il problema è quasi sempre in uno di questi
punti. Controlla nell'ordine:

1. **GitHub ha la modifica?** Guarda il branch giusto: `main`, non `master`.
2. **Cloudflare ha fatto un build su quel commit?** Guarda i "check" del commit
   su GitHub o la sezione Builds del Worker.
3. **Il build è riuscito?** Se fallisce, il sito resta alla versione precedente.
4. **Cloudflare pubblica lo stesso branch su cui pushi?** Deve essere `main`.
5. **Il nome del Worker combacia?** `wrangler.toml` ↔ dashboard Cloudflare.

---

## Configurazione Cloudflare (una volta sola)

Questi passaggi non li fa lo script: sono nella dashboard.

### 1. Collega la repo e scegli il branch giusto

1. Cloudflare → **Workers & Pages** → Worker del sito
   (`astromodularobsidian`).
2. **Settings → Builds**.
3. Verifica che la repo sia `leonardo-2025-ai/AstroModularObsidian` e che il
   **Production branch** sia **`main`** (non `master`).
4. Build command: `pnpm run build`.
5. Deploy command: `npx wrangler deploy` (default).

> Se il production branch è `master` ma tu lavori su `main`, il sito non si
> aggiornerà mai. Questo è stato il problema principale.

### 2. Imposta `main` come branch di default su GitHub

GitHub → repo → **Settings → Branches → Default branch** → `main`.

Così la pagina GitHub mostra la versione giusta e non ti confonde.

### 3. Chiudi eventuali Pull Request inutili

Se vedi una PR tipo "Main" da `main` a `master`, chiudila (**Close pull
request**). Non serve e non cancella nulla. **Non** fare "Merge".

### 4. Il nome del Worker deve combaciare

Il `name` in `wrangler.toml` deve essere uguale al nome del Worker nel
dashboard. Lo script può allinearlo:

```bash
node scripts/setup-cloudflare.mjs --worker-name astromodularobsidian
```

---

## Cosa fa lo script e perché

### 1. `pnpm-workspace.yaml` → `packages: ["."]`

```yaml
packages:
  - "."
```

**Perché:** quando esiste `pnpm-workspace.yaml`, pnpm pretende il campo
`packages`. Senza, il build si ferma con `packages field missing or empty`.

### 2. `pnpm-workspace.yaml` → `minimumReleaseAge: 0`

```yaml
minimumReleaseAge: 0
```

**Perché:** pnpm 11+ rifiuta i pacchetti pubblicati da meno di 24 ore
(`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). Il lockfile del sito viene
rigenerato con pnpm 9.10.0 (la versione di Cloudflare), che non applica questa
policy e può includere versioni recentissime. Con `0` il PC locale (pnpm 12)
accetta il lockfile; pnpm 9 su Cloudflare ignora la chiave.

### 3. `package.json` → dipendenza diretta `cookie`

```json
"cookie": "^2.0.1"
```

**Perché:** durante il build Astro importa `cookie` dal bundle di prerender.
Con pnpm le dipendenze indirette non sono visibili a livello superiore, quindi
il modulo non veniva trovato (`Named export 'parseCookie' not found`).
Rendendola una dipendenza diretta, pnpm la mette dove serve.

### 4. `package.json` → script `setup:cloudflare`

```json
"setup:cloudflare": "node scripts/setup-cloudflare.mjs"
```

**Perché:** così puoi rilanciare il setup con `pnpm run setup:cloudflare`.

### 5. `src/config.ts` → `deployment.platform`

```ts
platform: "cloudflare-workers",
```

**Perché:** fa generare a `scripts/generate-deployment-config.js` i file giusti
per Cloudflare (`_redirects` e `_headers`) invece di `netlify.toml`.

### 6. `wrangler.toml` → nome del Worker (solo con `--worker-name`)

**Perché:** il nome deve combaciare con quello nel dashboard, altrimenti il
deploy fallisce.

### 7. `.npmrc` → rimuove `frozen-lockfile=false`

**Perché:** era un vecchio workaround. Con il lockfile coerente non serve più.
Lo script lo elimina **solo** se contiene esclusivamente quella riga.

### 8. `pnpm install`

Rigenera `pnpm-lock.yaml`. Se sei offline:

```bash
node scripts/setup-cloudflare.mjs --no-install
```

---

## Problemi incontrati e soluzioni (troubleshooting)

### `packages field missing or empty`

Il build Cloudflare si ferma subito dopo `pnpm install --frozen-lockfile`.
**Soluzione:** aggiungi `packages: ["."]` in `pnpm-workspace.yaml` (lo fa lo
script).

### `Named export 'parseCookie' not found`

Il build arriva al prerender e fallisce. **Soluzione:** aggiungi `cookie` come
dipendenza diretta in `package.json` (lo fa lo script).

### Il sito resta vecchio / "su GitHub non arriva la modifica"

Non è GitHub: è il **branch**. Cloudflare pubblica `master`, ma tu pushi su
`main`.
**Soluzione:** imposta il production branch di Cloudflare su `main` e il default
branch di GitHub su `main`.

### Il build fallisce con "name must match the name of your Worker"

Il `name` in `wrangler.toml` non combacia con il Worker del dashboard.
**Soluzione:** `node scripts/setup-cloudflare.mjs --worker-name <nome-worker>`.

### `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` in locale

pnpm 12 blocca pacchetti pubblicati da meno di 24h presenti nel lockfile.
**Soluzione:** `minimumReleaseAge: 0` in `pnpm-workspace.yaml` (lo fa lo
script).

### `cross-env non è riconosciuto`

Conseguenza di un `pnpm install` fallito: `node_modules` è disallineato.
**Soluzione:** sistema il problema dell'install, poi rilancia `pnpm install`.

### Obsidian Git chiede sempre quale account usare

Ci sono più account GitHub salvati. **Soluzione:** imposta l'utente corretto:

```bash
git config --global credential.https://github.com.username leonardo-2025-ai
```

Se continua, rimuovi l'altro account dal Gestore credenziali di Windows
(Start → "Gestore credenziali" → Credenziali Windows → elimina la voce
`terapiapsicologicaeu-ai`).

### La versione di pnpm su Cloudflare non è quella del PC

Cloudflare Workers Builds usa pnpm 9.10.0 di default. **Non** forzare
`packageManager` in `package.json`: è stato provato e ha creato problemi.
Lascia che Cloudflare usi il suo default e tieni il lockfile compatibile con
pnpm 9.

---

## Come usarlo su un nuovo sito

1. Copia `scripts/setup-cloudflare.mjs` nel nuovo progetto (se non c'è).
2. Dalla cartella del progetto:

   ```bash
   node scripts/setup-cloudflare.mjs --worker-name <nome-worker>
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

5. Nella dashboard Cloudflare imposta il **Production branch** su `main`.

---

## Checklist "tra due mesi" (se qualcosa non va)

- [ ] Sto pushando sul branch che Cloudflare pubblica? (`main`)
- [ ] GitHub mostra `main` come default?
- [ ] Il build Cloudflare è verde o rosso? Se rosso, apri il log.
- [ ] `pnpm-workspace.yaml` ha `packages: ["."]` e `minimumReleaseAge: 0`?
- [ ] `package.json` ha `cookie` nelle dependencies?
- [ ] `wrangler.toml` `name` = nome del Worker nel dashboard?
- [ ] `src/config.ts` ha `platform: "cloudflare-workers"`?
- [ ] In locale `pnpm install` funziona? Se no, rilancia
      `pnpm run setup:cloudflare`.
- [ ] Obsidian Git chiede l'account? Controlla
      `git config --global credential.https://github.com.username`.

---

## Note importanti

- **Non tocca i contenuti:** lo script modifica solo configurazione, mai
  `src/content/`.
- **È sicuro rilanciarlo:** salta ciò che è già presente.
- **Se aggiorni il tema** con `pnpm run update`, alcuni file (`package.json`,
  `pnpm-workspace.yaml`, `src/config.ts`) potrebbero essere sovrascritti.
  Rilancia `pnpm run setup:cloudflare` e ricontrolla la checklist.
- **Versione di pnpm:** se in futuro cambi la versione di pnpm sul PC, rigenera
  il lockfile con la stessa versione che usa Cloudflare (9.10.0) oppure allinea
  `packageManager` con attenzione.
