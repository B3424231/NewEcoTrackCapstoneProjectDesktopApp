// ===== SIDEBAR NAVIGATION =====
function isEcoTrackPlainActivation(event, link) {
  return !event.defaultPrevented && (event.button === undefined || event.button === 0) &&
    !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
    !link.hasAttribute('download') && (!link.target || link.target === '_self');
}

function isEcoTrackCurrentLocation(link) {
  const current = new URL(window.location.href);
  const target = new URL(link.href, current);
  // Asset cache versions do not represent a different page or investigation context.
  for (const url of [current, target]) { url.searchParams.delete('v'); url.searchParams.sort(); }
  return target.origin === current.origin && target.pathname.toLowerCase() === current.pathname.toLowerCase() &&
    target.search === current.search && target.hash === current.hash;
}

function ecoTrackSidebarCollapsed() {
  try { return localStorage.getItem('sidebarCollapsed') === 'true'; } catch (_) { return false; }
}

function initializeSidebar() {
  let currentFile = (window.location.pathname.split('/').pop() || '').toLowerCase();
  if (!currentFile || currentFile === 'index.html') {
    currentFile = 'dashboard.html';
  }

  // Setup nav links styling only - let anchor tags handle navigation naturally
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    let hrefFile = (href || '').split('/').pop().toLowerCase();
    hrefFile = hrefFile.split('?')[0].split('#')[0];
    
    // Determine if this is the active link
    const isActive = currentFile && hrefFile === currentFile;

    if (isActive) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
      link.classList.remove('hover:bg-slate-700/50', 'text-gray-300', 'text-cyan-400');
    } else {
      link.removeAttribute('aria-current');
      link.classList.remove('active', 'bg-emerald-500/20', 'border-emerald-400/50', 'text-white');
    }

    if (link.dataset.sidebarNavigationInitialized) return;
    link.dataset.sidebarNavigationInitialized = 'true';
    link.addEventListener('click', (e) => {
      if (!isEcoTrackPlainActivation(e, link)) return;
      const href = link.getAttribute('href');
      if (!href || href === '#' || href.startsWith('#')) {
        e.preventDefault();
        return;
      }
      if (isEcoTrackCurrentLocation(link)) {
        e.preventDefault();
      }
    });
  });
}

// ===== SIDEBAR TOGGLE FUNCTIONALITY =====
function initializeSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggle');

  // The cached sidebar may initialize both before and during DOMContentLoaded.
  if (!sidebar || !toggleBtn || toggleBtn.dataset.sidebarToggleInitialized) return;
  toggleBtn.dataset.sidebarToggleInitialized = 'true';

  // Disable transitions during page load
  sidebar.classList.add('sidebar-no-anim');

  // Restore sidebar state from localStorage on page load (no animation)
  const isSidebarCollapsed = ecoTrackSidebarCollapsed();
  if (isSidebarCollapsed) {
    sidebar.classList.add('collapsed');
  } else {
    sidebar.classList.remove('collapsed');
  }

  // Enable transitions after state is restored
  setTimeout(() => {
    sidebar.classList.remove('sidebar-no-anim');
  }, 100);

  // Toggle functionality for hamburger button (with animation)
  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    sidebar.classList.toggle('collapsed');
    // Save the state to localStorage
    try { localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed')); } catch (_) {}
  });
}

// One drawer controller serves the existing sensor/profile controls and legacy pages.
function initializeResponsiveSidebar() {
  const sidebar = document.getElementById('sidebar');
  const main = document.querySelector('main');
  const header = main?.querySelector(':scope > header');
  if (!sidebar || !header || sidebar.dataset.ecoDrawerInitialized) return;
  sidebar.dataset.ecoDrawerInitialized = 'true';
  document.body.classList.add('eco-navigation-managed');
  let menu = document.getElementById('sensorMenu') || document.getElementById('profileModeMenu') || document.getElementById('ecoNavigationMenu');
  if (!menu) {
    document.body.classList.add('eco-responsive-shell');
    menu = document.createElement('button');
    menu.id = 'ecoNavigationMenu'; menu.type = 'button';
    menu.className = 'eco-navigation-menu'; menu.textContent = 'Menu';
    header.prepend(menu);
  }
  menu.setAttribute('aria-controls', 'sidebar');
  menu.setAttribute('aria-expanded', 'false');
  const closeButton = document.createElement('button');
  closeButton.id = 'ecoNavigationClose';
  closeButton.type = 'button';
  closeButton.className = 'eco-navigation-close';
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close navigation');
  (sidebar.querySelector('.sidebar-header') || sidebar).appendChild(closeButton);
  let backdrop = document.getElementById('sensorBackdrop') || document.getElementById('profileModeBackdrop') || document.getElementById('ecoNavigationBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.id = 'ecoNavigationBackdrop'; backdrop.type = 'button';
    backdrop.className = 'eco-navigation-backdrop';
    document.body.appendChild(backdrop);
  }
  // Existing Profile markup nests its backdrop in main, which becomes inert.
  // Keep the drawer backdrop outside every background region we disable.
  if (backdrop.parentElement !== document.body) document.body.appendChild(backdrop);
  backdrop.setAttribute('aria-label', 'Close navigation');
  backdrop.tabIndex = -1;

  const narrow = window.matchMedia('(max-width: 760px)');
  const originalRole = sidebar.getAttribute('role');
  const originalLabel = sidebar.getAttribute('aria-label');
  const originalHidden = sidebar.getAttribute('aria-hidden');
  const originalModal = sidebar.getAttribute('aria-modal');
  const originalInert = sidebar.inert;
  let open = false;
  let previousFocus = null;
  const backgroundInert = new Map();
  const restoreAttribute = (name, value) => value === null ? sidebar.removeAttribute(name) : sidebar.setAttribute(name, value);
  function setOpen(next, restoreFocus = true) {
    next = next && narrow.matches;
    if (next && !open) {
      previousFocus = document.activeElement;
      // Inert siblings at every shell level, including controls outside <main>.
      for (let node = sidebar; node && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling === node || sibling === backdrop || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
          backgroundInert.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
    }
    const wasOpen = open;
    open = next;
    document.body.classList.toggle('eco-navigation-open', open);
    document.body.classList.toggle('sensor-sidebar-open', open && menu.id === 'sensorMenu');
    document.body.classList.toggle('workspace-sidebar-open', open && menu.id === 'profileModeMenu');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    if (!open) {
      backgroundInert.forEach((value, element) => { element.inert = value; });
      backgroundInert.clear();
    }
    sidebar.inert = narrow.matches ? !open : originalInert;
    sidebar.classList.toggle('collapsed', !open && ecoTrackSidebarCollapsed());
    if (narrow.matches && !open) sidebar.setAttribute('aria-hidden', 'true');
    else restoreAttribute('aria-hidden', open ? null : originalHidden);
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      sidebar.setAttribute('aria-label', 'Navigation');
      closeButton.focus();
    } else {
      restoreAttribute('aria-modal', originalModal);
      restoreAttribute('role', originalRole);
      restoreAttribute('aria-label', originalLabel);
      if (wasOpen && restoreFocus && narrow.matches) {
        const target = previousFocus?.isConnected && !sidebar.contains(previousFocus) ? previousFocus : menu;
        target.focus();
      }
    }
  }
  menu.addEventListener('click', () => setOpen(!open));
  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  // Release the drawer before a route or another dialog opens.
  sidebar.addEventListener('click', event => {
    const action = event.target.closest('a[href], #logoutButton, [data-workspace-toggle]');
    if (!open || !action) return;
    const link = action.matches('a[href]') ? action : null;
    const staysHere = link && (!isEcoTrackPlainActivation(event, link) ||
      isEcoTrackCurrentLocation(link) || link.getAttribute('href').startsWith('#'));
    setOpen(false, Boolean(staysHere));
    if (link) queueMicrotask(() => {
      // A page handler may cancel a route to open a dialog. Keep any focus it
      // deliberately placed; otherwise release focus from the now-inert drawer.
      if (event.defaultPrevented && !open && narrow.matches &&
          (sidebar.contains(document.activeElement) || document.activeElement === document.body)) menu.focus();
    });
  }, true);
  document.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('a[href], button, input, select, [tabindex]')]
        .filter(item => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden');
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); sidebar.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  narrow.addEventListener('change', () => setOpen(false, false));
  window.addEventListener('pagehide', () => setOpen(false, false));
  window.EcoTrackNavigation = Object.freeze({
    open: () => setOpen(true),
    close: ({ restoreFocus = true } = {}) => setOpen(false, restoreFocus),
    toggle: () => setOpen(!open),
    get isOpen() { return open; }
  });
  let skip = document.querySelector('.eco-skip-link');
  if (!skip) {
    skip = document.createElement('a'); skip.className = 'eco-skip-link';
    skip.textContent = 'Skip to main content';
    if (!main.id) main.id = 'eco-main-content';
    skip.href = '#' + main.id;
    document.body.prepend(skip);
    skip.addEventListener('click', () => { if (!main.hasAttribute('tabindex')) main.tabIndex = -1; main.focus(); });
  }
  setOpen(false, false);
}

// ===== LOGOUT FUNCTIONALITY =====
function initializeLogout() {
  const logoutButton = document.getElementById('logoutButton');
  const logoutModal = document.getElementById('logoutModal');
  const logoutCancel = document.getElementById('logoutCancel');
  const logoutConfirm = document.getElementById('logoutConfirm');

  if (!logoutButton || !logoutModal) return;

  // Show logout confirmation modal
  logoutButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    logoutModal.style.display = 'flex';
  });

  // Cancel logout
  logoutCancel.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    logoutModal.style.display = 'none';
  });

  // Confirm logout
  logoutConfirm.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    localStorage.setItem('ecoTrack_require_login', 'logout');
    
    // Save analytics snapshot before logging out
    try {
      const dateKey = new Date().toISOString().split('T')[0];
      await fetch(`http://127.0.0.1:5000/api/analytics/snapshot?date=${dateKey}`, { method: 'POST' });
      console.log('Snapshot saved successfully on logout');
    } catch(err) {
      console.error('Failed to save snapshot on logout:', err);
    }
    
    // Clear authentication data and Supabase session
    try {
      const sb = window.supabaseClient || window.sb;
      if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
        await sb.auth.signOut();
      }
    } catch (_) {}

    localStorage.removeItem('userToken');
    localStorage.removeItem('ecoTrack_auth_token');
    localStorage.removeItem('ecoTrack_refresh_token');
    localStorage.removeItem('ecoTrack_profile_user');
    localStorage.removeItem('sidebarCollapsed');
    sessionStorage.clear();
    
    // Redirect to login page
    window.location.href = 'login.html';
  });

  // Close modal when clicking outside of it
  logoutModal.addEventListener('click', (e) => {
    if (e.target === logoutModal) {
      logoutModal.style.display = 'none';
    }
  });
}

// ===== SIDEBAR COLLAPSED TOOLTIPS =====
function initializeSidebarTooltips() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  let tooltip = document.getElementById('ecoTrackSidebarTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'ecoTrackSidebarTooltip';
    document.body.appendChild(tooltip);
  }

  const hideTooltip = () => {
    tooltip.classList.remove('visible');
  };

  const showTooltip = (el) => {
    if (!sidebar.classList.contains('collapsed')) {
      hideTooltip();
      return;
    }

    const text = el.getAttribute('data-tooltip') || 
                 el.querySelector('span:not(.notif-badge)')?.textContent?.trim() || 
                 el.getAttribute('title') || 
                 '';
    if (!text) {
      hideTooltip();
      return;
    }

    tooltip.textContent = text;
    const rect = el.getBoundingClientRect();
    
    // Position vertically centered, 12px to the right of the button
    const top = rect.top + (rect.height / 2);
    const left = rect.right + 12;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.classList.add('visible');
  };

  // Find all interactive items in the sidebar
  const items = sidebar.querySelectorAll('.nav-link, #sidebarToggle, #logoutButton');
  items.forEach(item => {
    // Populate data-tooltip if missing
    if (!item.hasAttribute('data-tooltip')) {
      const spanText = item.querySelector('span:not(.notif-badge)')?.textContent?.trim();
      if (spanText) {
        item.setAttribute('data-tooltip', spanText);
      } else if (item.id === 'sidebarToggle') {
        item.setAttribute('data-tooltip', 'Toggle Sidebar');
      }
    }

    item.addEventListener('mouseenter', () => showTooltip(item));
    item.addEventListener('mouseleave', hideTooltip);
  });

  // Hide tooltip when scrolling or clicking or resizing
  window.addEventListener('scroll', hideTooltip, { passive: true });
  window.addEventListener('resize', hideTooltip, { passive: true });
  document.addEventListener('click', hideTooltip);
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initSidebarModules === 'function') { initSidebarModules(); return; }
  initializeSidebar();
  initializeSidebarToggle();
  initializeLogout();
  initializeSidebarTooltips();
});
