// Early Theme Initialization (prevents flash of light theme)
(function() {
  const currentTheme = localStorage.getItem('ecoTrackTheme');
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

// ===== SIDEBAR LOADER =====
// This script loads and injects the sidebar from sidebar-template.html into any page
// Include this script in the <head> or before closing </body> tag
 
// Create a sleek loading overlay to prevent layout shifts and flash
if (!document.getElementById('eco-loader')) {
  const currentTheme = localStorage.getItem('ecoTrackTheme');
  const isDark = currentTheme === 'dark';
  const bg = isDark ? '#070b19' : '#ffffff';

  const loader = document.createElement('div');
  loader.id = 'eco-loader';
  loader.innerHTML = `
    <div class="eco-loader-bar"></div>
    <div class="eco-loader-spinner"></div>
  `;
  document.body ? document.body.appendChild(loader) : document.documentElement.appendChild(loader);

  const style = document.createElement('style');
  style.id = 'eco-loader-style';
  style.textContent = `
    #eco-loader {
      position: fixed;
      inset: 0;
      background: ${bg};
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }
    .eco-loader-bar {
      position: absolute;
      top: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(90deg, #18392B, #10b981);
      box-shadow: 0 0 15px #10b981;
      animation: ecoLoadBar 2s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
    }
    .eco-loader-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(16, 185, 129, 0.15);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: ecoSpin 0.8s linear infinite;
    }
    @keyframes ecoLoadBar {
      0% { width: 0%; }
      50% { width: 70%; }
      100% { width: 95%; }
    }
    @keyframes ecoSpin {
      to { transform: rotate(360deg); }
    }
  `;
  if (document.head) document.head.appendChild(style);
}

// Add click listener to show loader on navigation
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (link && link.href && !link.href.includes('#') && link.target !== '_blank' && !link.hasAttribute('download')) {
    const loader = document.getElementById('eco-loader');
    if (loader) {
      loader.style.opacity = '1';
      loader.style.visibility = 'visible';
      // Reset animation
      const bar = loader.querySelector('.eco-loader-bar');
      if (bar) {
        bar.style.animation = 'none';
        bar.offsetHeight; /* trigger reflow */
        bar.style.animation = null;
      }
    }
  }
});

let sidebarLoaded = false;

async function loadSidebar() {
  try {
    // Check if sidebar is already loaded to prevent duplicates
    if (sidebarLoaded || document.querySelector('aside.w-64')) {
      if (typeof initializeSidebar !== 'undefined') {
        initializeSidebar();
      }
      if (typeof initializeSidebarToggle !== 'undefined') {
        initializeSidebarToggle();
      }
      if (typeof initializeLogout !== 'undefined') {
        initializeLogout();
      }
      
      const loader = document.getElementById('eco-loader');
      if (loader) {
        loader.style.opacity = '0';
        loader.style.visibility = 'hidden';
      }
      
      return;
    }

    // Construct the path to sidebar-template.html with a cache buster
    const response = await fetch('./sidebar-template.html?v=' + Date.now());
    const sidebarHTML = await response.text();
    
    // Create a container if it doesn't exist
    const mainContainer = document.querySelector('.flex');
    if (mainContainer) {
      // Insert sidebar as the first child
      mainContainer.insertAdjacentHTML('afterbegin', sidebarHTML);
      sidebarLoaded = true;
      
      // Initialize sidebar after inserting
      setTimeout(() => {
        if (typeof initializeSidebar !== 'undefined') {
          initializeSidebar();
        }
        if (typeof initializeSidebarToggle !== 'undefined') {
          initializeSidebarToggle();
        }
        if (typeof initializeLogout !== 'undefined') {
          initializeLogout();
        }
        if (typeof initializeSidebarTooltips !== 'undefined') {
          initializeSidebarTooltips();
        }
        // Ensure Global Notifications module is loaded and badge is synced
        if (typeof updateGlobalNotificationBadge === 'undefined' && !document.querySelector('script[src*="global-notifications.js"]')) {
          const notifScript = document.createElement('script');
          notifScript.src = './js/global-notifications.js?v=' + Date.now();
          notifScript.onload = () => {
            if (typeof updateGlobalNotificationBadge !== 'undefined') {
              updateGlobalNotificationBadge();
            }
          };
          document.head.appendChild(notifScript);
        } else if (typeof updateGlobalNotificationBadge !== 'undefined') {
          updateGlobalNotificationBadge();
        }

        // Load Maintenance Modal module if not present
        if (!window.EcoTrackMaintenance && !document.querySelector('script[src*="maintenance-modal.js"]')) {
          const maintScript = document.createElement('script');
          maintScript.src = './js/maintenance-modal.js?v=' + Date.now();
          document.head.appendChild(maintScript);
        }
        // Retry badge after data layer is fully ready
        setTimeout(() => {
          if (typeof updateGlobalNotificationBadge !== 'undefined') {
            updateGlobalNotificationBadge();
          }
        }, 500);
        setTimeout(() => {
          if (typeof updateGlobalNotificationBadge !== 'undefined') {
            updateGlobalNotificationBadge();
          }
        }, 1500);
        
        // Hide loader smoothly
        const loader = document.getElementById('eco-loader');
        if (loader) {
          loader.style.opacity = '0';
          loader.style.visibility = 'hidden';
        }
        
      }, 50);
    }
  } catch (error) {
    console.error('Error loading sidebar:', error);
    // CRITICAL: Hide loader even on error so the page is never stuck
    const loader = document.getElementById('eco-loader');
    if (loader) {
      loader.style.opacity = '0';
      loader.style.visibility = 'hidden';
    }
  }
}

// FAILSAFE: Always hide loader after 5 seconds no matter what
setTimeout(() => {
  const loader = document.getElementById('eco-loader');
  if (loader && loader.style.visibility !== 'hidden') {
    loader.style.opacity = '0';
    loader.style.visibility = 'hidden';
  }
}, 5000);

// Load sidebar when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadSidebar);
} else {
  loadSidebar();
}
