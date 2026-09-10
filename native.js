(() => {
  'use strict';
  const cap = window.Capacitor;
  const isNative = !!cap?.isNativePlatform?.();
  const platform = isNative ? cap.getPlatform() : 'web';
  const plugins = () => window.Capacitor?.Plugins;
  const warn = (...args) => console.warn('[native]', ...args);
  const overrides = window.LAWNLY_NATIVE_CONFIG || {};
  const config = {
    ...overrides,
    admob: {
      bannerIos: 'ca-app-pub-3940256099942544/2934735716',
      bannerAndroid: 'ca-app-pub-3940256099942544/6300978111',
      testing: true, bottomMargin: 96, ...overrides.admob
    },
    revenuecat: { iosKey: '', androidKey: '', entitlement: 'pro', ...overrides.revenuecat }
  };
  let pro = false, configured = false, ready = false, consent = null, initPromise;
  // rcUser = identità confermata da RevenueCat; currentUser = utente Lawnly loggato
  let rcUser = null, currentUser = null;
  let bannerExists = false, bannerVisible = false, bannerWanted = false;
  let bannerQueue = Promise.resolve();
  const subscribers = new Set();
  try { pro = window.localStorage.getItem('lawnly_pro') === '1'; }
  catch (error) { warn('cache pro', error); }

  // Serializza creazione, sospensione e ripresa del banner.
  function syncBanner() {
    bannerQueue = bannerQueue.then(async () => {
      if (!isNative) return;
      const show = bannerWanted && ready && !pro && consent?.canRequestAds === true;
      try {
        const ads = plugins().AdMob;
        if (show && !bannerVisible) {
          if (bannerExists) await ads.resumeBanner();
          else {
            await ads.showBanner({
              adId: platform === 'ios' ? config.admob.bannerIos : config.admob.bannerAndroid,
              adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER',
              margin: config.admob.bottomMargin, isTesting: config.admob.testing
            });
            bannerExists = true;
          }
          bannerVisible = true;
        } else if (!show && bannerVisible) {
          await ads.hideBanner();
          bannerVisible = false;
        }
      } catch (error) { warn('banner', error); }
    });
    return bannerQueue;
  }
  function showBanner() { bannerWanted = true; return syncBanner(); }
  function hideBanner() { bannerWanted = false; return syncBanner(); }
  async function updatePro(customerInfo) {
    const next = !!customerInfo.entitlements.active[config.revenuecat.entitlement];
    const changed = next !== pro;
    pro = next;
    try { window.localStorage.setItem('lawnly_pro', pro ? '1' : '0'); }
    catch (error) { warn('cache pro', error); }
    if (!changed) return;
    const banner = pro ? hideBanner() : showBanner();
    subscribers.forEach(cb => {
      try { cb(pro); } catch (error) { warn('onProChange', error); }
    });
    await banner;
  }
  async function refresh() {
    if (!isNative || !configured || rcUser !== currentUser) return;
    try { await updatePro((await plugins().Purchases.getCustomerInfo()).customerInfo); }
    catch (error) { warn('getCustomerInfo', error); }
  }
  // UMP determina la regione reale, senza forzare una geografia di debug.
  function init(userId) {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!isNative) return;
      try { await plugins().AdMob.initialize({ initializeForTesting: config.admob.testing }); }
      catch (error) { warn('initialize', error); }
      try { consent = await plugins().AdMob.requestConsentInfo(); }
      catch (error) { warn('requestConsentInfo', error); }
      try {
        if (consent?.status === 'REQUIRED' && consent.isConsentFormAvailable)
          consent = await plugins().AdMob.showConsentForm();
      } catch (error) { warn('showConsentForm', error); }
      try {
        if (platform === 'ios' &&
            (await plugins().AdMob.trackingAuthorizationStatus()).status === 'notDetermined')
          await plugins().AdMob.requestTrackingAuthorization();
      } catch (error) { warn('trackingAuthorization', error); }
      try {
        const apiKey = platform === 'ios' ? config.revenuecat.iosKey : config.revenuecat.androidKey;
        if (apiKey) {
          await plugins().Purchases.configure({ apiKey,
            ...(userId != null ? { appUserID: String(userId) } : {}) });
          configured = true;
          rcUser = currentUser = userId != null ? String(userId) : null;
        }
      } catch (error) { warn('configure', error); }
      await refresh();
      ready = true;
      try { if (!pro) await showBanner(); }
      catch (error) { warn('showBanner', error); }
    })();
    return initPromise;
  }
  async function changeUser(method, options) {
    currentUser = method === 'logIn' ? String(options.appUserID) : null;
    if (isNative && configured) {
      try {
        const r = await plugins().Purchases[method](options);
        rcUser = currentUser;
        await updatePro(r.customerInfo);
      } catch (error) {
        warn(method, error);
        // identità non allineata: niente Pro ereditato dall'account precedente, acquisti bloccati
        rcUser = undefined;
        await updatePro({ entitlements: { active: {} } });
        return;
      }
    }
    await refresh();
  }
  async function packages() {
    if (!isNative || !configured) return [];
    return (await plugins().Purchases.getOfferings()).current?.availablePackages || [];
  }
  async function getOffers() {
    try {
      return (await packages()).map(p => ({ id: p.identifier, title: p.product.title,
        price: p.product.priceString, period: p.product.subscriptionPeriod || '' }));
    } catch (error) { warn('getOfferings', error); return []; }
  }
  async function buy(id) {
    if (!currentUser || rcUser !== currentUser)
      return { ok: false, cancelled: false, message: 'Account acquisti non ancora pronto: riprova tra qualche secondo.' };
    try {
      const aPackage = (await packages()).find(p => p.identifier === id);
      if (!aPackage) throw new Error('Pacchetto non disponibile');
      await updatePro((await plugins().Purchases.purchasePackage({ aPackage })).customerInfo);
      return { ok: true };
    } catch (error) {
      warn('purchasePackage', error);
      return { ok: false, cancelled: error?.userCancelled === true || String(error?.code) === '1',
        message: error?.message || String(error) };
    } finally { await refresh(); }
  }
  async function restore() {
    if (isNative && configured && currentUser && rcUser === currentUser) {
      try { await updatePro((await plugins().Purchases.restorePurchases()).customerInfo); }
      catch (error) { warn('restorePurchases', error); }
    }
    await refresh();
    return pro;
  }
  async function privacyOptionsRequired() {
    if (!isNative) return false;
    try { consent = await plugins().AdMob.requestConsentInfo(); }
    catch (error) { warn('privacyOptionsRequired', error); }
    await syncBanner();
    return consent?.privacyOptionsRequirementStatus === 'REQUIRED';
  }
  async function showPrivacyOptions() {
    if (!isNative) return;
    try { await plugins().AdMob.showPrivacyOptionsForm(); }
    catch (error) { warn('showPrivacyOptionsForm', error); }
    await privacyOptionsRequired();
  }
  async function openExternal(url) {
    try {
      if (isNative) await plugins().Browser.open({ url });
      else window.open(url, '_blank', 'noopener');
    } catch (error) { warn('openExternal', error); }
  }
  window.LawnlyNative = {
    isNative, platform, config, init, isPro: () => pro,
    onProChange(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    logIn: userId => changeUser('logIn', { appUserID: String(userId) }),
    logOut: () => changeUser('logOut'), getOffers, buy, restore, showBanner, hideBanner,
    privacyOptionsRequired, showPrivacyOptions, openExternal
  };
})();
