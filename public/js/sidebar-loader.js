// Early Theme Initialization (prevents flash of light theme)
(function() {
  let currentTheme;
  try { currentTheme = localStorage.getItem('ecoTrackTheme'); } catch (_) {}
  if (currentTheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
})();

// Listen for storage changes to sync tabs in real time
window.addEventListener('storage', (e) => {
  if (e.key === 'ecoTrackTheme') {
    if (e.newValue === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    window.dispatchEvent(new CustomEvent('theme:changed', { detail: e.newValue }));
  }
});

// Modal launchers use the real preparation promise, so feedback ends on success or failure.
// Keep this available synchronously: registration can be clicked before sidebar modules load.
(function installModalLoading() {
  if (window.EcoTrackModalLoading) return;
  const pending = new WeakMap();
  const style = document.createElement('style');
  style.textContent = `
    .eco-modal-button-busy { position:relative!important; color:transparent!important; cursor:progress!important; }
    .eco-modal-button-busy > :not(.eco-modal-button-feedback) { visibility:hidden!important; }
    .eco-modal-button-busy > .eco-modal-button-feedback { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:8px; padding:0 10px; color:var(--eco-modal-feedback-color); pointer-events:none; visibility:visible!important; }
    .eco-modal-button-feedback > span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .eco-modal-inline-spinner { display:inline-block; box-sizing:border-box; width:17px; height:17px; flex:0 0 17px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:eco-modal-spin .75s linear infinite; }
    .eco-modal-inline-spinner[hidden] { display:none; }
    .eco-modal-loading-status { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @keyframes eco-modal-spin { to { transform:rotate(360deg); } }
    @media(prefers-reduced-motion:reduce) { .eco-modal-inline-spinner { animation:none; } }
  `;
  (document.head || document.documentElement).appendChild(style);

  function run(button, task, { label = 'Opening…' } = {}) {
    if (!button || typeof button.setAttribute !== 'function') return Promise.resolve().then(task);
    if (pending.has(button)) return pending.get(button);
    const previous = {
      disabled: button.disabled,
      busy: button.getAttribute('aria-busy'),
      label: button.getAttribute('aria-label'),
      minWidth: button.style.minWidth,
      color: button.style.getPropertyValue('--eco-modal-feedback-color')
    };
    const width = button.getBoundingClientRect().width;
    button.style.setProperty('--eco-modal-feedback-color', getComputedStyle(button).color);
    if (width) button.style.minWidth = width + 'px';
    const feedback = document.createElement('span');
    feedback.className = 'eco-modal-button-feedback';
    feedback.setAttribute('aria-hidden', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'eco-modal-inline-spinner';
    feedback.appendChild(spinner);
    if (width >= 120) {
      const text = document.createElement('span');
      text.textContent = label;
      feedback.appendChild(text);
    }
    button.appendChild(feedback);
    button.classList.add('eco-modal-button-busy');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', label);
    let status = document.getElementById('eco-modal-loading-status');
    if (!status && document.body) {
      status = document.createElement('span');
      status.id = 'eco-modal-loading-status';
      status.className = 'eco-modal-loading-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      document.body.appendChild(status);
    }
    if (status) status.textContent = label;

    // Resolve from the task itself; no timeout or minimum animation duration delays a dialog.
    const promise = Promise.resolve().then(task).finally(() => {
      pending.delete(button);
      feedback.remove();
      button.classList.remove('eco-modal-button-busy');
      button.disabled = previous.disabled;
      for (const [name, value] of [['aria-busy', previous.busy], ['aria-label', previous.label]]) {
        if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
      }
      button.style.minWidth = previous.minWidth;
      if (previous.color) button.style.setProperty('--eco-modal-feedback-color', previous.color);
      else button.style.removeProperty('--eco-modal-feedback-color');
      if (status?.textContent === label) status.textContent = '';
    });
    pending.set(button, promise);
    return promise;
  }
  window.EcoTrackModalLoading = Object.freeze({ run });
})();

// Ensure EcoNetwork, EcoDataBus, and EcoTrackSkeletons are globally loaded on every page
if (!window.EcoNetwork) {
  const netScript = document.createElement('script');
  netScript.src = './js/eco-network.js';
  (document.head || document.documentElement).appendChild(netScript);
}
if (!window.EcoDataBus) {
  const busScript = document.createElement('script');
  busScript.src = './js/eco-data-bus.js';
  (document.head || document.documentElement).appendChild(busScript);
}
if (!window.EcoTrackSkeletons) {
  const skelScript = document.createElement('script');
  skelScript.src = './js/skeletons.js';
  (document.head || document.documentElement).appendChild(skelScript);
}

// Style all visible selects while retaining native values, forms and change events.
if (!window.EcoTrackSelectControls && !document.querySelector('script[data-eco-selects]')) {
  const selectScript = document.createElement('script');
  selectScript.src = './js/select-controls.js?v=4';
  selectScript.dataset.ecoSelects = 'true';
  (document.head || document.documentElement).appendChild(selectScript);
}

// ===== SIDEBAR LOADER =====
// This script loads and injects the sidebar from sidebar-template.html into any page

// Create a sleek, non-blocking top progress bar (NO full-screen blackout, NO blocking spinner)
if (!document.getElementById('eco-loader')) {
  const loader = document.createElement('div');
  loader.id = 'eco-loader';
  loader.setAttribute('aria-hidden', 'true');
  loader.setAttribute('role', 'progressbar');
  loader.setAttribute('aria-label', 'Loading page content');
  loader.innerHTML = '<div class="eco-loader-bar"></div>';
  (document.body || document.documentElement).appendChild(loader);

  const style = document.createElement('style');
  style.id = 'eco-loader-style';
  style.textContent = `
    #eco-loader {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 999999;
      pointer-events: none;
      background: transparent;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.12s ease, visibility 0.12s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      #eco-loader, .eco-loader-bar { transition: none !important; }
    }
    .eco-loader-bar {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #10b981, #06b6d4, #10b981);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.7);
      transition: width 0.15s ease-out;
    }
  `;
  if (document.head) document.head.appendChild(style);
}

let loaderHideTimer, loaderResetTimer;
function showLoader() {
  clearTimeout(loaderHideTimer); clearTimeout(loaderResetTimer);
  const loader = document.getElementById('eco-loader');
  if (!loader) return;
  const bar = loader.querySelector('.eco-loader-bar');
  if (bar) {
    bar.style.transition = 'width 0.15s ease-out';
    bar.style.width = '70%';
  }
  loader.style.opacity = '1';
  loader.style.visibility = 'visible';
  loader.setAttribute('aria-hidden', 'false');
}

function hideLoader(immediate = false) {
  clearTimeout(loaderHideTimer); clearTimeout(loaderResetTimer);
  const loader = document.getElementById('eco-loader');
  if (!loader) return;
  const bar = loader.querySelector('.eco-loader-bar');
  if (bar) {
    bar.style.transition = 'width 0.08s ease-out';
    bar.style.width = '100%';
  }
  const finish = () => {
    loader.style.opacity = '0';
    loader.style.visibility = 'hidden';
    loader.setAttribute('aria-hidden', 'true');
    loaderResetTimer = setTimeout(() => {
      if (bar) {
        bar.style.transition = 'none';
        bar.style.width = '0%';
      }
    }, immediate ? 0 : 120);
  };
  if (immediate) finish(); else loaderHideTimer = setTimeout(finish, 60);
}

// Add click listener for snappy top progress on navigation
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link || !link.href) return;
  
  const href = link.getAttribute('href');
  if (!href || href.startsWith('#') || !isEcoTrackPlainActivation(e, link)) {
    return;
  }

  const target = new URL(link.href, window.location.href);
  if (!['http:', 'https:', 'file:'].includes(target.protocol) || target.origin !== window.location.origin ||
      isEcoTrackCurrentLocation(link)) return;
  // Fragment-only activation stays within the current document.
  if (target.pathname === window.location.pathname && target.search === window.location.search && target.hash) return;
  // A later handler may cancel navigation; wait until propagation has finished.
  queueMicrotask(() => { if (!e.defaultPrevented) showLoader(); });
});

// Destination progress follows initial visible content, then leaves silent refreshes alone.
let initialPageSettled = false;
let initialPageObserver, initialPageDeadline, readinessFrame;
function visibleInitialContentPending() {
  const main = document.querySelector('main');
  if (!main) return false;
  return [...main.querySelectorAll('.eco-skeleton, [aria-busy="true"]'), ...(main.matches('[aria-busy="true"]') ? [main] : [])]
    .some(element => !element.matches('button, input, select, [role="button"]') &&
      element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
}
function finishInitialPageLoading(failed = false) {
  initialPageSettled = true;
  initialPageObserver?.disconnect();
  clearTimeout(initialPageDeadline);
  cancelAnimationFrame(readinessFrame);
  hideLoader(failed);
}
function checkInitialPageLoading() {
  if (initialPageSettled || !initialPageObserver || document.readyState === 'loading' || sidebarLoading) return;
  if (!visibleInitialContentPending()) finishInitialPageLoading();
  else showLoader();
}
function observeInitialPageLoading() {
  if (initialPageSettled || initialPageObserver) return;
  initialPageObserver = new MutationObserver(() => {
    cancelAnimationFrame(readinessFrame);
    readinessFrame = requestAnimationFrame(checkInitialPageLoading);
  });
  initialPageObserver.observe(document.querySelector('main') || document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'hidden', 'class', 'style']
  });
  initialPageDeadline = setTimeout(() => {
    if (!visibleInitialContentPending()) return finishInitialPageLoading();
    const notice = document.createElement('div');
    notice.className = 'eco-page-loading-error'; notice.setAttribute('role', 'alert');
    notice.append(document.createTextNode('Some page content could not finish loading. '));
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry loading';
    retry.addEventListener('click', () => window.location.reload()); notice.append(retry);
    (document.querySelector('main') || document.body).append(notice);
    finishInitialPageLoading(true);
  }, 25000);
  // Page controllers also register DOMContentLoaded handlers. Let them establish
  // their actual loading regions before deciding whether the destination is ready.
  readinessFrame = requestAnimationFrame(checkInitialPageLoading);
}
window.addEventListener('pageshow', event => {
  if (event.persisted) { finishInitialPageLoading(); hideLoader(true); }
});
window.addEventListener('pagehide', () => hideLoader(true));

let sidebarLoaded = false, sidebarLoading = false;
let initializedSidebar = null;

// Align to an explicit page divider, otherwise to the full responsive header.
let shellHeaderResizeObserver = null;
function alignShellHeaderBorders() {
  // An early cached sidebar can arrive while <header> is still being parsed.
  // Its temporary flex height must never become the sidebar's fixed height.
  // loadSidebar runs again at DOMContentLoaded, then ResizeObserver follows changes.
  if (document.readyState === 'loading') return;
  shellHeaderResizeObserver?.disconnect();
  const header = document.querySelector('main > header');
  const sidebar = document.getElementById('sidebar');
  const sidebarHeader = sidebar?.querySelector('.sidebar-header');
  if (!header || !sidebarHeader) return;
  const divider = header.querySelector('[data-sidebar-divider="top"]');
  const update = () => {
    const dividerBottom = divider
      ? divider.getBoundingClientRect().top + parseFloat(getComputedStyle(divider).borderTopWidth)
      : header.getBoundingClientRect().bottom;
    const height = dividerBottom - sidebarHeader.getBoundingClientRect().top;
    if (height > 0) sidebar.style.setProperty('--eco-page-header-height', height + 'px');
  };
  update();
  if (typeof ResizeObserver === 'function') {
    shellHeaderResizeObserver = new ResizeObserver(update);
    shellHeaderResizeObserver.observe(header);
    if (divider) shellHeaderResizeObserver.observe(divider);
  }
}
window.addEventListener('page:init', alignShellHeaderBorders);
window.addEventListener('resize', alignShellHeaderBorders);
window.addEventListener('beforeunload', () => shellHeaderResizeObserver?.disconnect());

function initSidebarModules() {
  window.EcoTrackMode?.apply();
  alignShellHeaderBorders();
  const sidebar = document.getElementById('sidebar');
  if (sidebar && initializedSidebar !== sidebar) {
    initializedSidebar = sidebar;
    if (typeof initializeSidebar !== 'undefined') initializeSidebar();
    if (typeof initializeSidebarToggle !== 'undefined') initializeSidebarToggle();
    if (typeof initializeLogout !== 'undefined') initializeLogout();
    if (typeof initializeSidebarTooltips !== 'undefined') initializeSidebarTooltips();
  }
  if (document.body?.matches('.sensor-sidebar-open,.workspace-sidebar-open')) {
    sidebar?.classList.remove('collapsed');
  }
  if (typeof initializeResponsiveSidebar === 'function') initializeResponsiveSidebar();
  // Deferred page scripts establish authentication before these modules start.
  if (document.readyState === 'loading') return;

  // Load Global Notifications if needed
  if (typeof updateGlobalNotificationBadge === 'undefined' && !document.querySelector('script[src*="global-notifications.js"]')) {
    const notifScript = document.createElement('script');
    notifScript.src = './js/global-notifications.js';
    notifScript.onload = () => {
      if (typeof updateGlobalNotificationBadge !== 'undefined') updateGlobalNotificationBadge();
    };
    document.head.appendChild(notifScript);
  } else if (typeof updateGlobalNotificationBadge !== 'undefined') {
    updateGlobalNotificationBadge();
  }

  // Load Maintenance Modal if needed
  if (!window.EcoTrackMaintenance && !document.querySelector('script[src*="maintenance-modal.js"]')) {
    const maintScript = document.createElement('script');
    maintScript.src = './js/maintenance-modal.js?v=79';
    document.head.appendChild(maintScript);
  }
}

function insertSidebar(container, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const sidebar = template.content.querySelector('#sidebar');
  if (sidebar) {
    sidebar.classList.add('sidebar-no-anim');
    sidebar.classList.toggle('collapsed', ecoTrackSidebarCollapsed());
  }
  container.prepend(template.content);
  sidebarLoaded = true;
  initSidebarModules();
}

async function loadSidebar() {
  if (sidebarLoading) return;
  sidebarLoading = true;
  try {
    // Check if sidebar is already present in DOM
    if (sidebarLoaded || document.querySelector('aside#sidebar') || document.querySelector('aside.w-64')) {
      initSidebarModules();
      return;
    }

    const mainContainer = document.querySelector('#sidebar-container') ||
                          document.querySelector('.app-shell > .flex') ||
                          document.querySelector('body > .flex') ||
                          document.querySelector('.flex:not(body)') ||
                          document.querySelector('.flex');

    if (!mainContainer || mainContainer === document.body) {
      return;
    }

    // 1. Instant Synchronous Cache Check with versioning (0ms render!)
    const SIDEBAR_VERSION = 'v28-stable-navigation-shell';
    let cachedVer, cachedHTML;
    try {
      cachedVer = sessionStorage.getItem('ecoTrack_sidebar_ver');
      cachedHTML = sessionStorage.getItem('ecoTrack_sidebar_html');
    } catch (_) {}
    if (cachedHTML && cachedVer === SIDEBAR_VERSION) {
      insertSidebar(mainContainer, cachedHTML);
      return;
    }

    // 2. Fetch fresh sidebar-template.html if not cached or version mismatch
    const response = await fetch(`./sidebar-template.html?v=${SIDEBAR_VERSION}`);
    if (response.ok) {
      const sidebarHTML = await response.text();
      try {
        sessionStorage.setItem('ecoTrack_sidebar_ver', SIDEBAR_VERSION);
        sessionStorage.setItem('ecoTrack_sidebar_html', sidebarHTML);
      } catch (_) {}
      insertSidebar(mainContainer, sidebarHTML);
    }
  } catch (error) {
    console.warn('Sidebar load error:', error);
  } finally {
    sidebarLoading = false;
    checkInitialPageLoading();
  }
}

// Load sidebar when DOM is ready (or immediately if already parsed)
if (document.readyState === 'loading') {
  // Restore the shell as soon as its container is parsed; page work need not finish first.
  const earlySidebar = new MutationObserver(() => {
    if (!document.querySelector('.app-shell > .flex')) return;
    earlySidebar.disconnect();
    void loadSidebar();
  });
  earlySidebar.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { earlySidebar.disconnect(); void loadSidebar(); observeInitialPageLoading(); });
} else {
  loadSidebar();
  observeInitialPageLoading();
}
