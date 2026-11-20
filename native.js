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
  // Promemoria: notifica locale alle 8:00 del giorno di ogni intervento non fatto/saltato del calendario.
  // Niente server: il telefono le programma da solo. Ricalcolate a ogni salvataggio del calendario e al rientro nell'app.
  const DONE = /^(eseguit|complet|done|confirmed|saltat|skipped)/i;
  const numId = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) || 1; };
  let timer = null;
  function syncReminders(events) {
    if (!isNative) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const LN = cap.Plugins.LocalNotifications;
        if (!events) { try { events = JSON.parse(localStorage.getItem('dss_calendar_events') || '[]'); } catch { events = []; } }
        const now = Date.now();
        const list = (Array.isArray(events) ? events : [])
          .filter((e) => e && (e.date || e.dt) && !e.done && !e.completed && !DONE.test(e.status || ''))
          .map((e) => { const [y, m, d] = String(e.date || e.dt).slice(0, 10).split('-').map(Number); return { e, at: new Date(y, m - 1, d, 8, 0) }; })
          .filter((x) => x.at.getTime() > now)
          .sort((a, b) => a.at - b.at)
          .slice(0, 60); // ponytail: iOS tiene max 64 notifiche in coda; si ricalcola a ogni apertura
        const pending = (await LN.getPending()).notifications;
        if (pending.length) await LN.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
        if (!list.length) return;
        let perm = await LN.checkPermissions();
        if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') perm = await LN.requestPermissions();
        if (perm.display !== 'granted') return;
        await LN.schedule({ notifications: list.map(({ e, at }) => ({
          id: numId(e.id || (e.date || e.dt) + (e.name || '')),
          title: 'Oggi per il tuo prato: ' + (e.name || e.product || 'intervento'),
          body: [e.product && e.product !== e.name ? e.product : '', e.dose ? 'Dose ' + e.dose : ''].filter(Boolean).join(' · ') || 'Apri Lawnly per i dettagli.',
          schedule: { at, allowWhileIdle: true },
        })) });
      } catch (error) { console.warn('[native] syncReminders', error); }
    }, 1500);
  }
  if (isNative) {
    syncReminders();
    cap.Plugins.App?.addListener?.('resume', () => syncReminders());
  }
  window.LawnlyNative = { isNative, platform: isNative ? cap.getPlatform() : 'web', openExternal, syncReminders };
})();
