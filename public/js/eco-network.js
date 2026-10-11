/**
 * EcoTrack Network & Toast Resilience Layer (eco-network.js)
 * 
 * Provides:
 * 1. Safe fetch with timeout (AbortController) & automatic retry on transient network errors.
 * 2. Real-time online / offline status pill banner.
 * 3. Non-blocking, accessible toast notifications (EcoToast) replacing blocking window.alert.
 * 4. Graceful error parsing for local Python Flask API and Supabase queries.
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. EcoToast: Modern, Non-blocking In-App Toast System
  // --------------------------------------------------------------------------
  const EcoToast = {
    container: null,

    _ensureContainer() {
      if (!this.container || !document.body.contains(this.container)) {
        this.container = document.createElement('div');
        this.container.id = 'eco-toast-container';
        this.container.setAttribute('aria-live', 'polite');
        this.container.setAttribute('role', 'status');
        this.container.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 999999;
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: none;
          max-width: 420px;
          width: calc(100% - 48px);
        `;
        document.body.appendChild(this.container);
      }
      return this.container;
    },

    show(message, type = 'info', duration = 4000) {
      const container = this._ensureContainer();

      const toast = document.createElement('div');
      toast.className = 'eco-toast-item animate-in';
      toast.style.cssText = `
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 18px;
        border-radius: 14px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        transform: translateY(12px) scale(0.96);
      `;

      // Palette themes based on type
      let bg, border, textColor, iconSvg;
      switch (type) {
        case 'success':
          bg = 'rgba(6, 78, 59, 0.94)';
          border = '1px solid rgba(52, 211, 153, 0.4)';
          textColor = '#ecfdf5';
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
          break;
        case 'error':
          bg = 'rgba(127, 29, 29, 0.94)';
          border = '1px solid rgba(248, 113, 113, 0.4)';
          textColor = '#fef2f2';
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
          break;
        case 'warning':
          bg = 'rgba(120, 53, 15, 0.94)';
          border = '1px solid rgba(251, 191, 36, 0.4)';
          textColor = '#fffbeb';
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
          break;
        default: // info
          bg = 'rgba(15, 23, 42, 0.94)';
          border = '1px solid rgba(56, 189, 248, 0.35)';
          textColor = '#f0f9ff';
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      }

      toast.style.background = bg;
      toast.style.border = border;
      toast.style.color = textColor;

      toast.innerHTML = `
        <div style="flex-shrink: 0; display: flex; align-items: center;">${iconSvg}</div>
        <div style="flex: 1; word-break: break-word;">${escapeHtml(message)}</div>
        <button type="button" aria-label="Dismiss" style="background: transparent; border: none; color: inherit; opacity: 0.6; cursor: pointer; padding: 2px; display: flex; align-items: center; border-radius: 4px; transition: opacity 0.15s;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;

      const closeBtn = toast.querySelector('button');
      closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
      closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.6');

      const removeToast = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px) scale(0.95)';
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 250);
      };

      closeBtn.addEventListener('click', removeToast);

      container.appendChild(toast);

      // Trigger entrance
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0) scale(1)';
      });

      if (duration > 0) {
        setTimeout(removeToast, duration);
      }

      return toast;
    },

    success(message, duration = 3500) {
      return this.show(message, 'success', duration);
    },

    error(message, duration = 5000) {
      return this.show(message, 'error', duration);
    },

    warning(message, duration = 4500) {
      return this.show(message, 'warning', duration);
    },

    info(message, duration = 3500) {
      return this.show(message, 'info', duration);
    }
  };

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str.replace(/[&<>"']/g, function (m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    });
  }

  // --------------------------------------------------------------------------
  // 2. EcoNetwork: Safe Fetch Client with Timeout & Retry
  // --------------------------------------------------------------------------
  const EcoNetwork = {
    DEFAULT_TIMEOUT_MS: 8000,
    MAX_RETRIES: 2,

    /**
     * Resilient fetch wrapper with AbortController timeout and exponential backoff retry.
     */
    async fetch(url, options = {}, config = {}) {
      const timeoutMs = config.timeout || this.DEFAULT_TIMEOUT_MS;
      const retries = config.retries !== undefined ? config.retries : (options.method === 'POST' ? 0 : this.MAX_RETRIES);
      const isSilent = config.silent || false;

      // Detect offline immediately
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const offlineErr = new Error('You are currently offline. Check your local or network connection.');
        offlineErr.isOffline = true;
        if (!isSilent) EcoToast.warning('Network unavailable: Offline mode active.');
        throw offlineErr;
      }

      let attempt = 0;
      while (attempt <= retries) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const fetchOptions = {
            ...options,
            signal: controller.signal
          };

          const response = await fetch(url, fetchOptions);
          clearTimeout(timer);

          if (!response.ok) {
            // Throw formatted error for non-2xx
            let errorText = '';
            try {
              const errJson = await response.clone().json();
              errorText = errJson.message || errJson.error || response.statusText;
            } catch (_) {
              errorText = await response.clone().text().catch(() => response.statusText);
            }

            const err = new Error(errorText || `HTTP ${response.status} from ${url}`);
            err.status = response.status;
            err.response = response;
            throw err;
          }

          return response;
        } catch (error) {
          clearTimeout(timer);

          const isTimeout = error.name === 'AbortError';
          const isNetworkFailure = error instanceof TypeError || isTimeout;

          if (isTimeout) {
            error.message = `Request timed out after ${Math.round(timeoutMs / 1000)}s (${url.replace(/http:\/\/[^/]+/, '')})`;
          }

          // Retry condition for transient GET failures
          if (attempt < retries && isNetworkFailure) {
            attempt++;
            const backoffMs = Math.min(1000 * Math.pow(2, attempt), 4000);
            await new Promise(res => setTimeout(res, backoffMs));
            continue;
          }

          // Report error if not silenced
          if (!isSilent) {
            console.warn(`[EcoNetwork] Fetch failed:`, error.message);
            if (config.notifyError !== false) {
              const friendlyMsg = isTimeout
                ? 'Server is taking too long to respond. Please retry shortly.'
                : error.message || 'Network communication failure.';
              EcoToast.error(friendlyMsg);
            }
          }

          throw error;
        }
      }
    },

    /**
     * Helper to fetch and parse JSON with automatic safe fallback.
     */
    async fetchJson(url, options = {}, config = {}) {
      const response = await this.fetch(url, options, config);
      return await response.json();
    }
  };

  // --------------------------------------------------------------------------
  // 3. Global Online / Offline Status Banner
  // --------------------------------------------------------------------------
  function initOfflineDetector() {
    let banner = document.getElementById('eco-offline-banner');

    function updateStatus(isOnline) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'eco-offline-banner';
        banner.style.cssText = `
          position: fixed;
          top: 14px;
          left: 50%;
          transform: translateX(-50%) translateY(-60px);
          z-index: 999999;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 18px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.4);
          transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
        `;
        document.body.appendChild(banner);
      }

      if (!isOnline) {
        banner.style.background = 'rgba(239, 68, 68, 0.95)';
        banner.style.color = '#ffffff';
        banner.style.border = '1px solid rgba(254, 202, 202, 0.4)';
        banner.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9.28"/><path d="M1.42 9A15.91 15.91 0 0 1 4.7 5.75"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          <span>Offline Mode — Changes will sync when reconnected</span>
        `;
        banner.style.transform = 'translateX(-50%) translateY(0)';
      } else {
        // Show brief reconnected state if previously offline
        if (banner.style.transform.includes('translateY(0)')) {
          banner.style.background = 'rgba(16, 185, 129, 0.95)';
          banner.style.color = '#ffffff';
          banner.style.border = '1px solid rgba(167, 243, 208, 0.4)';
          banner.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
            <span>Connection Restored — Online</span>
          `;
          setTimeout(() => {
            banner.style.transform = 'translateX(-50%) translateY(-60px)';
          }, 2400);
        }
      }
    }

    window.addEventListener('offline', () => updateStatus(false));
    window.addEventListener('online', () => updateStatus(true));

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      updateStatus(false);
    }
  }

  // --------------------------------------------------------------------------
  // 4. Modern Glassmorphic EcoModal & Safe Alert Interceptor
  // --------------------------------------------------------------------------
  const originalAlert = window.alert;

  const EcoModal = {
    show(options) {
      const config = typeof options === 'string' ? { message: options } : (options || {});
      const message = String(config.message || '');

      // Determine modal type accurately based on message content
      let type = config.type;
      if (!type) {
        if (/offline|unreachable|disconnected/i.test(message)) {
          type = 'offline';
        } else if (/error|fail|not sent|aborted|cannot|could not|invalid|denied|exception/i.test(message)) {
          type = 'error';
        } else if (/warn|caution|alert|collision/i.test(message)) {
          type = 'warning';
        } else if (/success|saved|applied|completed|connected|online|restored/i.test(message)) {
          type = 'success';
        } else {
          type = 'info';
        }
      }

      // Context-aware title if not explicitly provided or generic
      let title = config.title;
      if (!title || title === 'EcoTrack System') {
        if (type === 'offline') title = 'Controller Device Offline';
        else if (type === 'error') {
          if (/pdf|export|download|report/i.test(message)) title = 'Report Export Notice';
          else if (/command|dispatch|ir|aircon|control|packet/i.test(message)) title = 'Command Not Dispatched';
          else title = 'Operation Notice';
        }
        else if (type === 'warning') title = 'System Attention';
        else if (type === 'success') title = 'Action Succeeded';
        else title = 'EcoTrack Notification';
      }

      const onConfirm = config.onConfirm;

      // Clean up previous modal if present
      const prev = document.getElementById('eco-global-modal');
      if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

      const overlay = document.createElement('div');
      overlay.id = 'eco-global-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background-color: rgba(2, 6, 23, 0.75);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        opacity: 0;
        transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
      `;

      // Determine active theme (Dark vs Light)
      const isDark = document.documentElement.classList.contains('dark') || !document.documentElement.classList.contains('light');

      // Theme-specific color palettes
      const cardBg = isDark ? '#0c1328' : '#ffffff';
      const titleColor = isDark ? '#ffffff !important' : '#0f172a !important';
      const textColor = isDark ? '#cbd5e1 !important' : '#334155 !important';
      const closeBtnBg = isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9';
      const closeBtnColor = isDark ? '#94a3b8' : '#64748b';
      const cardShadow = isDark ? '0 25px 50px -12px rgba(0, 0, 0, 0.75)' : '0 25px 50px -12px rgba(15, 23, 42, 0.2)';

      let cardBorder = isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e2e8f0';
      let iconHtml = '';
      let btnHtml = '';

      if (type === 'offline') {
        cardBorder = isDark ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid #fde68a';
        iconHtml = `
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: -4px; border-radius: 20px; background: rgba(245, 158, 11, 0.25); filter: blur(8px);"></div>
            <div style="position: relative; width: 60px; height: 60px; border-radius: 18px; background: linear-gradient(135deg, #f59e0b, #ea580c); padding: 2px; box-shadow: 0 10px 25px -5px rgba(245, 158, 11, 0.4); display: flex; align-items: center; justify-content: center;">
              <div style="width: 100%; height: 100%; background: ${isDark ? '#0c1328' : '#ffffff'}; border-radius: 16px; display: flex; align-items: center; justify-content: center;">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                  <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                  <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                  <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                  <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                  <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </svg>
              </div>
            </div>
          </div>
        `;
        btnHtml = `
          <button type="button" class="eco-modal-ok-btn" style="
            width: 100%;
            padding: 13px 20px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff !important;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
            border: none;
            box-shadow: 0 10px 22px -5px rgba(245, 158, 11, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s, box-shadow 0.15s;
          ">
            <span style="color: #ffffff !important;">Acknowledge</span>
          </button>
        `;
      } else if (type === 'error') {
        cardBorder = isDark ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid #fecaca';
        iconHtml = `
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: -4px; border-radius: 20px; background: rgba(239, 68, 68, 0.25); filter: blur(8px);"></div>
            <div style="position: relative; width: 60px; height: 60px; border-radius: 18px; background: linear-gradient(135deg, #dc2626, #ef4444); padding: 2px; box-shadow: 0 10px 25px -5px rgba(239, 68, 68, 0.4); display: flex; align-items: center; justify-content: center;">
              <div style="width: 100%; height: 100%; background: ${isDark ? '#0c1328' : '#ffffff'}; border-radius: 16px; display: flex; align-items: center; justify-content: center;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
            </div>
          </div>
        `;
        btnHtml = `
          <button type="button" class="eco-modal-ok-btn" style="
            width: 100%;
            padding: 13px 20px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff !important;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
            border: none;
            box-shadow: 0 10px 22px -5px rgba(239, 68, 68, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s, box-shadow 0.15s;
          ">
            <span style="color: #ffffff !important;">Dismiss</span>
          </button>
        `;
      } else if (type === 'warning') {
        cardBorder = isDark ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid #fde68a';
        iconHtml = `
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: -4px; border-radius: 20px; background: rgba(245, 158, 11, 0.25); filter: blur(8px);"></div>
            <div style="position: relative; width: 60px; height: 60px; border-radius: 18px; background: linear-gradient(135deg, #f59e0b, #d97706); padding: 2px; box-shadow: 0 10px 25px -5px rgba(245, 158, 11, 0.4); display: flex; align-items: center; justify-content: center;">
              <div style="width: 100%; height: 100%; background: ${isDark ? '#0c1328' : '#ffffff'}; border-radius: 16px; display: flex; align-items: center; justify-content: center;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
            </div>
          </div>
        `;
        btnHtml = `
          <button type="button" class="eco-modal-ok-btn" style="
            width: 100%;
            padding: 13px 20px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff !important;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
            border: none;
            box-shadow: 0 10px 22px -5px rgba(245, 158, 11, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s, box-shadow 0.15s;
          ">
            <span style="color: #ffffff !important;">Got It</span>
          </button>
        `;
      } else if (type === 'success') {
        cardBorder = isDark ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid #a7f3d0';
        iconHtml = `
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: -4px; border-radius: 20px; background: rgba(16, 185, 129, 0.25); filter: blur(8px);"></div>
            <div style="position: relative; width: 60px; height: 60px; border-radius: 18px; background: linear-gradient(135deg, #10b981, #0d9488); padding: 2px; box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4); display: flex; align-items: center; justify-content: center;">
              <div style="width: 100%; height: 100%; background: ${isDark ? '#0c1328' : '#ffffff'}; border-radius: 16px; display: flex; align-items: center; justify-content: center;">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
          </div>
        `;
        btnHtml = `
          <button type="button" class="eco-modal-ok-btn btn-gradient-submit" style="
            width: 100%;
            padding: 13px 20px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff !important;
            background: linear-gradient(135deg, #10b981 0%, #0d9488 100%) !important;
            border: none;
            box-shadow: 0 10px 22px -5px rgba(16, 185, 129, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s, box-shadow 0.15s;
          ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span style="color: #ffffff !important;">OK</span>
          </button>
        `;
      } else { // info
        cardBorder = isDark ? '1px solid rgba(14, 165, 233, 0.35)' : '1px solid #bae6fd';
        iconHtml = `
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: -4px; border-radius: 20px; background: rgba(14, 165, 233, 0.25); filter: blur(8px);"></div>
            <div style="position: relative; width: 60px; height: 60px; border-radius: 18px; background: linear-gradient(135deg, #0284c7, #0ea5e9); padding: 2px; box-shadow: 0 10px 25px -5px rgba(14, 165, 233, 0.4); display: flex; align-items: center; justify-content: center;">
              <div style="width: 100%; height: 100%; background: ${isDark ? '#0c1328' : '#ffffff'}; border-radius: 16px; display: flex; align-items: center; justify-content: center;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
            </div>
          </div>
        `;
        btnHtml = `
          <button type="button" class="eco-modal-ok-btn" style="
            width: 100%;
            padding: 13px 20px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff !important;
            background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%) !important;
            border: none;
            box-shadow: 0 10px 22px -5px rgba(14, 165, 233, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s, box-shadow 0.15s;
          ">
            <span style="color: #ffffff !important;">OK</span>
          </button>
        `;
      }

      // Enhanced message styling with highlighted badges for nodes and statuses
      let formattedBody = escapeHtml(message)
        .replace(/\((node-[^)]+)\)/gi, '(<span style="font-family: monospace; font-weight: 800; color: ' + (type === 'offline' ? '#f59e0b' : type === 'error' ? '#ef4444' : '#10b981') + '; background: ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') + '; padding: 2px 6px; border-radius: 6px;">$1</span>)')
        .replace(/\bOFFLINE\b/g, '<span style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; color: #ef4444; background: ' + (isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2') + '; padding: 2px 7px; border-radius: 6px; border: 1px solid ' + (isDark ? 'rgba(239, 68, 68, 0.3)' : '#fca5a5') + ';">OFFLINE</span>');

      overlay.innerHTML = `
        <div class="eco-modal-card" style="
          position: relative;
          width: 100%;
          max-width: 420px;
          background: ${cardBg} !important;
          border: ${cardBorder} !important;
          border-radius: 26px;
          padding: 30px 26px 24px;
          box-shadow: ${cardShadow} !important;
          transform: scale(0.92) translateY(8px);
          transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          text-align: center;
          font-family: inherit;
        ">
          <button type="button" class="eco-modal-close-x" aria-label="Close" style="
            position: absolute;
            top: 15px;
            right: 15px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: ${closeBtnBg};
            border: none;
            color: ${closeBtnColor};
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s;
          ">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          ${iconHtml}

          <h3 class="eco-modal-title" style="
            font-size: 18px !important;
            font-weight: 800 !important;
            color: ${titleColor};
            margin: 0 0 10px !important;
            letter-spacing: -0.02em !important;
            line-height: 1.3 !important;
          ">
            ${escapeHtml(title)}
          </h3>

          <div class="eco-modal-msg" style="
            font-size: 13.5px !important;
            color: ${textColor};
            line-height: 1.6 !important;
            margin: 0 0 24px !important;
            font-weight: 500 !important;
            word-break: break-word;
          ">
            ${formattedBody}
          </div>

          ${btnHtml}
        </div>
      `;

      if (!document.body) {
        if (typeof window.originalAlert === 'function') {
          window.originalAlert(message);
        }
        return { close: () => {} };
      }

      document.body.appendChild(overlay);

      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        const card = overlay.querySelector('.eco-modal-card');
        if (card) {
          card.style.transform = 'scale(1) translateY(0)';
        }
      });

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown);
        overlay.style.opacity = '0';
        const card = overlay.querySelector('.eco-modal-card');
        if (card) {
          card.style.transform = 'scale(0.92) translateY(8px)';
        }
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          if (typeof onConfirm === 'function') onConfirm();
        }, 220);
      };

      overlay.querySelector('.eco-modal-close-x')?.addEventListener('click', close);
      overlay.querySelector('.eco-modal-ok-btn')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });

      const onKeyDown = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          close();
        }
      };
      document.addEventListener('keydown', onKeyDown);

      return { close };
    }
  };

  window.originalAlert = originalAlert;
  window.EcoToast = EcoToast;
  window.EcoModal = EcoModal;
  window.ecoAlert = function (message, title = 'EcoTrack Notification') {
    if (!document.body && typeof originalAlert === 'function') {
      originalAlert(message);
      return;
    }
    EcoModal.show({ message, title });
  };
  window.alert = function (message) {
    if (!document.body && typeof originalAlert === 'function') {
      originalAlert(message);
      return;
    }
    EcoModal.show({ message });
  };

  // Initialize offline detector when DOM is ready
  const safeInitDetector = () => {
    if (document.body) {
      initOfflineDetector();
    } else {
      window.addEventListener('DOMContentLoaded', initOfflineDetector, { once: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInitDetector, { once: true });
  } else {
    safeInitDetector();
  }

})();
