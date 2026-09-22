// Choose a language before the page paints. Explicit choice wins over browser language.
(function () {
  const current = document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh';
  let saved = '';
  try { saved = localStorage.getItem('renamerx-language') || ''; } catch (_) {}
  const requested = new URLSearchParams(location.search).get('lang');
  if (requested === 'zh' || requested === 'en') {
    saved = requested;
    try { localStorage.setItem('renamerx-language', requested); } catch (_) {}
    history.replaceState(null, '', location.pathname);
  }
  const browserLanguages = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || ''];
  const system = browserLanguages.some(language => /^zh(?:-|$)/i.test(language)) ? 'zh' : 'en';
  const preferred = saved === 'zh' || saved === 'en' ? saved : system;
  if (preferred === current) return;
  const target = preferred === 'en' ? 'en/' : '../';
  location.replace(target);
})();
