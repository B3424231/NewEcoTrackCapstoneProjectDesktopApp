// One workspace exposes monitoring and control together. Device capabilities remain unchanged.
(function () {
  'use strict';
  const root = document.documentElement;
  try { root.classList.toggle('dark', localStorage.getItem('ecoTrackTheme') === 'dark'); } catch (_) {}
  root.dataset.ecoMode = 'both';
  const style = document.createElement('style');
  style.textContent = 'html{background-color:#f8fafc}html.dark{background-color:#0b1220}html[data-eco-mode="both"] [data-eco-mode="controller-only"]{display:none!important}';
  document.head.appendChild(style);
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = './css/app-mode.css?v=5';
  document.head.appendChild(css);

  const home = () => 'dashboard.html';
  const allowsPage = (_value, page) => page !== 'logs.html';
  function apply() {
    root.dataset.ecoMode = 'both';
    document.querySelectorAll('a[href]').forEach(link => {
      let url; try { url = new URL(link.getAttribute('href'), location.href); } catch (_) { return; }
      if (url.protocol === location.protocol && url.host === location.host && url.pathname.split('/').pop().toLowerCase() === 'logs.html') link.dataset.ecoMode = 'controller-only';
    });
    const registration = document.querySelector('#sidebarNav a[href="nodes.html"]');
    const section = document.getElementById('deviceRegistrationSection');
    if (registration && section && section.nextElementSibling !== registration) section.insertAdjacentElement('afterend', registration);
  }
  // Compatibility for existing pages that read the workspace's combined feature set.
  window.EcoTrackMode = Object.freeze({ mode: 'both', home, allowsPage, apply });
  if (!allowsPage('both', new URL(location.href).pathname.split('/').pop().toLowerCase())) location.replace(new URL(home(), location.href).href);
  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('pageshow', apply);
})();
