/* Session-only view context. Page controllers explicitly choose and validate fields. */
(function (window, document) {
  'use strict';
  if (window.EcoTrackPageState) return;
  function accountScope() {
    try {
      if (window.localStorage.getItem('ecoTrack_require_login')) return null;
      const user = JSON.parse(window.localStorage.getItem('ecoTrack_profile_user') || '{}');
      return user.id ? JSON.stringify([String(user.id), window.localStorage.getItem('ecoTrack_workspace_mode') || 'both']) : null;
    } catch (_) { return null; }
  }
  // A document belonging to a previous account must never save into the new account.
  const owner = accountScope();
  const key = 'ecoTrack_page_view_v1:' + owner + ':' + window.location.pathname.toLowerCase();
  const ownsDocument = () => Boolean(owner && owner === accountScope());
  function read() {
    if (!ownsDocument()) return {};
    try {
      const value = JSON.parse(window.sessionStorage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function save(patch) {
    if (!ownsDocument() || !patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    try { window.sessionStorage.setItem(key, JSON.stringify({ ...read(), ...patch })); } catch (_) {}
  }
  function clear() { if (ownsDocument()) try { window.sessionStorage.removeItem(key); } catch (_) {} }
  window.EcoTrackPageState = Object.freeze({ read, save, clear });

  function initializeScroll() {
    if (!ownsDocument() || window.location.hash) return;
    const remembered = read().scroll || {}, pending = new Map(), positions = {};
    // Explicit view surfaces only: never record modal or form contents.
    const selectors = ['.sensor-content', 'main > .overflow-y-auto', 'main > .overflow-auto', '#roomsList', '.sensor-table-wrap', '.scheduler-table-scroll', 'main .eco-table-frame'];
    const surfaces = new Map();
    const capture = () => {
      surfaces.forEach((name,element) => { positions[name] = pending.get(element) || { top:element.scrollTop, left:element.scrollLeft }; });
      save({scroll:positions});
    };
    const restore = () => {
      pending.forEach((position,element) => {
        if (element.scrollHeight - element.clientHeight >= position.top && element.scrollWidth - element.clientWidth >= position.left) {
          element.scrollTop = position.top; element.scrollLeft = position.left; pending.delete(element);
        }
      });
    };
    let frame;
    const discover = () => {
      surfaces.forEach((name,element) => { if (!element.isConnected) { surfaces.delete(element); pending.delete(element); } });
      selectors.forEach(selector => document.querySelectorAll(selector).forEach((element,index) => {
        if (surfaces.has(element)) return;
        const name = element.id || selector + ':' + index; surfaces.set(element,name);
        const saved = positions[name] || remembered[name];
        if (saved && Number.isFinite(saved.top) && saved.top >= 0 && Number.isFinite(saved.left) && saved.left >= 0) pending.set(element,saved);
        element.addEventListener('scroll',capture,{passive:true});
        for (const event of ['wheel','pointerdown','keydown']) element.addEventListener(event,()=>pending.delete(element),{passive:true});
      }));
    };
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { discover(); restore(); }); });
    observer.observe(document.querySelector('main') || document.body,{subtree:true,childList:true});
    window.addEventListener('pagehide',capture);
    window.addEventListener('resize',restore);
    discover(); restore();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initializeScroll,{once:true});
  else initializeScroll();
})(window, document);
