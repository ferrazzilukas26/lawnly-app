# Lawnly: cosa serve per pubblicare

Stato al 17/11/2026, branch `lancio-fase0`. Sostituisce la versione dell'11/09: pubblicità, abbonamenti e affiliazione non fanno più parte del lancio.

**Strategia (decisa il 20/10):** app gratuita, senza pubblicità né ricavi, senza società. Prima la **web app** sul dominio, poi **Google Play solo nei Paesi UE**: il nome «LAWNLY» è registrato negli USA da un'altra app dello stesso settore, mentre in UE e Italia risulta libero (TMview, 17/11). App Store dopo.

## 1. Cosa c'è già

| Area | Cosa c'è | Dove |
|---|---|---|
| Account | Registrazione con consenso (termini, privacy, 14+ anni, IA); login bloccato dopo 10 tentativi; max 10 registrazioni al giorno per rete; recupero password con codice | `api/auth.js`, `index.html` |
| Cancellazione account | In app (Profilo → Account e dati) **e da web senza app**: `/elimina-account.html` | `api/auth.js`, `elimina-account.html` |
| IA | Etichette «Assistente IA» e «Generato da IA»; **segnalazione delle risposte dentro l'app** (va sulla bacheca, visibile solo all'admin); quota per utente + tetto globale; all'IA solo il comune | `index.html`, `api/ai.js` |
| Privacy tecnica | Funzioni a Francoforte; coordinate ~1 km verso il meteo; foto senza metadati; niente librerie o font da siti esterni; CSP | `vercel.json`, `api/ai.js`, `vendor/` |
| Attribuzioni | Open-Meteo (CC BY 4.0) e OpenStreetMap nella schermata Meteo | `index.html` |
| App nativa | Capacitor 8, solo plugin App e Browser; **APK di prova compila** (17/11) | `mobile/` |
| Privacy e termini | Aggiornati al lancio gratuito, **ancora con segnaposto e «BOZZA»** | `privacy.html`, `termini.html` |

## 2. Cosa manca, in ordine

🔴 blocca la pubblicazione · 🟡 prima di crescere

### Web app pubblica

| # | Cosa | Chi | |
|---|---|---|---|
| 1 | Merge di `lancio-fase0` su `main` (= deploy), poi prova su produzione (anche la nuova `BOARD_ADMIN_KEY`) | Lukas, poi verifica Claude | 🔴 |
| 2 | Limite di spesa mensile nella console Anthropic | Lukas | 🔴 |
| 3 | Comprare `lawnly.it` (libero il 17/11) | Lukas | 🔴 |
| 4 | Collegare il dominio a Vercel; verificarlo su Resend; `MAIL_FROM=Lawnly <noreply@lawnly.it>`; **togliere `RESET_RELAY_TO`** | Claude, con accesso ai DNS | 🔴 |
| 5 | Caselle `privacy@` e `supporto@` (bastano inoltri) | Lukas | 🔴 |
| 6 | Titolare del trattamento (persona fisica o i tre soci) → compilare i segnaposto, togliere «BOZZA» | Soci decidono, Claude scrive | 🔴 |
| 7 | Lettura di un avvocato su privacy e termini | Soci | 🔴 |
| 8 | Vercel Pro (il piano gratuito vieta l'uso commerciale) | Lukas | 🔴 |
| 9 | Risposta di Open-Meteo (bozza della mail: report del 16/11 §6.3) | Lukas | 🔴 |
| 10 | DPA di Anthropic, Vercel, Neon, Resend; zero data retention ad Anthropic | Lukas | 🟡 |
| 11 | Deposito del marchio (UIBM ~150 €/classe o EUIPO ~850 €; classi 9 e 42) | Soci | 🟡 |
| 12 | Sostituire Nominatim con Geoapify (Nominatim non ammette app in produzione) | Claude | 🟡 |

### Google Play (in più)

| # | Cosa | Chi | |
|---|---|---|---|
| 13 | Account Play Console (25 $) + verifica dell'identità; il nome dell'editore è pubblico | Lukas | 🔴 |
| 14 | Icona definitiva 1024×1024 senza trasparenza (oggi: logo 250 px ingrandito) in `mobile/assets/icon-only.png`, poi `npm run assets` | Luca | 🔴 |
| 15 | Chiave di firma *upload*, **conservata in due posti** (persa = niente aggiornamenti) | Lukas con Claude | 🔴 |
| 16 | Build `.aab` firmata | Claude | 🔴 |
| 17 | Scheda: testi (§4), almeno 2 schermate telefono, grafica 1024×500 | Claude bozza, Luca grafica | 🔴 |
| 18 | Questionari: sicurezza dei dati (§5), classificazione dei contenuti, pubblico (consigliato 18+ per evitare le regole «Famiglie»), app con IA | Lukas compila | 🔴 |
| 19 | **Test chiuso: almeno 12 tester per 14 giorni consecutivi** | Soci trovano i tester | 🔴 |
| 20 | Paesi: **solo UE** | Lukas | 🔴 |

## 3. Build

Strumenti installati il 17/11 con Homebrew (niente Android Studio):

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd mobile && npm install && npm run sync     # web app in www/ + progetti nativi
cd android && ./gradlew assembleDebug        # prova (APK non per lo store)
cd android && ./gradlew bundleRelease        # store: serve la chiave del punto 15
```

A ogni rilascio: `versionCode`/`versionName` in `android/app/build.gradle`. L'app usa le API di produzione (`LAWNLY_API_BASE` in `build.mjs`): il backend va in produzione prima della build. Nota: `npm run assets` rigenera solo iOS e web; lo sfondo dell'icona Android è il colore `ic_launcher_background` (`#F4F1E8`).

## 4. Scheda Google Play (bozza)

- **Nome**: `Lawnly – Cura del prato` · **Descrizione breve**: `Quando irrigare e cosa fare questa settimana: meteo locale e assistente IA.`
- **Categoria**: Casa e giardino · **Annunci**: no · **Acquisti in-app**: no
- **Privacy**: `https://<dominio>/privacy.html` · **Cancellazione account**: `https://<dominio>/elimina-account.html`
- **Descrizione**: bilancio idrico con meteo locale; irrigazioni registrate da sole copiando la centralina di casa; calendario delle operazioni; magazzino prodotti; Dottor Verde, assistente basato su IA che può sbagliare e non sostituisce l'etichetta; foto del prato analizzate solo se lo attivi. Marchi citati solo per identificare i prodotti.

## 5. Sicurezza dei dati (Google): risposte proposte

| Dato | Raccolto | Condiviso* | Obbligatorio | Scopo |
|---|---|---|---|---|
| Email | Sì | No | Sì | Gestione account |
| Posizione precisa (coordinate del giardino) | Sì | No | Sì | Funzionalità |
| Foto | Sì | No | No | Funzionalità |
| Altri contenuti (chat, dati del prato) | Sì | No | Sì | Funzionalità |
| ID utente | Sì | No | Sì | Gestione account |

\* Anthropic, Vercel, Neon e Open-Meteo trattano i dati per nostro conto («fornitori di servizi»). Cifratura in transito: sì. Cancellazione: sì, in app e da web. Nessun annuncio né ID pubblicitario.

## 6. Limiti noti

- Senza rete l'app si apre ma non carica dati (nessun service worker): va bene per web e Play, pesa per l'App Store (regola 4.2).
- La cancellazione in app chiede la password in un prompt di sistema, in chiaro.
- Niente notifiche push.
- Le anteprime Vercel non hanno variabili d'ambiente: le API funzionano solo in produzione.
