// Ponte verso Capacitor (app nativa). Sul web: isNative=false e i link si aprono in una nuova scheda.
// Pubblicità (AdMob) e abbonamenti (RevenueCat) tolti per il lancio gratuito: la versione completa
// è nella storia git (native.js al commit a1c941a), da riprendere al primo accordo con un marchio.
(() => {
  'use strict';
  const cap = window.Capacitor;
  const isNative = !!cap?.isNativePlatform?.();
  async function openExternal(url) {
    try {
      if (isNative) await cap.Plugins.Browser.open({ url });
      else window.open(url, '_blank', 'noopener');
    } catch (error) { console.warn('[native] openExternal', error); }
  }
  // Promemoria: notifica locale per ogni intervento del calendario non fatto/saltato, all'ora scelta
  // (default 8:00) del giorno stesso o del giorno prima. Niente server: le programma il telefono.
  // Ricalcolate a ogni salvataggio del calendario, al rientro nell'app, al cambio impostazioni e al logout.
  // Impostazioni solo su questo telefono (localStorage lw_reminders): le notifiche sono del dispositivo.
  const DONE = /^(eseguit|complet|done|confirmed|fatt|saltat|skipped)/i;
  const PREFS_KEY = 'lw_reminders';
  const numId = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h & 0x7fffffff) || 1; }; // positivo e dentro int32 (Android)
  function getReminderPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { p = {}; }
    return { on: p.on !== false, time: /^\d{2}:\d{2}$/.test(p.time) ? p.time : '08:00', dayBefore: p.dayBefore === true };
  }
  function setReminderPrefs(patch) {
    const p = { ...getReminderPrefs(), ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
    syncReminders(undefined, true); // scelta dell'utente: qui si può richiedere il permesso
    return p;
  }
  // Stato del permesso: 'granted' | 'denied' | 'prompt' | ... ; sul web 'web'.
  async function reminderPermission() {
    if (!isNative) return 'web';
    try { return (await cap.Plugins.LocalNotifications.checkPermissions()).display; } catch { return 'unknown'; }
  }
  function plan(events, prefs, now) {
    const [hh, mm] = prefs.time.split(':').map(Number);
    return (Array.isArray(events) ? events : [])
      .filter((e) => e && (e.date || e.dt) && !e.done && !e.completed && !DONE.test(e.status || ''))
      .map((e) => { const [y, m, d] = String(e.date || e.dt).slice(0, 10).split('-').map(Number); return { e, at: new Date(y, m - 1, d - (prefs.dayBefore ? 1 : 0), hh, mm) }; })
      .filter((x) => !isNaN(x.at) && x.at.getTime() > now)
      .sort((a, b) => a.at - b.at)
      .slice(0, 60); // ponytail: iOS tiene max 64 notifiche in coda; si ricalcola a ogni apertura
  }
  let timer = null, seq = 0, askNext = false, asking = null;
  // ask=true solo da un gesto dell'utente: all'avvio il permesso si chiede una volta sola ('prompt'),
  // mai di nuovo da solo dopo un rifiuto. seq: vince l'ultimo ricalcolo anche se uno vecchio è fermo su un await.
  function syncReminders(events, ask) {
    if (!isNative) return;
    clearTimeout(timer);
    askNext = askNext || !!ask;
    timer = setTimeout(async () => {
      const run = ++seq, canAsk = askNext;
      askNext = false;
      const stale = () => run !== seq;
      try {
        const LN = cap.Plugins.LocalNotifications;
        const prefs = getReminderPrefs();
        let loggedIn = false;
        try { loggedIn = !!localStorage.getItem('lawnly_jwt'); } catch {}
        if (!events) { try { events = JSON.parse(localStorage.getItem('dss_calendar_events') || '[]'); } catch { events = []; } }
        // dopo il logout i dati restano in locale: niente promemoria di chi è uscito
        const list = prefs.on && loggedIn ? plan(events, prefs, Date.now()) : [];
        let perm = list.length ? await LN.checkPermissions() : null;
        if (perm && (perm.display === 'prompt' || (canAsk && perm.display === 'prompt-with-rationale'))) perm = await (asking ||= LN.requestPermissions().finally(() => { asking = null; })); // una finestra di permesso per volta
        if (stale()) return;
        const pending = (await LN.getPending()).notifications;
        if (stale()) return;
        if (pending.length) await LN.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
        if (!list.length || perm.display !== 'granted' || stale()) return;
        const head = prefs.dayBefore ? 'Domani per il tuo prato: ' : 'Oggi per il tuo prato: ';
        const seen = new Set();
        await LN.schedule({ notifications: list.map(({ e, at }) => {
          let id = numId(e.id || (e.date || e.dt) + (e.name || e.title || ''));
          while (seen.has(id)) id = (id % 2147483646) + 1; // id doppi = una notifica sovrascrive l'altra
          seen.add(id);
          return {
            id,
            title: head + (e.name || e.title || e.product || e.type || 'intervento'),
            body: [e.product && e.product !== (e.name || e.title) ? e.product : '', e.dose ? 'Dose ' + e.dose : ''].filter(Boolean).join(' · ') || 'Apri Lawnly per i dettagli.',
            schedule: { at, allowWhileIdle: true },
            // inesatto (pochi minuti di tolleranza): niente permesso «Sveglie e promemoria», che su Android 12+
            // aprirebbe le Impostazioni a ogni ricalcolo
            isExactNotification: false,
          };
        }) });
      } catch (error) { console.warn('[native] syncReminders', error); }
    }, 1500);
  }
  if (isNative) {
    syncReminders();
    cap.Plugins.App?.addListener?.('resume', () => syncReminders());
  }
  window.LawnlyNative = { isNative, platform: isNative ? cap.getPlatform() : 'web', openExternal, syncReminders, getReminderPrefs, setReminderPrefs, reminderPermission };
})();
