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
  window.LawnlyNative = { isNative, platform: isNative ? cap.getPlatform() : 'web', openExternal };
})();
