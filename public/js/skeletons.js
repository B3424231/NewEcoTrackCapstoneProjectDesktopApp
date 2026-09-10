/**
 * EcoTrack Skeletons - Database Query Loading Placeholders
 * High-performance, theme-aware skeleton placeholders for tables, cards, and metrics.
 */
(function () {
  'use strict';

  function getEl(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  const EcoTrackSkeletons = {
    /**
     * Render realistic table row skeletons
     */
    renderTableSkeleton(containerOrId, options = {}) {
      const el = getEl(containerOrId);
      if (!el) return;

      const rows = options.rows || 5;
      const cols = options.cols || 6;
      const colWidths = options.colWidths || ['w-24', 'w-32', 'w-28', 'w-20', 'w-24', 'w-16'];

      let html = '';
      for (let r = 0; r < rows; r++) {
        html += `
          <tr class="border-b border-gray-100 dark:border-white/5 animate-pulse">
            ${Array.from({ length: cols }).map((_, c) => {
              const widthClass = colWidths[c % colWidths.length] || 'w-24';
              return `
                <td class="px-5 py-4 whitespace-nowrap">
                  <div class="h-4 ${widthClass} eco-skeleton rounded"></div>
                </td>
              `;
            }).join('')}
          </tr>
        `;
      }
      el.innerHTML = html;
    },

    /**
     * Render staff technician card skeletons in a table tbody
     */
    renderStaffTableSkeleton(containerOrId, options = {}) {
      const el = getEl(containerOrId);
      if (!el) return;

      const rows = options.rows || 5;
      let html = '';
      for (let r = 0; r < rows; r++) {
        html += `
          <tr class="border-b border-gray-100 dark:border-white/5">
            <td class="px-5 py-4">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl eco-skeleton shrink-0"></div>
                <div class="space-y-1.5 flex-1">
                  <div class="h-3.5 w-28 eco-skeleton rounded"></div>
                  <div class="h-2.5 w-36 eco-skeleton rounded"></div>
                </div>
              </div>
            </td>
            <td class="px-5 py-4">
              <div class="h-3.5 w-24 eco-skeleton rounded"></div>
            </td>
            <td class="px-5 py-4">
              <div class="h-3.5 w-32 eco-skeleton rounded"></div>
            </td>
            <td class="px-5 py-4">
              <div class="h-6 w-20 rounded-full eco-skeleton"></div>
            </td>
            <td class="px-5 py-4">
              <div class="h-3.5 w-16 eco-skeleton rounded"></div>
            </td>
            <td class="px-5 py-4">
              <div class="h-3.5 w-24 eco-skeleton rounded"></div>
            </td>
            <td class="px-5 py-4 text-right">
              <div class="h-7 w-16 eco-skeleton rounded-lg inline-block"></div>
            </td>
          </tr>
        `;
      }
      el.innerHTML = html;
    },

    /**
     * Render AC Sensor / Node grid card skeletons
     */
    renderNodeGridSkeleton(containerOrId, options = {}) {
      const el = getEl(containerOrId);
      if (!el) return;

      const count = options.count || 4;
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `
          <div class="bg-white/5 dark:bg-[#0c1328]/80 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl eco-skeleton"></div>
                <div class="space-y-1.5">
                  <div class="h-4 w-28 eco-skeleton rounded"></div>
                  <div class="h-3 w-20 eco-skeleton rounded"></div>
                </div>
              </div>
              <div class="h-6 w-16 rounded-full eco-skeleton"></div>
            </div>

            <div class="grid grid-cols-2 gap-2.5 pt-2">
              <div class="p-2.5 rounded-xl bg-gray-50/50 dark:bg-slate-900/50 border border-gray-100 dark:border-white/5 space-y-1.5">
                <div class="h-2.5 w-12 eco-skeleton rounded"></div>
                <div class="h-4 w-16 eco-skeleton rounded"></div>
              </div>
              <div class="p-2.5 rounded-xl bg-gray-50/50 dark:bg-slate-900/50 border border-gray-100 dark:border-white/5 space-y-1.5">
                <div class="h-2.5 w-12 eco-skeleton rounded"></div>
                <div class="h-4 w-16 eco-skeleton rounded"></div>
              </div>
            </div>

            <div class="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-white/5">
              <div class="h-3 w-24 eco-skeleton rounded"></div>
              <div class="h-3 w-16 eco-skeleton rounded"></div>
            </div>
          </div>
        `;
      }
      el.innerHTML = html;
    },

    /**
     * Render sidebar room list skeletons
     */
    renderRoomListSkeleton(containerOrId, options = {}) {
      const el = getEl(containerOrId);
      if (!el) return;

      const count = options.count || 4;
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `
          <div class="p-3 rounded-xl bg-white/40 dark:bg-[#0c1328]/40 border border-gray-200/60 dark:border-white/5 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-8 h-8 rounded-lg eco-skeleton shrink-0"></div>
              <div class="space-y-1.5 flex-1 min-w-0">
                <div class="h-3.5 w-24 eco-skeleton rounded"></div>
                <div class="h-2.5 w-16 eco-skeleton rounded"></div>
              </div>
            </div>
            <div class="h-5 w-8 rounded-full eco-skeleton"></div>
          </div>
        `;
      }
      el.innerHTML = html;
    },

    /**
     * Render KPI metric stat card skeletons
     */
    renderStatsSkeleton(containerOrId, options = {}) {
      const el = getEl(containerOrId);
      if (!el) return;

      const count = options.count || 4;
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `
          <div class="bg-white/40 dark:bg-[#0c1328]/60 border border-gray-200 dark:border-white/10 rounded-xl p-3.5 shadow-sm space-y-2">
            <div class="h-3 w-16 eco-skeleton rounded"></div>
            <div class="flex items-baseline justify-between">
              <div class="h-6 w-12 eco-skeleton rounded"></div>
              <div class="h-3 w-10 eco-skeleton rounded"></div>
            </div>
          </div>
        `;
      }
      el.innerHTML = html;
    }
  };

  window.EcoTrackSkeletons = EcoTrackSkeletons;
})();
