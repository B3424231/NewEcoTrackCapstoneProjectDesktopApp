// ===== MAINTENANCE STAFF MANAGEMENT =====
const sb = window.supabaseClient || window.sb;

// State - clean any legacy mock staff from localStorage on load
function getCleanStaffList() {
  try {
    const raw = localStorage.getItem('ecoTrack_staff');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const cleaned = list.filter(s => {
          if (!s || !s.name) return false;
          if (s.id && typeof s.id === 'string' && s.id.startsWith('s_00')) return false;
          if (s.email && s.email.includes('@ecotrack.local')) return false;
          if (['Carlos Rivera', 'Maria Santos', 'Jose Reyes', 'Ana Cruz', 'Mark Villanueva'].includes(s.name)) return false;
          return true;
        });
        localStorage.setItem('ecoTrack_staff', JSON.stringify(cleaned));
        return cleaned;
      }
    }
  } catch (e) {}
  return [];
}

let staffList = getCleanStaffList();
let currentPage = 1;
const PAGE_SIZE = 10;
let pendingDeleteId = null;
let searchQuery = '';
let statusFilter = 'all';

let _buildingsData = [];
let _floorsData = [];
let _roomsData = [];

function resolveAvatarUrl(s) {
  if (!s) return '';

  // Candidates in priority order from mobile/web schema
  const candidates = [
    s.photo_url,
    s.avatar_url,
    s.avatar,
    s.image_url,
    s.image,
    s.photo,
    s.picture,
    s.profile_image,
    s.profile_image_url,
    s.profile_picture,
    s.profile_picture_url,
    s.profile_photo,
    s.profile_photo_url,
    s.attachment_url
  ];

  let raw = '';
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      // Ignore placeholder strings like 'default', 'null', 'undefined'
      if (t && t.toLowerCase() !== 'default' && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'undefined') {
        raw = t;
        break;
      }
    }
  }

  if (!raw) return '';

  // 1. Data URL (Base64) or full HTTP/HTTPS URL
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  // 2. Supabase Storage bucket resolution ('avatars', 'photos', etc.)
  if (sb && sb.storage && typeof sb.storage.from === 'function') {
    const parts = raw.split('/');
    if (parts.length > 1) {
      const bucket = parts[0];
      const filePath = parts.slice(1).join('/');
      try {
        const { data } = sb.storage.from(bucket).getPublicUrl(filePath);
        if (data && data.publicUrl) return data.publicUrl;
      } catch (_) {}
    }

    // Try common public buckets defined in migration
    const candidateBuckets = ['avatars', 'photos', 'profiles', 'staff', 'images'];
    for (const b of candidateBuckets) {
      try {
        const { data } = sb.storage.from(b).getPublicUrl(raw);
        if (data && data.publicUrl) return data.publicUrl;
      } catch (_) {}
    }
  }

  return raw;
}

async function loadStaffFromSupabase() {
  if (sb) {
    try {
      const tbody = document.getElementById('staffTableBody');
      if (tbody && (!staffList || staffList.length === 0)) {
        window.EcoTrackSkeletons?.renderStaffTableSkeleton('staffTableBody', { rows: 5 });
      }
      const { data, error } = await sb.from('staff').select('*').order('created', { ascending: false });
      if (!error && Array.isArray(data)) {
        console.log('[Supabase staff data loaded]:', data);
        staffList = data.map(s => {
          const rawStatus = (s.status || '').toLowerCase();
          const isArch = isStaffArchived(s);
          const isOnline = (rawStatus === 'online' || s.is_online === true || s.online_status === 'online') && rawStatus !== 'offline' && s.is_online !== false && !isArch;
          const status = isArch ? 'Archived' : (isOnline ? 'Online' : 'Offline');

          return {
            id: s.id,
            name: s.name,
            email: s.email,
            phone: s.phone || '',
            role: s.role || 'HVAC / Aircon Technician',
            avatar: resolveAvatarUrl(s),
            buildingId: (s.building_name === 'All Buildings' || s.building_id === 'all_buildings' || (s.assignment && s.assignment.toLowerCase().includes('all building'))) ? 'all_buildings' : (s.building_id || 'bld_main'),
            buildingName: s.building_name || 'Main Campus Building',
            floorId: (s.floor_name === 'All Floors' || s.floor_id === 'all_floors' || (s.assignment && s.assignment.toLowerCase().includes('all floor'))) ? 'all_floors' : (s.floor_id || 'flr_2nd_it'),
            floorName: s.floor_name || '2nd Floor - IT Wing',
            roomId: (s.room_name === 'All Rooms' || s.room_id === 'all_rooms' || (s.assignment && s.assignment.toLowerCase().includes('all room')) || (!s.room_id && (s.room_name?.toLowerCase().includes('all') || s.floor_name?.toLowerCase().includes('all') || s.building_name?.toLowerCase().includes('all')))) ? 'all_rooms' : (s.room_id || 'rm_svr_01'),
            roomName: s.room_name || ((s.room_id === 'all_rooms' || s.floor_name === 'All Floors' || s.building_name === 'All Buildings') ? 'All Rooms' : 'Server Room A'),
            assignment: s.assignment || `${s.building_name || 'Main Campus Building'} • ${s.floor_name || '2nd Floor - IT Wing'} • ${s.room_name || 'Server Room A'}`,
            status: status,
            isOnline: isOnline,
            isArchived: isArch,
            archiveReason: s.archive_reason || '',
            archiveNotes: s.archive_notes || '',
            archivedAt: s.archived_at || null,
            lastActive: s.last_active || s.created,
            created: s.created
          };
        });
        saveStaff();
        renderTable();
        renderArchivedTable();
        updateStats();

        // If detail modal is open, refresh its content
        const modal = document.getElementById('staffDetailModal');
        if (modal && !modal.classList.contains('hidden')) {
          const detailName = document.getElementById('detailName')?.textContent;
          const currentStaff = staffList.find(st => st.name === detailName);
          if (currentStaff) showStaffDetails(null, currentStaff.id);
        }
        return;
      }
    } catch (e) {
      console.warn('[Supabase staff load]:', e.message);
    }
  }

  staffList = getCleanStaffList();
  renderTable();
}

async function loadBuildingsFloorsRooms() {
  if (sb) {
    try {
      const [bRes, fRes, rRes] = await Promise.all([
        sb.from('buildings').select('*').order('name'),
        sb.from('floors').select('*').order('name'),
        sb.from('rooms').select('*').order('name')
      ]);
      _buildingsData = bRes.data || [];
      _floorsData = fRes.data || [];
      _roomsData = rRes.data || [];
    } catch (e) {
      console.warn('[Staff location load error]:', e);
    }
  }

  // Fallbacks if tables are empty
  if (!_buildingsData.length) {
    _buildingsData = [{ id: 'bld_main', name: 'Main Campus Building' }];
  }
  if (!_floorsData.length) {
    _floorsData = [{ id: 'flr_2nd_it', name: '2nd Floor - IT Wing', building_id: 'bld_main' }];
  }
  if (!_roomsData.length) {
    _roomsData = [
      { id: 'rm_svr_01', name: 'Server Room A', floor_id: 'flr_2nd_it' },
      { id: 'rm_ofc_01', name: 'Main Office Area', floor_id: 'flr_2nd_it' },
      { id: 'rm_lab_01', name: 'Laboratory A', floor_id: 'flr_2nd_it' }
    ];
  }

  populateLocationDropdowns();
}

function populateLocationDropdowns() {
  const bSelect = document.getElementById('staffBuilding');
  const fSelect = document.getElementById('staffFloor');
  const rSelect = document.getElementById('staffRoom');

  if (!bSelect || !fSelect || !rSelect) return;

  // 1. Populate Buildings with 'All Buildings' option
  const bldOptions = [
    '<option value="all_buildings">All Buildings</option>',
    ..._buildingsData.map(b => `<option value="${b.id}">${b.name}</option>`)
  ];
  bSelect.innerHTML = bldOptions.join('');

  // Function to filter floors based on selected building
  function updateFloors() {
    const selectedBldId = bSelect.value;
    if (selectedBldId === 'all_buildings') {
      fSelect.innerHTML = '<option value="all_floors">All Floors</option>';
      updateRooms();
      return;
    }
    const filteredFloors = _floorsData.filter(f => !f.building_id || f.building_id === selectedBldId);
    const flrOptions = [
      '<option value="all_floors">All Floors</option>',
      ...filteredFloors.map(f => `<option value="${f.id}">${f.name}</option>`)
    ];
    fSelect.innerHTML = flrOptions.join('');
    updateRooms();
  }

  // Function to filter rooms based on selected floor
  function updateRooms() {
    const selectedFlrId = fSelect.value;
    if (selectedFlrId === 'all_floors') {
      rSelect.innerHTML = '<option value="all_rooms">All Rooms</option>';
      return;
    }
    const filteredRooms = _roomsData.filter(r => !r.floor_id || r.floor_id === selectedFlrId);
    const rmOptions = [
      '<option value="all_rooms">All Rooms</option>',
      ...filteredRooms.map(r => `<option value="${r.id}">${r.name}</option>`)
    ];
    rSelect.innerHTML = rmOptions.join('');
  }

  bSelect.onchange = updateFloors;
  fSelect.onchange = updateRooms;

  updateFloors();
}

function saveStaff() {
  localStorage.setItem('ecoTrack_staff', JSON.stringify(staffList));
  window.dispatchEvent(new Event('storage'));
}

// Format date helpers
function formatDateTime(dateStr) {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleDateString('en-US', options);
}

function formatDateShort(dateStr) {
  if (!dateStr) return 'Recently';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Recently';
  const now = new Date();
  const diff = now - d;
  if (diff < 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days < 7) return days + 'd ago';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

let archivedSearchQuery = '';

function isStaffArchived(s) {
  if (!s) return false;
  const statusStr = String(s.status || '').toLowerCase().trim();
  return statusStr === 'archived' || s.isArchived === true || s.is_archived === true || s.is_archived === 'true';
}

// Get filtered active list (excludes archived/soft-deleted)
function getFilteredStaff() {
  let list = staffList.filter(s => !isStaffArchived(s));

  if (statusFilter !== 'all') {
    list = list.filter(s => (s.status || '').toLowerCase() === statusFilter.toLowerCase());
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q)) ||
      (s.role && s.role.toLowerCase().includes(q)) ||
      (s.roomName && s.roomName.toLowerCase().includes(q)) ||
      (s.floorName && s.floorName.toLowerCase().includes(q)) ||
      (s.buildingName && s.buildingName.toLowerCase().includes(q)) ||
      (s.assignment && s.assignment.toLowerCase().includes(q))
    );
  }

  return list;
}

// Get filtered archived list (soft-deleted only)
function getFilteredArchivedStaff() {
  let list = staffList.filter(s => isStaffArchived(s));

  if (archivedSearchQuery) {
    const q = archivedSearchQuery.toLowerCase();
    list = list.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q)) ||
      (s.role && s.role.toLowerCase().includes(q)) ||
      (s.archiveReason && s.archiveReason.toLowerCase().includes(q)) ||
      (s.roomName && s.roomName.toLowerCase().includes(q)) ||
      (s.floorName && s.floorName.toLowerCase().includes(q)) ||
      (s.buildingName && s.buildingName.toLowerCase().includes(q)) ||
      (s.assignment && s.assignment.toLowerCase().includes(q))
    );
  }

  return list;
}

// Render table
function renderTable() {
  const tbody = document.getElementById('staffTableBody');
  if (tbody) tbody.classList.add('skeleton-fade-in');
  const filtered = getFilteredStaff();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageItems = filtered.slice(start, end);

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-16 text-center">
          <div class="flex flex-col items-center gap-3">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-300 dark:text-gray-600">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p class="text-sm font-bold text-gray-400 dark:text-gray-500">No maintenance staff found</p>
            <p class="text-xs text-gray-400 dark:text-gray-500">Click "Register Staff" to add a new technician.</p>
          </div>
        </td>
      </tr>`;
  } else {
    tbody.innerHTML = pageItems.map(staff => {
      const isOnline = staff.status === 'Online' || staff.status === 'Active';
      const statusBadge = isOnline
        ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-[#10b981] dark:text-[#34d399] text-xs font-bold rounded-full border border-emerald-300 dark:border-emerald-700/50 shadow-sm">
            <span class="w-2 h-2 rounded-full bg-[#10b981] animate-pulse"></span>
            Online
          </span>`
        : `<span class="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 dark:bg-slate-800/80 text-gray-500 dark:text-gray-400 text-xs font-bold rounded-full border border-gray-300 dark:border-slate-700 shadow-sm">
            <span class="w-2 h-2 rounded-full bg-gray-400 dark:bg-slate-500"></span>
            Offline
          </span>`;
      const initials = staff.name ? staff.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ST';
      const avatarHtml = staff.avatar
        ? `<img src="${staff.avatar}" class="w-9 h-9 rounded-xl object-cover border border-emerald-500/40 shrink-0 shadow-sm" alt="${staff.name}">`
        : `<div class="w-9 h-9 rounded-xl ${isOnline ? 'bg-emerald-100 dark:bg-emerald-950/50 text-[#10b981] dark:text-[#64f0b6] border border-emerald-500/30' : 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500'} flex items-center justify-center font-black text-xs shrink-0 shadow-sm">${initials}</div>`;

      return `
        <tr class="hover:bg-gray-50/80 dark:hover:bg-slate-900 transition-colors text-sm text-gray-800 dark:text-gray-200 cursor-pointer" onclick="showStaffDetails(event, '${staff.id}')">
          <td class="px-5 py-4">
            <div class="flex items-center gap-3">
              ${avatarHtml}
              <div>
                <span class="font-bold text-[#18392B] dark:text-cyan-400 block">${staff.name}</span>
                <span class="text-[10px] text-gray-400 font-mono">ID: ${staff.id.slice(0, 12)}...</span>
              </div>
            </div>
          </td>
          <td class="px-5 py-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
              <span>${staff.role || 'HVAC / Aircon Technician'}</span>
            </span>
          </td>
          <td class="px-5 py-4">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 flex items-center justify-center shrink-0 border border-emerald-500/20">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
              </div>
              <div class="flex flex-col">
                <span class="font-bold text-gray-800 dark:text-white text-xs">${staff.roomName || 'Server Room A'}</span>
                <span class="text-[11px] text-gray-500 dark:text-gray-400">${staff.floorName || '2nd Floor'} • ${staff.buildingName || 'Main Campus'}</span>
              </div>
            </div>
          </td>
          <td class="px-5 py-4">
            <div class="flex flex-col">
              <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">${staff.email}</span>
              <span class="text-[11px] text-gray-500 dark:text-gray-400">${staff.phone || 'No phone'}</span>
            </div>
          </td>
          <td class="px-5 py-4">${statusBadge}</td>
          <td class="px-5 py-4 text-gray-500 dark:text-gray-400 font-medium text-xs whitespace-nowrap" title="${formatDateTime(staff.created)}">${formatDateShort(staff.created)}</td>
          <td class="px-5 py-4 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="openEditStaffModal(event, '${staff.id}')" title="Edit Staff Details"
                class="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 transition-colors border-0 bg-transparent cursor-pointer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" onclick="event.stopPropagation(); toggleStaffStatus(event, '${staff.id}')" title="${isOnline ? 'Turn Offline (Logout)' : 'Turn Online (Activate)'}"
                class="p-1.5 rounded-lg transition-all border-0 bg-transparent cursor-pointer ${isOnline ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:scale-110 active:scale-95' : 'text-gray-400 dark:text-gray-500 hover:text-[#10b981] hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:scale-110 active:scale-95'}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>
                </svg>
              </button>
              <button onclick="requestArchiveStaff(event, '${staff.id}')" title="Archive Staff (Soft Delete)"
                class="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-600 dark:text-amber-400 hover:text-amber-500 transition-colors border-0 bg-transparent cursor-pointer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="21 8 21 21 3 21 3 8"></polyline>
                  <rect x="1" y="3" width="22" height="5"></rect>
                  <line x1="10" y1="12" x2="14" y2="12"></line>
                </svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Pagination info
  const pageInfo = document.getElementById('staffPageInfo');
  pageInfo.textContent = filtered.length === 0
    ? 'Showing 0 of 0'
    : `Showing ${start + 1}–${Math.min(end, filtered.length)} of ${filtered.length}`;

  document.getElementById('staffPrevBtn').disabled = currentPage <= 1;
  document.getElementById('staffNextBtn').disabled = currentPage >= totalPages;

  updateStats();
}

// Update stats
function updateStats() {
  const activeStaff = staffList.filter(s => !isStaffArchived(s));
  const online = activeStaff.filter(s => s.status === 'Online' || s.status === 'Active').length;
  const offline = activeStaff.filter(s => s.status === 'Offline' || s.status === 'Inactive').length;
  const archived = staffList.filter(s => isStaffArchived(s)).length;

  const staffCountEl = document.getElementById('staffCount');
  const activeCountEl = document.getElementById('activeCount');
  const inactiveCountEl = document.getElementById('inactiveCount');
  const archivedHeaderCountEl = document.getElementById('archivedHeaderCount');
  const archivedBadgeCountEl = document.getElementById('archivedBadgeCount');

  if (staffCountEl) staffCountEl.textContent = activeStaff.length;
  if (activeCountEl) activeCountEl.textContent = online;
  if (inactiveCountEl) inactiveCountEl.textContent = offline;
  if (archivedHeaderCountEl) archivedHeaderCountEl.textContent = archived;
  if (archivedBadgeCountEl) archivedBadgeCountEl.textContent = archived;

  const pageReportCountBadge = document.getElementById('pageReportCountBadge');
  if (pageReportCountBadge) {
    const tabReportsContent = document.getElementById('tabReportsContent');
    const isReportsTab = tabReportsContent && !tabReportsContent.classList.contains('hidden');
    if (isReportsTab) {
      const reports = window.EcoTrackMaintenance?.getReports?.() || [];
      pageReportCountBadge.textContent = `${reports.length} records`;
    } else {
      pageReportCountBadge.textContent = `${activeStaff.length} records`;
    }
  }
}

// ===== REGISTER MODAL =====

// ===================================================================
// CUSTOM WORKER ROLE DROPDOWN & ROLE MANAGEMENT (SELECT, ADD, DELETE)
// ===================================================================

const DEFAULT_STAFF_ROLES = [
  'HVAC / Aircon Technician',
  'Electrical & Power Specialist',
  'Sensor & IoT Calibration Specialist',
  'Refrigeration & Cooling Engineer',
  'General Maintenance & Facilities',
  'Preventive Maintenance Lead'
];

function getStaffRoles() {
  try {
    const stored = localStorage.getItem('ecoTrack_staff_roles');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [...DEFAULT_STAFF_ROLES];
}

function saveStaffRoles(roles) {
  try {
    localStorage.setItem('ecoTrack_staff_roles', JSON.stringify(roles));
  } catch (_) {}
}

function getRoleIcon(roleName) {
  if (!roleName) return '🔧';
  const lower = roleName.toLowerCase();
  if (lower.includes('hvac') || lower.includes('aircon') || lower.includes('cooling')) return '❄️';
  if (lower.includes('electric') || lower.includes('power')) return '⚡';
  if (lower.includes('sensor') || lower.includes('iot') || lower.includes('calibration')) return '📡';
  if (lower.includes('refriger')) return '🧊';
  if (lower.includes('lead') || lower.includes('supervisor') || lower.includes('manager')) return '🛡️';
  if (lower.includes('facility') || lower.includes('facilities') || lower.includes('general')) return '🛠️';
  return '🔧';
}

function renderRoleDropdown(prefix, selectedValue) {
  const selectEl = document.getElementById(prefix);
  const triggerText = document.getElementById(`${prefix}SelectedText`);
  const triggerIcon = document.getElementById(`${prefix}SelectedIcon`);
  const menu = document.getElementById(`${prefix}DropdownMenu`);
  if (!selectEl || !menu) return;

  const roles = getStaffRoles();
  let currentVal = selectedValue || selectEl.value || roles[0];
  if (!roles.includes(currentVal)) {
    currentVal = roles[0];
  }
  selectEl.value = currentVal;

  // Update hidden select options
  selectEl.innerHTML = roles.map(r => `<option value="${r}" ${r === currentVal ? 'selected' : ''}>${r}</option>`).join('');

  // Update trigger display
  if (triggerText) triggerText.textContent = currentVal;
  if (triggerIcon) triggerIcon.textContent = getRoleIcon(currentVal);

  // Render menu items with delete buttons
  menu.innerHTML = `
    <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 bg-emerald-50/70 dark:bg-[#081a14]/60 rounded flex items-center justify-between">
      <span>Available Worker Roles</span>
      <span class="text-[9px] font-medium text-gray-500 dark:text-gray-400">${roles.length} roles</span>
    </div>
    <div class="space-y-1">
      ${roles.map(r => {
        const isSel = r === currentVal;
        return `
          <div class="custom-role-item group flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150 ${isSel ? 'bg-emerald-50 dark:bg-[#10b981]/25 text-[#18392B] dark:text-emerald-300 font-bold border border-emerald-500/30 shadow-xs' : 'text-gray-700 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-[#10b981]/15 hover:text-[#10b981] dark:hover:text-emerald-300'}"
               data-role-val="${r}">
            <div class="flex items-center gap-2 min-w-0 flex-1 mr-2">
              <span class="text-xs shrink-0">${getRoleIcon(r)}</span>
              <span class="text-xs truncate font-semibold">${r}</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${isSel ? `
                <svg class="w-3.5 h-3.5 text-[#10b981] dark:text-emerald-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              ` : ''}
              <button type="button" class="btn-delete-role opacity-40 group-hover:opacity-100 hover:bg-rose-100 dark:hover:bg-rose-950/80 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded-md transition-all shrink-0"
                      title="Delete role: ${r}" data-delete-role="${r}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="pt-1.5 border-t border-gray-100 dark:border-white/10 mt-1">
      <div id="${prefix}AddNewRoleBtn" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer bg-emerald-50/80 dark:bg-[#08281b] text-emerald-700 dark:text-[#10b981] hover:bg-emerald-100 dark:hover:bg-[#0c3826] font-bold text-xs transition-colors">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Add Custom Role...</span>
      </div>
      <div id="${prefix}NewRolePanel" class="hidden p-2 mt-1.5 bg-emerald-50/90 dark:bg-[#081a14] border border-emerald-500/40 rounded-lg space-y-1.5">
        <input type="text" id="${prefix}NewRoleInput" placeholder="Enter new role title..."
          class="w-full bg-white dark:bg-[#0c1328] border border-gray-300 dark:border-[#10b981]/50 text-gray-800 dark:text-white rounded-md px-2 py-1 text-xs font-medium focus:outline-none focus:border-[#10b981]">
        <div class="flex items-center justify-end gap-1.5">
          <button type="button" id="${prefix}CancelNewRoleBtn" class="px-2 py-0.5 rounded text-[10px] text-gray-500 hover:text-gray-700 dark:text-gray-400 cursor-pointer">Cancel</button>
          <button type="button" id="${prefix}SaveNewRoleBtn" class="px-2.5 py-0.5 bg-[#10b981] text-white text-[10px] font-bold rounded hover:bg-emerald-600 transition-colors cursor-pointer">Save Role</button>
        </div>
      </div>
    </div>
  `;

  // Attach event handlers for role selection
  menu.querySelectorAll('.custom-role-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-role')) return;
      e.stopPropagation();
      const rVal = item.getAttribute('data-role-val');
      if (rVal) {
        selectEl.value = rVal;
        renderRoleDropdown(prefix, rVal);
      }
      closeRoleDropdown(prefix);
    });
  });

  // Attach delete role handlers
  menu.querySelectorAll('.btn-delete-role').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const roleToDelete = btn.getAttribute('data-delete-role');
      if (!roleToDelete) return;

      const currentRoles = getStaffRoles();
      if (currentRoles.length <= 1) {
        if (typeof showEcoTrackToast === 'function') {
          showEcoTrackToast('At least one role must remain available.', 'warning');
        }
        return;
      }

      const updated = currentRoles.filter(r => r !== roleToDelete);
      saveStaffRoles(updated);

      if (typeof showEcoTrackToast === 'function') {
        showEcoTrackToast(`Role "${roleToDelete}" deleted.`, 'warning');
      }

      // Re-render both dropdowns
      renderRoleDropdown('staffRole');
      renderRoleDropdown('editStaffRole');
    });
  });

  // Toggle add new role input
  const addBtn = document.getElementById(`${prefix}AddNewRoleBtn`);
  const panel = document.getElementById(`${prefix}NewRolePanel`);
  const cancelBtn = document.getElementById(`${prefix}CancelNewRoleBtn`);
  const saveBtn = document.getElementById(`${prefix}SaveNewRoleBtn`);
  const inputEl = document.getElementById(`${prefix}NewRoleInput`);

  addBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    panel?.classList.toggle('hidden');
    if (panel && !panel.classList.contains('hidden')) {
      inputEl?.focus();
    }
  });

  cancelBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    panel?.classList.add('hidden');
    if (inputEl) inputEl.value = '';
  });

  saveBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const newRole = inputEl?.value?.trim();
    if (!newRole) {
      if (typeof showEcoTrackToast === 'function') {
        showEcoTrackToast('Please enter a role name.', 'warning');
      }
      return;
    }
    const currentRoles = getStaffRoles();
    if (currentRoles.some(r => r.toLowerCase() === newRole.toLowerCase())) {
      if (typeof showEcoTrackToast === 'function') {
        showEcoTrackToast(`Role "${newRole}" already exists.`, 'warning');
      }
      return;
    }
    currentRoles.push(newRole);
    saveStaffRoles(currentRoles);
    if (typeof showEcoTrackToast === 'function') {
      showEcoTrackToast(`Role "${newRole}" added successfully!`, 'success');
    }
    panel?.classList.add('hidden');
    if (inputEl) inputEl.value = '';
    renderRoleDropdown(prefix, newRole);
    renderRoleDropdown(prefix === 'staffRole' ? 'editStaffRole' : 'staffRole');
  });
}

function openRoleDropdown(prefix) {
  const menu = document.getElementById(`${prefix}DropdownMenu`);
  const arrow = document.getElementById(`${prefix}DropdownArrow`);
  const trigger = document.getElementById(`${prefix}DropdownTrigger`);
  if (!menu) return;
  menu.classList.remove('hidden');
  if (arrow) arrow.style.transform = 'rotate(180deg)';
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
}

function closeRoleDropdown(prefix) {
  const menu = document.getElementById(`${prefix}DropdownMenu`);
  const arrow = document.getElementById(`${prefix}DropdownArrow`);
  const trigger = document.getElementById(`${prefix}DropdownTrigger`);
  if (!menu) return;
  menu.classList.add('hidden');
  if (arrow) arrow.style.transform = 'rotate(0deg)';
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function setupRoleDropdownListeners(prefix) {
  const trigger = document.getElementById(`${prefix}DropdownTrigger`);
  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById(`${prefix}DropdownMenu`);
    const otherPrefix = prefix === 'staffRole' ? 'editStaffRole' : 'staffRole';
    closeRoleDropdown(otherPrefix);
    if (menu && menu.classList.contains('hidden')) {
      openRoleDropdown(prefix);
    } else {
      closeRoleDropdown(prefix);
    }
  });
}

// Global click listener to close custom role dropdowns
if (!window._ecoRoleDropdownGlobalBound) {
  window._ecoRoleDropdownGlobalBound = true;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#staffRoleDropdownContainer') && !e.target.closest('#editStaffRoleDropdownContainer')) {
      closeRoleDropdown('staffRole');
      closeRoleDropdown('editStaffRole');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeRoleDropdown('staffRole');
      closeRoleDropdown('editStaffRole');
    }
  });
}


// Restrict phone numbers to max 11 digits and numeric only
function setupPhoneInputRestraints() {
  ['staffPhone', 'editStaffPhone'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('maxlength', '11');
    el.setAttribute('inputmode', 'numeric');

    const enforce11Digits = () => {
      let val = el.value.replace(/\D/g, '');
      if (val.startsWith('63') && val.length === 12) {
        val = '0' + val.substring(2);
      }
      if (val.length > 11) {
        val = val.slice(0, 11);
      }
      if (el.value !== val) {
        el.value = val;
      }
    };

    el.addEventListener('input', enforce11Digits);
    el.addEventListener('paste', () => setTimeout(enforce11Digits, 10));
    el.addEventListener('keypress', (e) => {
      if (!/[0-9]/.test(e.key)) {
        e.preventDefault();
      }
    });
  });
}

function openRegisterModal() {
  // Reset registration form and avatar preview
  window._registerStaffAvatarBase64 = '';
  const regImg = document.getElementById('registerAvatarImg');
  const regPlaceholder = document.getElementById('registerAvatarPlaceholder');
  const regInput = document.getElementById('registerAvatarFileInput');
  if (regImg) regImg.classList.add('hidden');
  if (regPlaceholder) regPlaceholder.classList.remove('hidden');
  if (regInput) regInput.value = '';
    
  const nameInput = document.getElementById('staffName');
  const emailInput = document.getElementById('staffEmail');
  const phoneInput = document.getElementById('staffPhone');
  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (phoneInput) phoneInput.value = '';

  const pInput = document.getElementById('staffPassword');
  const pcInput = document.getElementById('staffPasswordConfirm');
  if (pInput) { pInput.value = ''; pInput.type = 'password'; }
  if (pcInput) { pcInput.value = ''; pcInput.type = 'password'; }

  document.querySelectorAll('#registerStaffModal .password-toggle-btn').forEach(btn => {
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  });

  renderRoleDropdown('staffRole');
  populateLocationDropdowns();
  document.getElementById('registerStaffModal').classList.remove('hidden');
}

function closeRegisterModal() {
  document.getElementById('registerStaffModal').classList.add('hidden');
}

// ===== EDIT STAFF MODAL =====
function populateEditLocationDropdowns(selectedBldId, selectedFlrId, selectedRmId) {
  const bSelect = document.getElementById('editStaffBuilding');
  const fSelect = document.getElementById('editStaffFloor');
  const rSelect = document.getElementById('editStaffRoom');
  if (!bSelect || !fSelect || !rSelect) return;

  const bldOptions = [
    '<option value="all_buildings">All Buildings</option>',
    ..._buildingsData.map(b => `<option value="${b.id}">${b.name}</option>`)
  ];
  bSelect.innerHTML = bldOptions.join('');

  if (selectedBldId === 'all_buildings' || String(selectedBldId || '').toLowerCase().includes('all') || !_buildingsData.some(b => b.id === selectedBldId)) {
    if (selectedBldId === 'all_buildings' || String(selectedBldId || '').toLowerCase().includes('all')) {
      bSelect.value = 'all_buildings';
    } else if (selectedBldId && _buildingsData.some(b => b.id === selectedBldId)) {
      bSelect.value = selectedBldId;
    }
  } else {
    bSelect.value = selectedBldId;
  }

  function updateFloors() {
    const curBldId = bSelect.value;
    if (curBldId === 'all_buildings') {
      fSelect.innerHTML = '<option value="all_floors">All Floors</option>';
      fSelect.value = 'all_floors';
      updateRooms();
      return;
    }

    const filteredFloors = _floorsData.filter(f => !f.building_id || f.building_id === curBldId);
    const flrOptions = [
      '<option value="all_floors">All Floors</option>',
      ...filteredFloors.map(f => `<option value="${f.id}">${f.name}</option>`)
    ];
    fSelect.innerHTML = flrOptions.join('');

    if (selectedFlrId === 'all_floors' || String(selectedFlrId || '').toLowerCase().includes('all')) {
      fSelect.value = 'all_floors';
    } else if (selectedFlrId && filteredFloors.some(f => f.id === selectedFlrId)) {
      fSelect.value = selectedFlrId;
    } else {
      fSelect.value = 'all_floors';
    }
    updateRooms();
  }

  function updateRooms() {
    const curFlrId = fSelect.value;
    if (curFlrId === 'all_floors') {
      rSelect.innerHTML = '<option value="all_rooms">All Rooms</option>';
      rSelect.value = 'all_rooms';
      return;
    }

    const filteredRooms = _roomsData.filter(r => !r.floor_id || r.floor_id === curFlrId);
    const rmOptions = [
      '<option value="all_rooms">All Rooms</option>',
      ...filteredRooms.map(r => `<option value="${r.id}">${r.name}</option>`)
    ];
    rSelect.innerHTML = rmOptions.join('');

    if (selectedRmId === 'all_rooms' || String(selectedRmId || '').toLowerCase().includes('all') || !selectedRmId) {
      rSelect.value = 'all_rooms';
    } else if (selectedRmId && filteredRooms.some(r => r.id === selectedRmId)) {
      rSelect.value = selectedRmId;
    } else {
      rSelect.value = 'all_rooms';
    }
  }

  bSelect.onchange = () => { selectedFlrId = null; selectedRmId = null; updateFloors(); };
  fSelect.onchange = () => { selectedRmId = null; updateRooms(); };

  updateFloors();
}

function openEditStaffModal(event, staffId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return;

  const modal = document.getElementById('editStaffModal');
  if (!modal) return;

  document.getElementById('editStaffId').value = staff.id;
  document.getElementById('editStaffName').value = staff.name || '';
  
  renderRoleDropdown('editStaffRole', staff.role || 'HVAC / Aircon Technician');

  document.getElementById('editStaffEmail').value = staff.email || '';
  document.getElementById('editStaffPhone').value = staff.phone || '';
  
  const statusEl = document.getElementById('editStaffStatus');
  if (statusEl) {
    statusEl.value = (staff.status === 'Online' || staff.status === 'Active') ? 'Active' : (staff.status === 'On Leave' ? 'On Leave' : 'Offline');
  }

  window._editStaffAvatarBase64 = staff.avatar || '';
  const img = document.getElementById('editAvatarImg');
  const placeholder = document.getElementById('editAvatarPlaceholder');
  const fileInput = document.getElementById('editAvatarFileInput');
  if (fileInput) fileInput.value = '';

  if (staff.avatar && img) {
    img.src = staff.avatar;
    img.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');
  } else {
    if (img) img.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
  }

  const bldId = (staff.buildingName === 'All Buildings' || staff.buildingId === 'all_buildings' || (staff.assignment && staff.assignment.toLowerCase().includes('all building'))) ? 'all_buildings' : staff.buildingId;
  const flrId = (staff.floorName === 'All Floors' || staff.floorId === 'all_floors' || (staff.assignment && staff.assignment.toLowerCase().includes('all floor'))) ? 'all_floors' : staff.floorId;
  const rmId = (staff.roomName === 'All Rooms' || staff.roomId === 'all_rooms' || (staff.assignment && staff.assignment.toLowerCase().includes('all room')) || !staff.roomId) ? 'all_rooms' : staff.roomId;

  populateEditLocationDropdowns(bldId, flrId, rmId);

  modal.classList.remove('hidden');
}

function closeEditStaffModal() {
  const modal = document.getElementById('editStaffModal');
  if (modal) modal.classList.add('hidden');
}

async function saveEditStaff() {
  const staffId = document.getElementById('editStaffId').value;
  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return;

  const name = document.getElementById('editStaffName').value.trim();
  const email = document.getElementById('editStaffEmail').value.trim();
  const phone = document.getElementById('editStaffPhone').value.trim();
  const role = document.getElementById('editStaffRole')?.value || 'HVAC / Aircon Technician';
  const status = document.getElementById('editStaffStatus')?.value || 'Offline';

  if (!name) {
    showStaffInputError('editStaffName', 'Full name cannot be empty.');
    return;
  }
  if (!email || !email.includes('@')) {
    showStaffInputError('editStaffEmail', 'Please enter a valid email address.');
    return;
  }
  if (phone && phone.length !== 11) {
    showStaffInputError('editStaffPhone', 'Phone number must be exactly 11 digits (e.g. 09853308630).');
    return;
  }

  const bSelect = document.getElementById('editStaffBuilding');
  const fSelect = document.getElementById('editStaffFloor');
  const rSelect = document.getElementById('editStaffRoom');

  const buildingId = bSelect?.value || staff.buildingId || 'all_buildings';
  const buildingName = (bSelect?.selectedOptions && bSelect.selectedOptions[0]) ? bSelect.selectedOptions[0].text : (staff.buildingName || (buildingId === 'all_buildings' ? 'All Buildings' : 'Main Campus Building'));
  const floorId = fSelect?.value || staff.floorId || 'all_floors';
  const floorName = (fSelect?.selectedOptions && fSelect.selectedOptions[0]) ? fSelect.selectedOptions[0].text : (staff.floorName || (floorId === 'all_floors' ? 'All Floors' : '2nd Floor - IT Wing'));
  const roomId = rSelect?.value || staff.roomId || 'all_rooms';
  const roomName = (rSelect?.selectedOptions && rSelect.selectedOptions[0]) ? rSelect.selectedOptions[0].text : (staff.roomName || (roomId === 'all_rooms' ? 'All Rooms' : 'Server Room A'));

  staff.name = name;
  staff.email = email;
  staff.phone = phone;
  staff.role = role;
  staff.status = status;
  staff.isOnline = status === 'Active' || status === 'Online';
  staff.buildingId = buildingId;
  staff.buildingName = buildingName;
  staff.floorId = floorId;
  staff.floorName = floorName;
  staff.roomId = roomId;
  staff.roomName = roomName;
  staff.assignment = `${buildingName} • ${floorName} • ${roomName}`;

  if (window._editStaffAvatarBase64) {
    staff.avatar = window._editStaffAvatarBase64;
    staff.photo_url = window._editStaffAvatarBase64;
    staff.avatar_url = window._editStaffAvatarBase64;
  }

  // Persist to Supabase
  if (sb) {
    try {
      await sb.from('staff').update({
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        role: staff.role,
        status: staff.status,
        is_online: staff.isOnline,
        building_name: staff.buildingName,
        floor_name: staff.floorName,
        room_name: staff.roomName,
        room_id: staff.roomId === 'all_rooms' ? null : staff.roomId,
        assignment: staff.assignment,
        avatar_url: staff.avatar,
        photo_url: staff.avatar,
        updated: new Date().toISOString()
      }).eq('id', staff.id);
    } catch (err) {
      console.warn('[Supabase staff update error]:', err.message);
    }
  }

  saveStaff();
  closeEditStaffModal();
  renderTable();
  updateStats();
  showEcoTrackToast(`Updated ${staff.name} successfully!`, 'success');
}

// ===== CUSTOM TOAST NOTIFICATION SYSTEM =====
function showEcoTrackToast(message, type = 'info') {
  const container = document.getElementById('ecoTrackToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border text-sm font-semibold transition-all duration-300 toast-slide-in';

  let borderColor = 'border-cyan-500/40';
  let bgColor = 'bg-slate-900/95';
  let textColor = 'text-gray-100';
  let iconSvg = '';

  if (type === 'success') {
    borderColor = 'border-emerald-500/50';
    iconSvg = `<div class="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    </div>`;
  } else if (type === 'error') {
    borderColor = 'border-red-500/50';
    iconSvg = `<div class="w-7 h-7 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    </div>`;
  } else if (type === 'warning') {
    borderColor = 'border-amber-500/50';
    iconSvg = `<div class="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>`;
  } else {
    borderColor = 'border-cyan-500/50';
    iconSvg = `<div class="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>`;
  }

  toast.classList.add(borderColor, bgColor, textColor);
  toast.innerHTML = `
    ${iconSvg}
    <span class="flex-1">${message}</span>
    <button class="text-gray-400 hover:text-white transition-colors p-1 border-0 bg-transparent cursor-pointer ml-1">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  toast.querySelector('button').addEventListener('click', () => {
    toast.classList.remove('toast-slide-in');
    toast.classList.add('toast-slide-out');
    setTimeout(() => toast.remove(), 250);
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.remove('toast-slide-in');
      toast.classList.add('toast-slide-out');
      setTimeout(() => toast.remove(), 250);
    }
  }, 3800);
}

// ===== INPUT VALIDATION ERROR HIGHLIGHTER =====
function showStaffInputError(inputId, message) {
  const el = document.getElementById(inputId);
  if (el) {
    el.focus();
    el.classList.remove('animate-shake');
    void el.offsetWidth;
    el.classList.add('animate-shake');
    el.classList.add('border-red-500', 'focus:border-red-500');
    el.classList.remove('border-gray-200', 'dark:border-white/10');

    const removeHighlight = () => {
      el.classList.remove('border-red-500', 'focus:border-red-500');
      el.classList.add('border-gray-200', 'dark:border-white/10');
      el.removeEventListener('input', removeHighlight);
    };
    el.addEventListener('input', removeHighlight);
  }
  showEcoTrackToast(message, 'warning');
}

// ===== SUCCESS MODAL CONTROLLER =====
let _lastRegisteredStaffId = null;

function openStaffSuccessModal(staff) {
  const modal = document.getElementById('staffSuccessModal');
  if (!modal) return;

  _lastRegisteredStaffId = staff.id;

  const initials = staff.name
    ? staff.name.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2)
    : 'ST';

  const avatarEl = document.getElementById('successStaffAvatar');
  const avatarImgEl = document.getElementById('successStaffAvatarImg');
  const nameEl = document.getElementById('successStaffName');
  const emailEl = document.getElementById('successStaffEmail');
  const phoneEl = document.getElementById('successStaffPhone');
  const idEl = document.getElementById('successStaffId');
  const timeEl = document.getElementById('successStaffTime');

  if (staff.avatar && avatarImgEl) {
    avatarImgEl.src = staff.avatar;
    avatarImgEl.classList.remove('hidden');
    if (avatarEl) avatarEl.classList.add('hidden');
  } else {
    if (avatarImgEl) avatarImgEl.classList.add('hidden');
    if (avatarEl) {
      avatarEl.textContent = initials;
      avatarEl.classList.remove('hidden');
    }
  }
  if (nameEl) nameEl.textContent = staff.name;
  if (emailEl) emailEl.textContent = staff.email;
  if (phoneEl) {
    phoneEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
      <span>${staff.phone || 'No phone provided'}</span>
    `;
  }
  if (idEl) idEl.textContent = staff.id || 'stf_' + Date.now();
  if (timeEl) {
    const d = new Date();
    timeEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' today';
  }

  const roleEl = document.getElementById('successStaffRole');
  const locEl = document.getElementById('successStaffLocation');
  if (roleEl) roleEl.textContent = staff.role || 'HVAC / Aircon Technician';
  if (locEl) locEl.textContent = `${staff.roomName || 'Server Room A'} • ${staff.floorName || '2nd Floor'}, ${staff.buildingName || 'Main Campus'}`;

  modal.classList.remove('hidden');
}

function closeStaffSuccessModal(highlightId) {
  const modal = document.getElementById('staffSuccessModal');
  if (modal) modal.classList.add('hidden');

  // Switch to Registered Staff tab if on reports tab
  const tabStaffBtn = document.getElementById('tabStaffBtn');
  if (tabStaffBtn) tabStaffBtn.click();

  const targetId = highlightId || _lastRegisteredStaffId;
  if (targetId) {
    setTimeout(() => {
      const rows = document.querySelectorAll('#staffTableBody tr');
      rows.forEach(r => {
        if (r.innerHTML.includes(targetId)) {
          r.classList.add('bg-emerald-500/20', 'transition-colors', 'duration-700');
          r.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            r.classList.remove('bg-emerald-500/20');
          }, 2500);
        }
      });
    }, 200);
  }
}

// Add staff
function addStaff() {
  const name = document.getElementById('staffName').value.trim();
  const email = document.getElementById('staffEmail').value.trim();
  const phone = document.getElementById('staffPhone').value.trim();
  const password = document.getElementById('staffPassword').value;
  const confirmPassword = document.getElementById('staffPasswordConfirm').value;

  if (!name) {
    showStaffInputError('staffName', 'Please enter the staff\'s full name.');
    return;
  }
  if (!email || !email.includes('@')) {
    showStaffInputError('staffEmail', 'Please enter a valid email address.');
    return;
  }
  if (!password) {
    showStaffInputError('staffPassword', 'Please enter an account password.');
    return;
  }
  if (password.length < 6) {
    showStaffInputError('staffPassword', 'Password must be at least 6 characters long.');
    return;
  }
  if (password !== confirmPassword) {
    showStaffInputError('staffPasswordConfirm', 'Passwords do not match. Please re-check.');
    return;
  }

  // Check duplicate email
  if (staffList.some(s => s.email.toLowerCase() === email.toLowerCase())) {
    showStaffInputError('staffEmail', 'A staff member with this email already exists.');
    return;
  }

  const role = document.getElementById('staffRole')?.value || 'HVAC / Aircon Technician';
  const bSelect = document.getElementById('staffBuilding');
  const fSelect = document.getElementById('staffFloor');
  const rSelect = document.getElementById('staffRoom');

  const buildingId = bSelect?.value || 'all_buildings';
  const buildingName = (bSelect?.selectedOptions && bSelect.selectedOptions[0]) ? bSelect.selectedOptions[0].text : (buildingId === 'all_buildings' ? 'All Buildings' : 'Main Campus Building');
  const floorId = fSelect?.value || 'all_floors';
  const floorName = (fSelect?.selectedOptions && fSelect.selectedOptions[0]) ? fSelect.selectedOptions[0].text : (floorId === 'all_floors' ? 'All Floors' : '2nd Floor - IT Wing');
  const roomId = rSelect?.value || 'all_rooms';
  const roomName = (rSelect?.selectedOptions && rSelect.selectedOptions[0]) ? rSelect.selectedOptions[0].text : (roomId === 'all_rooms' ? 'All Rooms' : 'Server Room A');

  const newStaff = {
    id: 'stf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    name,
    email,
    phone,
    role,
    avatar: window._registerStaffAvatarBase64 || '',
    buildingId,
    buildingName,
    floorId,
    floorName,
    roomId,
    roomName,
    assignment: `${buildingName} • ${floorName} • ${roomName}`,
    status: 'Active',
    lastActive: new Date().toISOString(),
    created: new Date().toISOString()
  };

  // Sync to Supabase staff table
  if (sb) {
    const fullPayload = {
      name: newStaff.name,
      email: newStaff.email,
      phone: newStaff.phone,
      role: newStaff.role,
      building_name: newStaff.buildingName,
      floor_name: newStaff.floorName,
      room_name: newStaff.roomName,
      room_id: newStaff.roomId === 'all_rooms' ? null : newStaff.roomId,
      assignment: newStaff.assignment,
      status: newStaff.status,
      last_active: newStaff.lastActive
    };

    sb.from('staff').insert([fullPayload]).select().single().then(({ data, error }) => {
      if (error) {
        // Graceful fallback to base columns if new columns aren't in Supabase schema cache yet
        return sb.from('staff').insert([{
          name: newStaff.name,
          email: newStaff.email,
          phone: newStaff.phone,
          status: newStaff.status,
          last_active: newStaff.lastActive
        }]).select().single();
      }
      return { data, error };
    }).then(({ data, error }) => {
      if (!error && data) {
        newStaff.id = data.id;
        saveStaff();
        renderTable();
        const idEl = document.getElementById('successStaffId');
        if (idEl) idEl.textContent = data.id;
      }
    }).catch(console.warn);
  }

  staffList.push(newStaff);
  saveStaff();

  closeRegisterModal();
  renderTable();

  // Trigger modern premium success modal
  openStaffSuccessModal(newStaff);
}

// Toggle staff status between Online and Offline (Power button)
function toggleStaffStatus(eventOrId, possibleId) {
  if (eventOrId && typeof eventOrId === 'object') {
    if (typeof eventOrId.preventDefault === 'function') eventOrId.preventDefault();
    if (typeof eventOrId.stopPropagation === 'function') eventOrId.stopPropagation();
  }
  const targetId = (typeof eventOrId === 'string') ? eventOrId : possibleId;
  const staff = staffList.find(s => s.id === targetId);
  if (!staff) return;

  const isCurrentlyOnline = staff.status === 'Online' || staff.status === 'Active' || staff.isOnline === true;
  const newStatus = isCurrentlyOnline ? 'Offline' : 'Online';

  staff.status = newStatus;
  staff.isOnline = !isCurrentlyOnline;
  staff.lastActive = new Date().toISOString();

  saveStaff();
  renderTable();
  updateStats();

  if (isCurrentlyOnline) {
    showEcoTrackToast(`${staff.name} is now Offline (Logged Out).`, 'warning');
  } else {
    showEcoTrackToast(`${staff.name} is now Online (Active).`, 'success');
  }

  if (sb) {
    sb.from('staff').update({
      status: newStatus,
      is_online: !isCurrentlyOnline,
      last_active: staff.lastActive,
      updated: new Date().toISOString()
    }).eq('id', targetId).then();
  }
}

// ===== ARCHIVE / SOFT DELETE SYSTEM =====
let pendingArchiveId = null;
let pendingRestoreId = null;

function requestArchiveStaff(event, id) {
  if (event && typeof event.stopPropagation === 'function') {
    event.preventDefault();
    event.stopPropagation();
  }
  const targetId = typeof id === 'string' ? id : (typeof event === 'string' ? event : pendingArchiveId);
  const staff = staffList.find(s => s.id === targetId);
  if (!staff) return;
  pendingArchiveId = staff.id;

  const avatarEl = document.getElementById('archiveTargetAvatar');
  const avatarImgEl = document.getElementById('archiveTargetAvatarImg');
  const nameEl = document.getElementById('archiveTargetName');
  const roleEl = document.getElementById('archiveTargetRole');
  const locEl = document.getElementById('archiveTargetLocation');
  const reasonEl = document.getElementById('archiveStaffReason');
  const notesEl = document.getElementById('archiveStaffNotes');

  const initials = staff.name ? staff.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ST';
  if (staff.avatar && avatarImgEl) {
    avatarImgEl.src = staff.avatar;
    avatarImgEl.classList.remove('hidden');
    if (avatarEl) avatarEl.classList.add('hidden');
  } else {
    if (avatarImgEl) avatarImgEl.classList.add('hidden');
    if (avatarEl) {
      avatarEl.textContent = initials;
      avatarEl.classList.remove('hidden');
    }
  }

  if (nameEl) nameEl.textContent = staff.name;
  if (roleEl) roleEl.textContent = staff.role || 'HVAC / Aircon Technician';
  if (locEl) locEl.textContent = `${staff.roomName || 'Server Room A'} • ${staff.floorName || '2nd Floor'}, ${staff.buildingName || 'Main Campus'}`;
  if (reasonEl) reasonEl.selectedIndex = 0;
  if (notesEl) notesEl.value = '';

  const modal = document.getElementById('archiveStaffModal');
  if (modal) modal.classList.remove('hidden');
}

function closeArchiveModal() {
  pendingArchiveId = null;
  const modal = document.getElementById('archiveStaffModal');
  if (modal) modal.classList.add('hidden');
}

async function confirmArchiveStaff() {
  if (!pendingArchiveId) return;
  const staff = staffList.find(s => s.id === pendingArchiveId);
  if (!staff) return;

  const reason = document.getElementById('archiveStaffReason')?.value || 'Administrative / Compliance Deactivation';
  const notes = document.getElementById('archiveStaffNotes')?.value.trim() || '';

  staff.isArchived = true;
  staff.status = 'Archived';
  staff.isOnline = false;
  staff.archiveReason = reason;
  staff.archiveNotes = notes;
  staff.archivedAt = new Date().toISOString();

  saveStaff();
  closeArchiveModal();

  renderTable();
  renderArchivedTable();
  updateStats();

  showEcoTrackToast(`${staff.name} has been soft-deleted and moved to Archived Accounts.`, 'warning');

  if (sb) {
    try {
      const { error } = await sb.from('staff').update({
        status: 'Archived',
        is_archived: true,
        is_online: false,
        is_active: false,
        online_status: 'offline',
        archive_reason: reason,
        archive_notes: notes,
        archived_at: staff.archivedAt,
        updated: new Date().toISOString()
      }).eq('id', staff.id);

      if (error) {
        console.warn('Supabase archive error (using fallback):', error.message);
        await sb.from('staff').update({
          status: 'Archived',
          is_online: false,
          updated: new Date().toISOString()
        }).eq('id', staff.id);
      }
    } catch (err) {
      console.warn('Supabase archive exception:', err);
    }
  }
}

function renderArchivedTable() {
  const tbody = document.getElementById('archivedStaffTableBody');
  if (!tbody) return;

  const list = getFilteredArchivedStaff();

  const info = document.getElementById('archivedPageInfo');
  if (info) info.textContent = `Showing ${list.length} archived ${list.length === 1 ? 'account' : 'accounts'}`;

  if (!list || list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-16 text-center">
          <div class="flex flex-col items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
            </div>
            <p class="text-sm font-bold text-gray-500 dark:text-gray-400">No archived personnel accounts</p>
            <p class="text-xs text-gray-400">Technicians that have been soft-deleted will appear here with full historical records and deletion reasons.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  try {
    tbody.innerHTML = list.map(staff => {
      const name = staff.name || 'Unknown Technician';
      const id = staff.id || '';
      const idDisplay = id ? (id.length > 12 ? `${id.slice(0, 12)}...` : id) : 'stf_archived';
      const role = staff.role || 'HVAC / Aircon Technician';
      const room = staff.roomName || 'Server Room A';
      const floor = staff.floorName || '2nd Floor';
      const building = staff.buildingName || 'Main Campus';
      const reason = staff.archiveReason || 'Administrative Deactivation';
      const notes = staff.archiveNotes || '';
      const dateText = staff.archivedAt ? formatDateShort(staff.archivedAt) : 'Archived';
      const fullDateTitle = staff.archivedAt ? formatDateTime(staff.archivedAt) : 'Archived';

      const initials = name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'ST';
      const avatarHtml = staff.avatar
        ? `<img src="${staff.avatar}" class="w-9 h-9 rounded-xl object-cover border border-amber-500/40 shrink-0 shadow-sm" alt="${name}">`
        : `<div class="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center justify-center font-black text-xs shrink-0 shadow-sm">${initials}</div>`;

      return `
        <tr class="hover:bg-amber-500/5 transition-colors cursor-pointer" onclick="showArchivedDetails('${id}')">
          <td class="px-5 py-4">
            <div class="flex items-center gap-3">
              ${avatarHtml}
              <div>
                <span class="font-bold text-gray-800 dark:text-white block text-sm">${name}</span>
                <span class="text-[10px] text-gray-400 font-mono">ID: ${idDisplay}</span>
              </div>
            </div>
          </td>
          <td class="px-5 py-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
              <span>${role}</span>
            </span>
          </td>
          <td class="px-5 py-4">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center shrink-0 border border-amber-500/20">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
              </div>
              <div class="flex flex-col">
                <span class="font-bold text-gray-800 dark:text-white text-xs">${room}</span>
                <span class="text-[11px] text-gray-500 dark:text-gray-400">${floor} • ${building}</span>
              </div>
            </div>
          </td>
          <td class="px-5 py-4">
            <div class="flex flex-col gap-0.5">
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-500/30 w-fit">
                ${reason}
              </span>
              ${notes ? `<span class="text-[11px] text-gray-500 dark:text-gray-400 italic truncate max-w-xs mt-0.5">"${notes}"</span>` : ''}
            </div>
          </td>
          <td class="px-5 py-4 text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap" title="${fullDateTitle}">
            ${dateText}
          </td>
          <td class="px-5 py-4 text-center">
            <div class="flex items-center justify-center gap-1.5" onclick="event.stopPropagation()">
              <button onclick="showArchivedDetails('${id}')" title="View Full Archived Dossier"
                class="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-600 dark:text-amber-400 transition-colors border-0 bg-transparent cursor-pointer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button onclick="restoreStaff('${id}')" title="Restore Account to Active Directory"
                class="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs border border-emerald-500/30 transition-all flex items-center gap-1 cursor-pointer">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
                <span>Restore</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('[renderArchivedTable error]:', err);
  }
}

function showArchivedDetails(id) {
  const staff = staffList.find(s => s.id === id);
  if (!staff) return;

  pendingRestoreId = id;
  const modal = document.getElementById('archivedRecordDetailModal');
  if (!modal) return;

  const avatarEl = document.getElementById('archivedDetailAvatar');
  const avatarImgEl = document.getElementById('archivedDetailAvatarImg');
  const nameEl = document.getElementById('archivedDetailName');
  const roleEl = document.getElementById('archivedDetailRole');
  const reasonEl = document.getElementById('archivedDetailReason');
  const notesEl = document.getElementById('archivedDetailNotes');
  const dateEl = document.getElementById('archivedDetailDate');
  const emailEl = document.getElementById('archivedDetailEmail');
  const phoneEl = document.getElementById('archivedDetailPhone');
  const locEl = document.getElementById('archivedDetailLocation');
  const idEl = document.getElementById('archivedDetailId');

  const initials = staff.name ? staff.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ST';
  if (staff.avatar && avatarImgEl) {
    avatarImgEl.src = staff.avatar;
    avatarImgEl.classList.remove('hidden');
    if (avatarEl) avatarEl.classList.add('hidden');
  } else {
    if (avatarImgEl) avatarImgEl.classList.add('hidden');
    if (avatarEl) {
      avatarEl.textContent = initials;
      avatarEl.classList.remove('hidden');
    }
  }
  if (nameEl) nameEl.textContent = staff.name;
  if (roleEl) roleEl.textContent = staff.role || 'HVAC / Aircon Technician';
  if (reasonEl) reasonEl.textContent = staff.archiveReason || 'Administrative Deactivation';
  if (notesEl) notesEl.textContent = staff.archiveNotes || 'No specific notes recorded.';
  if (dateEl) dateEl.textContent = staff.archivedAt ? formatDateTime(staff.archivedAt) : 'Archived';
  if (emailEl) emailEl.textContent = staff.email;
  if (phoneEl) phoneEl.textContent = staff.phone || 'No phone';
  if (locEl) locEl.textContent = `${staff.roomName || 'Server Room A'} • ${staff.floorName || '2nd Floor'}, ${staff.buildingName || 'Main Campus'}`;
  if (idEl) idEl.textContent = staff.id;

  modal.classList.remove('hidden');
}

function closeArchivedDetailModal() {
  pendingRestoreId = null;
  const modal = document.getElementById('archivedRecordDetailModal');
  if (modal) modal.classList.add('hidden');
}

function restoreStaff(id) {
  const targetId = id || pendingRestoreId;
  const staff = staffList.find(s => s.id === targetId);
  if (!staff) return;

  staff.isArchived = false;
  staff.status = 'Offline';
  staff.isOnline = false;
  staff.lastActive = new Date().toISOString();
  delete staff.archivedAt;
  delete staff.archiveReason;
  delete staff.archiveNotes;

  saveStaff();
  closeArchivedDetailModal();

  renderTable();
  renderArchivedTable();
  updateStats();

  showEcoTrackToast(`${staff.name} has been restored to the Active Staff directory!`, 'success');

  if (sb) {
    sb.from('staff').update({
      status: 'Offline',
      is_archived: false,
      is_active: true,
      is_online: false,
      online_status: 'offline',
      archive_reason: null,
      archive_notes: null,
      archived_at: null,
      last_active: staff.lastActive,
      updated: new Date().toISOString()
    }).eq('id', staff.id).then(({ error }) => {
      if (error) {
        sb.from('staff').update({
          status: 'Offline',
          is_online: false,
          last_active: staff.lastActive,
          updated: new Date().toISOString()
        }).eq('id', staff.id).then();
      }
    }).catch(console.warn);
  }
}

// Supabase Realtime Staff Synchronization
function setupStaffRealtime() {
  if (sb && typeof sb.channel === 'function') {
    try {
      sb.channel('realtime-staff-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, payload => {
          console.log('[Supabase Realtime] Staff change received:', payload);
          loadStaffFromSupabase();
        })
        .subscribe();
    } catch (e) {
      console.warn('[Staff Realtime Error]:', e);
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  renderTable();
  renderArchivedTable();
  loadStaffFromSupabase();
  loadBuildingsFloorsRooms();
  setupStaffRealtime();

  // Register modal
  document.getElementById('openRegisterModalBtn')?.addEventListener('click', openRegisterModal);
  document.getElementById('closeRegisterModalBtn')?.addEventListener('click', closeRegisterModal);
  document.getElementById('cancelRegisterBtn')?.addEventListener('click', closeRegisterModal);
  document.getElementById('registerStaffModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'registerStaffModal') closeRegisterModal();
  });

  // Add staff
  document.getElementById('addStaffBtn')?.addEventListener('click', addStaff);

  // Search Active Staff
  document.getElementById('staffSearch')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    currentPage = 1;
    renderTable();
  });

  // Search Archived Staff
  document.getElementById('archivedSearch')?.addEventListener('input', (e) => {
    archivedSearchQuery = e.target.value;
    renderArchivedTable();
  });

  // Status filter
  document.getElementById('staffStatusFilter')?.addEventListener('change', (e) => {
    statusFilter = e.target.value;
    currentPage = 1;
    renderTable();
  });

  // Pagination
  document.getElementById('staffPrevBtn')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderTable(); }
  });
  document.getElementById('staffNextBtn')?.addEventListener('click', () => {
    const totalPages = Math.ceil(getFilteredStaff().length / PAGE_SIZE);
    if (currentPage < totalPages) { currentPage++; renderTable(); }
  });

  // Archive Modal Listeners
  document.getElementById('closeArchiveModalBtn')?.addEventListener('click', closeArchiveModal);
  document.getElementById('cancelArchiveBtn')?.addEventListener('click', closeArchiveModal);
  document.getElementById('confirmArchiveBtn')?.addEventListener('click', confirmArchiveStaff);
  document.getElementById('archiveStaffModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'archiveStaffModal') closeArchiveModal();
  });

  // Archived Detail Modal Listeners
  document.getElementById('closeArchivedDetailBtn')?.addEventListener('click', closeArchivedDetailModal);
  document.getElementById('archivedDetailCloseBtn')?.addEventListener('click', closeArchivedDetailModal);
  document.getElementById('archivedDetailRestoreBtn')?.addEventListener('click', () => restoreStaff());
  document.getElementById('archivedRecordDetailModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'archivedRecordDetailModal') closeArchivedDetailModal();
  });

  // Detail modal listeners
  const closeDetailBtn2 = document.getElementById('closeDetailModalBtn2');
  const detailEditStaffBtn = document.getElementById('detailEditStaffBtn');
  const detailModal = document.getElementById('staffDetailModal');
  
  if (closeDetailBtn2) {
    closeDetailBtn2.addEventListener('click', () => {
      detailModal.classList.add('hidden');
    });
  }
  if (detailEditStaffBtn) {
    detailEditStaffBtn.addEventListener('click', () => {
      if (detailModal) detailModal.classList.add('hidden');
      if (_currentDetailStaffId) {
        openEditStaffModal(null, _currentDetailStaffId);
      }
    });
  }
  if (detailModal) {
    detailModal.addEventListener('click', (e) => {
      if (e.target === detailModal) {
        detailModal.classList.add('hidden');
      }
    });
  }

  // Registration Success Modal listeners
  const successCloseBtn = document.getElementById('successCloseBtn');
  if (successCloseBtn) {
    successCloseBtn.addEventListener('click', () => closeStaffSuccessModal());
  }

  const successRegisterAnotherBtn = document.getElementById('successRegisterAnotherBtn');
  if (successRegisterAnotherBtn) {
    successRegisterAnotherBtn.addEventListener('click', () => {
      closeStaffSuccessModal();
      openRegisterModal();
    });
  }

  const successModal = document.getElementById('staffSuccessModal');
  if (successModal) {
    successModal.addEventListener('click', (e) => {
      if (e.target === successModal) {
        closeStaffSuccessModal();
      }
    });
  }

  // Register Staff Photo Uploader
  const regContainer = document.getElementById('registerAvatarContainer');
  const regInput = document.getElementById('registerAvatarFileInput');
  const regImg = document.getElementById('registerAvatarImg');
  const regPlaceholder = document.getElementById('registerAvatarPlaceholder');

  if (regContainer && regInput) {
    regContainer.addEventListener('click', () => regInput.click());
    regInput.addEventListener('change', () => {
      const file = regInput.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          window._registerStaffAvatarBase64 = e.target.result;
          if (regImg) {
            regImg.src = window._registerStaffAvatarBase64;
            regImg.classList.remove('hidden');
          }
          if (regPlaceholder) regPlaceholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Password Visibility Toggle Logic (2D Eye)
  document.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const input = btn.parentElement.querySelector('input');
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        btn.title = 'Hide Password';
      } else {
        input.type = 'password';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        btn.title = 'Show Password';
      }
    });
  });

  // Edit Staff Modal listeners
  document.getElementById('closeEditStaffModalBtn')?.addEventListener('click', closeEditStaffModal);
  document.getElementById('cancelEditStaffBtn')?.addEventListener('click', closeEditStaffModal);
  document.getElementById('saveEditStaffBtn')?.addEventListener('click', saveEditStaff);
  document.getElementById('editStaffModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'editStaffModal') closeEditStaffModal();
  });

  // Edit Staff Photo Uploader
  const editContainer = document.getElementById('editAvatarContainer');
  const editInput = document.getElementById('editAvatarFileInput');
  const editImg = document.getElementById('editAvatarImg');
  const editPlaceholder = document.getElementById('editAvatarPlaceholder');

  if (editContainer && editInput) {
    editContainer.addEventListener('click', () => editInput.click());
    editInput.addEventListener('change', () => {
      const file = editInput.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          window._editStaffAvatarBase64 = e.target.result;
          if (editImg) {
            editImg.src = window._editStaffAvatarBase64;
            editImg.classList.remove('hidden');
          }
          if (editPlaceholder) editPlaceholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
      }
    });
  }
});

// View staff details in modal
let _currentDetailStaffId = null;

function showStaffDetails(event, staffId) {
  // If clicked target is an action button, or inside the Actions column, don't trigger the modal
  if (event) {
    const closestTd = event.target.closest('td');
    if (closestTd && (closestTd.cellIndex === 6 || event.target.closest('button'))) {
      return;
    }
  }

  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return;
  _currentDetailStaffId = staff.id;

  const modal = document.getElementById('staffDetailModal');
  const avatar = document.getElementById('detailAvatar');
  const name = document.getElementById('detailName');
  const roleEl = document.getElementById('detailRole');
  const email = document.getElementById('detailEmail');
  const phone = document.getElementById('detailPhone');
  const bldEl = document.getElementById('detailBuilding');
  const flrEl = document.getElementById('detailFloor');
  const rmEl = document.getElementById('detailRoom');
  const status = document.getElementById('detailStatus');
  const created = document.getElementById('detailCreated');
  const lastActive = document.getElementById('detailLastActive');
  const onlineDot = document.getElementById('detailOnlineDot');

  if (!modal) return;

  // Output avatar photo or initials fallback
  const avatarImg = document.getElementById('detailAvatarImg');
  const initials = staff.name ? staff.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ST';

  if (staff.avatar && avatarImg) {
    avatarImg.src = staff.avatar;
    avatarImg.classList.remove('hidden');
    if (avatar) avatar.classList.add('hidden');
  } else {
    if (avatarImg) avatarImg.classList.add('hidden');
    if (avatar) {
      avatar.textContent = initials;
      avatar.classList.remove('hidden');
    }
  }
  
  const isOnline = staff.status === 'Online' || staff.status === 'Active';

  // Online indicator dot
  if (onlineDot) {
    if (isOnline) {
      onlineDot.className = 'absolute bottom-1 right-1 w-4 h-4 rounded-full bg-[#10b981] border-2 border-white dark:border-[#0c1328] z-10 shadow-sm animate-pulse';
    } else {
      onlineDot.className = 'absolute bottom-1 right-1 w-4 h-4 rounded-full bg-gray-400 dark:bg-slate-500 border-2 border-white dark:border-[#0c1328] z-10 shadow-sm';
    }
  }

  // Set data
  name.textContent = staff.name;
  if (roleEl) roleEl.textContent = staff.role || 'HVAC / Aircon Technician';
  email.textContent = staff.email;
  phone.textContent = staff.phone || '—';
  
  if (bldEl) bldEl.textContent = staff.buildingName || 'Main Campus';
  if (flrEl) flrEl.textContent = staff.floorName || '2nd Floor';
  if (rmEl) rmEl.textContent = staff.roomName || 'Server Room A';

  // Status with badge styling
  status.textContent = isOnline ? 'Online' : 'Offline';
  status.className = `block text-sm font-bold ${isOnline ? 'text-[#10b981]' : 'text-gray-400'}`;

  created.textContent = formatDateShort(staff.created);
  lastActive.textContent = formatDateTime(staff.lastActive);

  modal.classList.remove('hidden');
}

// Window global exports
window.isStaffArchived = isStaffArchived;
window.requestArchiveStaff = requestArchiveStaff;
window.closeArchiveModal = closeArchiveModal;
window.confirmArchiveStaff = confirmArchiveStaff;
window.restoreStaff = restoreStaff;
window.showArchivedDetails = showArchivedDetails;
window.closeArchivedDetailModal = closeArchivedDetailModal;
window.toggleStaffStatus = toggleStaffStatus;
window.openEditStaffModal = openEditStaffModal;
window.showStaffDetails = showStaffDetails;
window.renderTable = renderTable;
window.renderArchivedTable = renderArchivedTable;
window.loadStaffFromSupabase = loadStaffFromSupabase;



  // Setup Role Dropdowns
  setupRoleDropdownListeners('staffRole');
  setupRoleDropdownListeners('editStaffRole');
  renderRoleDropdown('staffRole');
  renderRoleDropdown('editStaffRole');

// Initialize phone input restraints
setupPhoneInputRestraints();
