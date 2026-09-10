# Lawnly su App Store e Google Play

Stato al 11/09/2026. Il codice per una build che si può pubblicare c'è. Mancano gli account, le chiavi e le decisioni che spettano alla società. Per ogni voce sotto è indicato chi deve fare cosa.

## 1. Cosa è già nel codice

| Area | Cosa c'è | Dove |
|---|---|---|
| App nativa | Capacitor 8, iOS + Android, librerie incluse nell'app (parte anche se le CDN non rispondono), API assolute verso `lawnly-app.vercel.app` | `mobile/` |
| Icone e splash | Generate per iOS e Android da un **segnaposto** (logo 250 px ingrandito) | `mobile/assets/` |
| Permessi | Posizione, fotocamera, foto, tracciamento (ATT) con testi in italiano; solo verticale; solo iPhone | `Info.plist`, `AndroidManifest.xml` |
| Cancellazione account | Vera, lato server: utente, stato, tentativi, codici, clic. Password richiesta per confermare (Apple 5.1.1(v), Google) | `api/auth.js` action `delete` |
| Recupero password | Codice di 6 cifre via email, valido 30 minuti, massimo 5 tentativi, massimo 3 richieste all'ora, nessuna rivelazione di quali email esistono | `api/auth.js` |
| Protezione login | Blocco per 15 minuti dopo 10 tentativi sbagliati | `api/auth.js` |
| Privacy e termini | Bozze complete con segnaposto `[RAGIONE SOCIALE]` ecc.: AI, pubblicità, abbonamenti, affiliazione, conservazione, diritti | `privacy.html`, `termini.html` |
| Consensi | Checkbox obbligatoria alla registrazione (termini, privacy, 14+ anni, AI); link sempre raggiungibili da login e Profilo | `index.html` |
| Avviso AI | Sotto le due chat del Dottor Verde (AI Act art. 50) | `index.html` |
| Pubblicità | AdMob con consenso GDPR (Google UMP), richiesta ATT su iPhone, banner solo per chi non è Pro, «Preferenze pubblicità» nel Profilo | `native.js` |
| Abbonamenti | RevenueCat: offerte, acquisto, «Ripristina acquisti», «Gestisci abbonamento», testo sul rinnovo automatico (Apple 3.1.2). La card resta nascosta finché non ci sono chiavi e prodotti | `native.js`, Profilo |
| Affiliazione Padana | «Acquista ↗» nei prodotti consigliati e nel catalogo; apre padanasementi.com con UTM e registra il clic per le commissioni | `lawnlyBuyPadana`, `api/track.js` |

## 2. Cosa manca, in ordine (fuori dal codice)

1. **Costituire la società.** Servono ragione sociale, sede, P.IVA e PEC.
2. **Numero D-U-N-S** (gratuito, da Dun & Bradstreet, 1-2 settimane). È obbligatorio per un account Apple aziendale.
3. **Apple Developer Program** come organizzazione (99 $/anno). **Google Play Console** come organizzazione (25 $ una tantum, con verifica dell'identità).
4. **Dominio ed email**, per esempio `lawnly.it`. Servono `supporto@`, `privacy@` e `noreply@`. Ospitare `privacy.html` e `termini.html` sul dominio.
5. **Resend** (email). Verificare il dominio, poi su Vercel impostare `RESEND_API_KEY` e `MAIL_FROM="Lawnly <noreply@dominio>"`. Senza, il recupero password risponde «non ancora attivo».
6. **AdMob.** Creare l'account a nome della società, due app (iOS e Android) e due unità banner. Poi:
   - sostituire gli ID di test in `Info.plist` (`GADApplicationIdentifier`) e `AndroidManifest.xml` (`APPLICATION_ID`);
   - impostare le unità reali con `testing:false` in `window.LAWNLY_NATIVE_CONFIG`;
   - configurare in AdMob il messaggio GDPR (Privacy e messaggi) e pubblicare `app-ads.txt` sul dominio.
7. **Abbonamenti.**
   - Decidere cosa include Pro oltre a «niente pubblicità». Oggi il Profilo mostra solo quello (`window.LAWNLY_PRO_PERKS`).
   - Creare i prodotti su App Store Connect e Play Console.
   - Su RevenueCat: entitlement `pro`, un'offering *current* con i pacchetti, chiavi pubbliche iOS/Android in `LAWNLY_NATIVE_CONFIG.revenuecat`.
8. **Accordo con Padana Sementi.** Serve una percentuale scritta e un modo in cui Padana riconosce le vendite (UTM, codice affiliato o coupon). Oggi l'app registra i clic nella tabella `lawnly_affiliate_clicks`: bastano per la riconciliazione solo se Padana accetta le UTM. Se il dominio di destinazione cambia, aggiornare `AFFILIATE_HOSTS` su Vercel.
9. **Legale.** Far validare privacy e termini, completare i segnaposto, firmare le DPA con i fornitori (Anthropic, Vercel, Neon, Google, RevenueCat, Resend) e tenere il registro dei trattamenti.
10. **Grafica.** Icona definitiva 1024×1024 senza trasparenza (Luca) in `mobile/assets/icon-only.png`, poi `npm run assets`. Screenshot per le schede (vedi §4).
11. **Identificativo app.** Oggi è `it.lawnly.app`. **Dopo il primo caricamento non si cambia più**: confermarlo prima (di solito è il dominio al contrario).
12. **Android.** Installare Android Studio (include il JDK) e creare la chiave di firma *upload*: **conservarla in modo sicuro, perderla blocca gli aggiornamenti**. Il progetto Android esiste, ma su questo Mac non è mai stato compilato.

## 3. Come si fa una build

```bash
cd mobile
npm install
npm run sync          # copia la web app in www/, librerie in locale, cap sync
npm run ios           # Xcode → Product → Archive → Distribute (firma automatica col team della società)
npm run android       # Android Studio → Build → Generate Signed App Bundle (.aab)
```
A ogni rilascio: aumentare *Version* e *Build* in Xcode, e `versionCode`/`versionName` in `android/app/build.gradle`.
Le modifiche alla web app vanno anche su Vercel: l'app usa le API di produzione.

## 4. Schede store (bozza)

- **Nome** (max 30): `Lawnly – Cura del prato`
- **Sottotitolo iOS** (max 30): `Irrigazione e piano del prato`
- **Parole chiave iOS** (max 100): `prato,giardino,irrigazione,concime,erba,tappeto erboso,meteo,semina,arieggiatura,agronomo`
- **Categoria**: Apple *Stile di vita* (secondaria *Meteo*), Google *Casa e giardino*
- **Età**: Apple 4+, Google PEGI 3. Dichiarare la presenza di pubblicità.
- **URL**: privacy `https://<dominio>/privacy.html`; supporto `https://<dominio>` o `mailto:supporto@`; termini (EULA) linkati anche nella descrizione, obbligatorio con abbonamenti.
- **Descrizione breve**: «Sai quando irrigare, cosa fare questa settimana e quali prodotti usare: il tuo prato curato con meteo locale e intelligenza artificiale.»
- **Screenshot**:
  - iPhone 6.9" 1320×2868, da 3 a 10;
  - Android telefono, almeno 2;
  - feature graphic Android 1024×500.
  - Si ricavano dal simulatore iOS 17 Pro Max.

## 5. Questionari privacy degli store

**Apple — App Privacy**

| Tipo di dato | Uso | Collegato all'utente | Tracciamento |
|---|---|---|---|
| Email | Funzionalità dell'app | Sì | No |
| Posizione precisa (coordinate del giardino) | Funzionalità dell'app | Sì | No |
| Foto | Funzionalità dell'app | Sì | No |
| Altri contenuti dell'utente (chat, dati del prato) | Funzionalità dell'app | Sì | No |
| ID utente | Funzionalità dell'app | Sì | No |
| Cronologia acquisti | Funzionalità dell'app | Sì | No |
| Interazione con il prodotto (clic sui link Padana) | Pubblicità o marketing dello sviluppatore | Sì | No |
| ID dispositivo (IDFA) | Pubblicità di terzi | Sì | **Sì**, solo con consenso ATT |
| Dati pubblicitari | Pubblicità di terzi | No | **Sì** |

**Google — Sicurezza dei dati**: stesse categorie. Dati cifrati in transito: sì. L'utente può chiedere la cancellazione: sì, dall'app. Il link web richiesto da Google per chi non ha più l'app è `https://<dominio>/privacy.html` §7 (accesso da web → Profilo → Elimina account, oppure email a privacy@).

## 6. Note per la revisione Apple (da incollare)

> Lawnly helps Italian homeowners care for their lawn (local weather, water balance, treatment calendar, AI lawn advisor). Demo account: `review@<dominio>` / `<password>` (create it on production before submitting).
> Account deletion: Profile → "Account e dati" → "Elimina account".
> Subscriptions use In-App Purchase (RevenueCat). "Ripristina acquisti" is in Profile.
> Links "Acquista su Padana Sementi" open the partner's web store for **physical goods** (fertilizers, seeds), allowed under guideline 3.1.5(a); we earn an affiliate commission.
> Ads: Google AdMob with UMP consent and App Tracking Transparency.
> AI answers are generated by Anthropic Claude and labelled as such in the chat.

## 7. Limiti noti (scelte consapevoli)

- **Solo iPhone e solo verticale**: niente screenshot iPad. Il layout tablet esiste; riattivarlo con `TARGETED_DEVICE_FAMILY = "1,2"` quando serve.
- **Banner**: parte 96 px sopra il bordo per non coprire la barra di navigazione. La posizione va verificata su telefono vero con annunci reali.
- **Limite domande AI**: non tiene conto di Pro, perché il server non conosce l'abbonamento. Serve un webhook RevenueCat → Neon se Pro deve dare più domande.
- **Notifiche push**: non incluse, non servono per l'approvazione.
- **Offline**: senza rete l'app si apre ma non carica meteo e dati.
- **Cancellazione da Profilo**: la password si inserisce in un prompt di sistema, visibile in chiaro. Da sostituire con un foglio dedicato se i tester lo segnalano.
