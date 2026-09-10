// ===== NOTIFICATIONS PAGE LOGIC =====
const sb = window.supabaseClient || window.sb;
const pb = window.pb || (typeof PocketBase === 'function' ? new PocketBase() : null);
const notificationReadStateKey = 'ecoTrackNotificationReadState';

let selectedRoomId = null;
let messages = [];
let isNotifying = false;
let lastTriggeredIds = new Set();
let buildings = {};
let floors = {};
let rooms = {};
let currentViewMessageId = null;
let currentNotificationFilter = 'all';
let pendingDeleteMessageId = null;
let isInitializing = false;

// ===== 12-HOUR TIME FORMATTING HELPERS =====
function formatTime12Hour(timeStr) {
  if (!timeStr) return '';
  const str = String(timeStr).trim();

  // If already formatted with AM/PM
  const ampmMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(str);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const seconds = ampmMatch[3];
    const period = ampmMatch[4].toUpperCase();
    if (hours === 0) hours = 12;
    else if (hours > 12) hours = hours % 12 || 12;
    const formattedHours = String(hours).padStart(2, '0');
    return seconds !== undefined
      ? `${formattedHours}:${minutes}:${seconds} ${period}`
      : `${formattedHours}:${minutes} ${period}`;
  }

  // 24-hour time string: HH:MM or HH:MM:SS
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const seconds = match[3];
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const formattedHours = String(hours).padStart(2, '0');
    return seconds !== undefined
      ? `${formattedHours}:${minutes}:${seconds} ${period}`
      : `${formattedHours}:${minutes} ${period}`;
  }

  // Fallback for ISO date string or Date-parseable string
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const hasSeconds = str.includes(':') && str.split(':').length > 2;
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: hasSeconds ? '2-digit' : undefined,
      hour12: true
    });
  }

  return str;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr).trim();
  const match12 = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(str);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const period = match12[4].toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const match24 = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }
  return null;
}

// ===== TARGET SENSOR / NODE EXTRACTION HELPER =====
function extractTargetNodes(content, roomRef, explicitNodeId = null) {
  let actualContent = content ? String(content).trim() : '';
  let specificNode = explicitNodeId || null;

  // 1. Explicit pipe prefix: "node-X|||actual message"
  if (actualContent && actualContent.includes('|||')) {
    const parts = actualContent.split('|||');
    specificNode = parts[0].trim();
    actualContent = parts.slice(1).join('|||').trim();
  }

  // 2. Parenthetical or bracketed pattern: "(node-6 - room 1)", "(node-6)", "[node-6 - room 1]"
  if (!specificNode && actualContent) {
    const parenMatch = /\(\s*([a-zA-Z0-9_\-]+)\s*(?:-|–|—|,|\/)\s*[^)]+\)/i.exec(actualContent) ||
                       /\(\s*(node[-\s_]?\d+|sensor[-\s_]?\d+|AC[-\s_]?\d+)\s*\)/i.exec(actualContent) ||
                       /\[\s*([a-zA-Z0-9_\-]+)\s*(?:-|–|—|,|\/)\s*[^\]]+\]/i.exec(actualContent);
    if (parenMatch) {
      specificNode = parenMatch[1].trim();
    }
  }

  const roomNodes = Array.isArray(roomRef?.nodes) ? roomRef.nodes : [];

  // 3. Match against known nodes in current room
  if (!specificNode && actualContent && roomNodes.length > 0) {
    const matchedRoomNodes = [];
    for (const n of roomNodes) {
      const nodeName = typeof n === 'string' ? n : (n.name || n.id || '');
      const nodeId = typeof n === 'string' ? n : (n.id || n.name || '');
      if (!nodeName && !nodeId) continue;

      const escName = (nodeName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escId = (nodeId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const regexName = new RegExp('(^|[^a-zA-Z0-9_-])' + escName + '([^a-zA-Z0-9_-]|$)', 'i');
      const regexId = escId && escId !== escName ? new RegExp('(^|[^a-zA-Z0-9_-])' + escId + '([^a-zA-Z0-9_-]|$)', 'i') : null;

      if (regexName.test(actualContent) || (regexId && regexId.test(actualContent))) {
        matchedRoomNodes.push(nodeName || nodeId);
      }
    }

    if (matchedRoomNodes.length > 0) {
      return {
        specificNodeId: matchedRoomNodes[0],
        nodeNames: matchedRoomNodes,
        actualContent: actualContent
      };
    }
  }

  // 4. Match against all registered nodes globally across rooms
  if (!specificNode && actualContent && typeof rooms === 'object') {
    for (const r of Object.values(rooms || {})) {
      if (!Array.isArray(r?.nodes)) continue;
      for (const n of r.nodes) {
        const nodeName = typeof n === 'string' ? n : (n.name || n.id || '');
        if (!nodeName) continue;
        const esc = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(^|[^a-zA-Z0-9_-])' + esc + '([^a-zA-Z0-9_-]|$)', 'i');
        if (re.test(actualContent)) {
          specificNode = nodeName;
          break;
        }
      }
      if (specificNode) break;
    }
  }

  // 5. Generic sensor regex fallback: "node-X" or "sensor-X"
  if (!specificNode && actualContent) {
    const genericMatch = /(?:^|[^a-zA-Z0-9_-])(node[-\s_]?\d+|sensor[-\s_]?\d+)(?:[^a-zA-Z0-9_-]|$)/i.exec(actualContent);
    if (genericMatch) {
      specificNode = genericMatch[1].trim();
    }
  }

  // If a specific node was found, look up its proper object and friendly display name
  if (specificNode) {
    let friendlyName = specificNode;
    const nodeObj = roomNodes.find(n => 
      (typeof n === 'string' ? n.toLowerCase() === specificNode.toLowerCase() : 
       (n.id && n.id.toLowerCase() === specificNode.toLowerCase()) || 
       (n.name && n.name.toLowerCase() === specificNode.toLowerCase()))
    );
    if (nodeObj) {
      friendlyName = typeof nodeObj === 'string' ? nodeObj : (nodeObj.name || nodeObj.id);
    }
    return {
      specificNodeId: specificNode,
      nodeNames: [friendlyName],
      actualContent: actualContent
    };
  }

  // Room-wide message (no single node targeted)
  return {
    specificNodeId: null,
    nodeNames: [],
    actualContent: actualContent
  };
}

async function setupNotificationsPage() {
  if (isInitializing) return;
  isInitializing = true;
  try {
    await initializeNotifications();
    if (typeof resetNotificationCount === 'function') {
      resetNotificationCount();
    }
  } finally {
    isInitializing = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNotificationsPage);
} else {
  // Use a microtask so the DOM is fully ready even if readyState is 'interactive'
  Promise.resolve().then(setupNotificationsPage);
}

window.addEventListener('page:init', () => {
  if (window.location.pathname.includes('notifications.html') || window.location.hash.includes('notifications')) {
    setupNotificationsPage();
  }
});

async function initializeNotifications() {
  // Load rooms from database first
  await loadRooms();

  // Load messages from Supabase
  await loadNotificationMessages();

  // 1. Read URL query parameters (?room=..., ?notif=..., ?id=..., ?highlight=...)
  const urlParams = new URLSearchParams(window.location.search);
  const targetRoomParam = urlParams.get('room') || urlParams.get('roomId');
  const targetNotifParam = urlParams.get('notif') || urlParams.get('id') || urlParams.get('highlight');
  const targetSensorParam = urlParams.get('sensor');

  // 2. Read sessionStorage pendingNav or localStorage fallback
  let pendingNav = null;
  const pendingNavStr = sessionStorage.getItem('pendingNav');
  if (pendingNavStr) {
    try {
      pendingNav = JSON.parse(pendingNavStr);
      sessionStorage.removeItem('pendingNav');
    } catch (_) {}
  }
  if (!pendingNav) {
    const localNavStr = localStorage.getItem('ecoTrack_pendingNotificationNav');
    if (localNavStr) {
      try {
        const parsed = JSON.parse(localNavStr);
        if (!parsed.timestamp || (Date.now() - parsed.timestamp < 300000)) {
          pendingNav = parsed;
        }
        localStorage.removeItem('ecoTrack_pendingNotificationNav');
      } catch (_) {}
    }
  }

  const roomToSelectId = targetRoomParam || pendingNav?.room;
  const notifToHighlightId = targetNotifParam || pendingNav?.notif || pendingNav?.highlight;
  const sensorToHighlight = targetSensorParam || pendingNav?.sensor;
  const messageSnippet = pendingNav?.message || pendingNav?.content || '';

  let targetRoom = null;
  if (roomToSelectId && rooms[roomToSelectId]) {
    targetRoom = rooms[roomToSelectId];
  } else if (roomToSelectId) {
    targetRoom = Object.values(rooms).find(r => 
      String(r.id) === String(roomToSelectId) || 
      (r.name && r.name.toLowerCase() === String(roomToSelectId).toLowerCase())
    );
  }

  if (!targetRoom && notifToHighlightId) {
    const cleanId = String(notifToHighlightId).trim();
    const foundMsg = messages.find(m => String(m.id) === cleanId || String(m.pbId) === cleanId);
    if (foundMsg && foundMsg.room && rooms[foundMsg.room]) {
      targetRoom = rooms[foundMsg.room];
    }
  }

  if (!targetRoom && sensorToHighlight) {
    const cleanSensor = String(sensorToHighlight).toLowerCase().trim();
    for (const r of Object.values(rooms)) {
      if (r.nodes?.some(n => {
        if (typeof n === 'string') return n.toLowerCase() === cleanSensor;
        return (n.name && n.name.toLowerCase() === cleanSensor) || (n.id && String(n.id).toLowerCase() === cleanSensor);
      })) {
        targetRoom = r;
        break;
      }
    }
  }

  if (!targetRoom && messageSnippet) {
    const cleanSnippet = messageSnippet.split('|||').pop().trim();
    const foundMsg = messages.find(m => m.content && (m.content.includes(cleanSnippet.substring(0, 25)) || cleanSnippet.includes(m.content.substring(0, 25))));
    if (foundMsg && foundMsg.room && rooms[foundMsg.room]) {
      targetRoom = rooms[foundMsg.room];
    }
  }

  if (!targetRoom) {
    // Auto-select the room with unread notifications, or the first room
    const roomWithUnread = Object.values(rooms).find(r => 
      messages.some(m => m.room === r.id && !m.read && m.triggered)
    );

    if (roomWithUnread) {
      targetRoom = roomWithUnread;
    } else if (Object.keys(rooms).length > 0) {
      targetRoom = Object.values(rooms)[0];
    }
  }

  if (targetRoom) {
    selectRoom(targetRoom);
  }
  
  // Setup event listeners
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshMessages);
  const addBtn = document.getElementById('addMessageBtn');
  if (addBtn) addBtn.addEventListener('click', openMessageModal);
  document.getElementById('closeMessageModal').addEventListener('click', closeMessageModal);
  document.getElementById('closeMessageModalBtn').addEventListener('click', closeMessageModal);
  document.getElementById('autoSendBtn').addEventListener('click', addMessage);
  const notifyBtn = document.getElementById('notifyToggleBtn');
  if (notifyBtn) notifyBtn.addEventListener('click', toggleNotifications);
  const filterAllBtn = document.getElementById('notificationFilterAllBtn');
  const filterUnreadBtn = document.getElementById('notificationFilterUnreadBtn');
  const filterReadBtn = document.getElementById('notificationFilterReadBtn');
  if (filterAllBtn) filterAllBtn.addEventListener('click', () => setNotificationFilter('all'));
  if (filterUnreadBtn) filterUnreadBtn.addEventListener('click', () => setNotificationFilter('unread'));
  if (filterReadBtn) filterReadBtn.addEventListener('click', () => setNotificationFilter('read'));
  const clearAllMessagesBtn = document.getElementById('clearAllMessagesBtn');
  if (clearAllMessagesBtn) clearAllMessagesBtn.addEventListener('click', openClearAllModal);

  // Initialize Selected AC Sensors collapsible container
  initSelectedNodesCollapse();
  
  // Clear All confirmation modal listeners
  const confirmClearAllBtn = document.getElementById('confirmClearAllBtn');
  if (confirmClearAllBtn) confirmClearAllBtn.addEventListener('click', () => {
    closeClearAllModal();
    clearAllMessages();
  });
  const cancelClearAllBtn = document.getElementById('cancelClearAllBtn');
  if (cancelClearAllBtn) cancelClearAllBtn.addEventListener('click', closeClearAllModal);
  const clearAllModal = document.getElementById('clearAllModal');
  if (clearAllModal) clearAllModal.addEventListener('click', (e) => {
    if (e.target.id === 'clearAllModal') closeClearAllModal();
  });
  document.getElementById('closeViewMessageModal').addEventListener('click', closeViewMessageModal);
  const dismissViewModalBtn = document.getElementById('dismissViewModalBtn');
  if (dismissViewModalBtn) dismissViewModalBtn.addEventListener('click', closeViewMessageModal);
  document.getElementById('closeViewModalBtn').addEventListener('click', () => {
    if (currentViewMessageId) {
      deleteMessage(currentViewMessageId);
    }
  });

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', confirmDeleteMessage);
  
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', cancelDeleteMessage);
  
  const confirmDeleteModal = document.getElementById('confirmDeleteModal');
  if (confirmDeleteModal) confirmDeleteModal.addEventListener('click', (e) => {
    if (e.target.id === 'confirmDeleteModal') cancelDeleteMessage();
  });
  
  // Global notification dialog listeners
  if (document.getElementById('goToNotificationsBtn')) {
    document.getElementById('goToNotificationsBtn').addEventListener('click', () => {
      window.location.href = 'Notification.html';
    });
  }
  
  // Close modal when clicking outside
  document.getElementById('messageModal').addEventListener('click', (e) => {
    if (e.target.id === 'messageModal') {
      closeMessageModal();
    }
  });
  
  // Close view modal when clicking outside
  document.getElementById('viewMessageModal').addEventListener('click', (e) => {
    if (e.target.id === 'viewMessageModal') {
      closeViewMessageModal();
    }
  });
  
  // Start checking for triggered notifications
  startNotificationCheck();
  
  // Auto-focus, highlight, and open target notification
  if (notifToHighlightId || sensorToHighlight || messageSnippet) {
    setTimeout(() => {
      focusAndOpenNotification(notifToHighlightId, {
        sensor: sensorToHighlight,
        message: messageSnippet,
        room: roomToSelectId || targetRoom?.id
      });
    }, 250);
  }
}

// Function to focus, scroll into view, highlight, and open modal for a specific notification
async function focusAndOpenNotification(targetId, context = {}) {
  // If no targetId and no context, nothing to do
  if (!targetId && !context.sensor && !context.message && !context.room) return;

  const cleanTargetId = targetId ? String(targetId).trim() : '';

  // 1. Search existing messages array
  let msg = null;
  if (cleanTargetId && cleanTargetId !== 'null' && cleanTargetId !== 'undefined') {
    msg = messages.find(m => String(m.id) === cleanTargetId || String(m.pbId) === cleanTargetId);
  }

  // 2. If not found by ID, try finding by message content snippet or sensor name
  if (!msg && context.message) {
    const snippet = context.message.split('|||').pop().trim();
    msg = messages.find(m => m.content && (m.content.includes(snippet.substring(0, 25)) || snippet.includes(m.content.substring(0, 25))));
  }
  if (!msg && context.sensor) {
    const cleanSensor = String(context.sensor).toLowerCase().trim();
    msg = messages.find(m => {
      if (m.node && String(m.node).toLowerCase().includes(cleanSensor)) return true;
      if (m.content && m.content.toLowerCase().includes(cleanSensor)) return true;
      return false;
    });
  }

  // 3. If still not found and Supabase is available, re-fetch latest records
  if (!msg && sb) {
    try {
      await loadNotificationMessages();
      if (cleanTargetId && cleanTargetId !== 'null' && cleanTargetId !== 'undefined') {
        msg = messages.find(m => String(m.id) === cleanTargetId || String(m.pbId) === cleanTargetId);
      }
      if (!msg && context.message) {
        const snippet = context.message.split('|||').pop().trim();
        msg = messages.find(m => m.content && (m.content.includes(snippet.substring(0, 25)) || snippet.includes(m.content.substring(0, 25))));
      }
    } catch (_) {}
  }

  // 4. Resolve and switch room if needed
  const targetRoomId = (msg && msg.room) || context.room || (context.room_id) || selectedRoomId;
  if (targetRoomId && targetRoomId !== selectedRoomId) {
    const rObj = rooms[targetRoomId] || Object.values(rooms).find(r => 
      String(r.id) === String(targetRoomId) || 
      (r.name && r.name.toLowerCase() === String(targetRoomId).toLowerCase())
    );
    if (rObj) {
      selectRoom(rObj);
    }
  }

  // 5. If still no specific message found, pick the newest triggered notification in this room
  if (!msg && targetRoomId) {
    const roomAlerts = messages.filter(m => m.room === targetRoomId && m.triggered);
    if (roomAlerts.length > 0) {
      msg = roomAlerts[roomAlerts.length - 1];
    }
  }

  // 6. Ensure filter is set to 'all' so rows are present in the DOM
  setNotificationFilter('all');

  const effectiveId = msg?.id || cleanTargetId;
  setTimeout(() => {
    if (effectiveId) {
      const row = document.querySelector(`tr[data-id="${effectiveId}"]`) ||
                  (msg?.id ? document.querySelector(`tr[data-id="${msg.id}"]`) : null);
      if (row) {
        row.classList.add('bg-emerald-50', 'dark:bg-emerald-950/40', 'border-2', 'border-[#10b981]', 'shadow-lg', 'highlighted-alert');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    if (msg) {
      markMessageAsRead(msg.id);
      openViewMessageModal(msg);
    } else if (context.message || context.sensor) {
      // Ephemeral fallback message so modal ALWAYS opens with the alert content
      const fallbackMsg = {
        id: cleanTargetId || 'alert_' + Date.now(),
        room: targetRoomId || selectedRoomId,
        content: context.message || 'EcoTrack Threshold Alert',
        node: context.sensor || '',
        date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        read: false,
        triggered: true
      };
      openViewMessageModal(fallbackMsg);
    }
  }, 200);
}

window.focusAndOpenNotification = focusAndOpenNotification;

// Global click handler to dismiss alert highlight
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr.highlighted-alert');
  if (row) {
    row.classList.remove('bg-emerald-50', 'dark:bg-emerald-950/40', 'border-2', 'border-[#10b981]', 'shadow-lg', 'highlighted-alert');
  }
});

async function loadRooms() {
  const roomsList = document.getElementById('roomsList');
  
  try {
    let roomRecords = [];
    let floorRecords = [];
    let buildingRecords = [];
    let nodeRecords = [];

    if (sb) {
      const [rRes, fRes, bRes, nRes] = await Promise.all([
        sb.from('rooms').select('*').order('created'),
        sb.from('floors').select('*').order('created'),
        sb.from('buildings').select('*').order('created'),
        sb.from('nodes').select('*')
      ]);
      roomRecords = rRes.data || [];
      floorRecords = fRes.data || [];
      buildingRecords = bRes.data || [];
      nodeRecords = nRes.data || [];
    }
    
    rooms = {};
    buildings = {};
    floors = {};
    
    buildingRecords.forEach(b => buildings[b.id] = b);
    floorRecords.forEach(f => floors[f.id] = f);
    
    roomRecords.forEach(record => {
      const roomNodes = nodeRecords
        .filter(n => n.room_id === record.id)
        .map(n => ({
          id: n.name,
          pb_id: n.id,
          name: n.name,
          aircon_type: n.aircon_type || 'Split Type (Inverter)',
          status: n.status || 'offline',
          temp: n.temp || 0,
          pressure: n.pressure || 0,
          battery: n.battery || 0,
          rssi: n.rssi || 0
        }));
      rooms[record.id] = { ...record, nodeLimit: record.node_limit || 5, nodes: roomNodes };
    });
  } catch (error) {
    console.warn('Supabase load error (rooms):', error);
  }
  
  renderHierarchy();
}

function renderHierarchy() {
  const roomsList = document.getElementById('roomsList');
  roomsList.innerHTML = '';
  
  if (Object.keys(buildings).length === 0 && Object.keys(rooms).length === 0) {
    roomsList.innerHTML = '<div class="text-sm text-gray-500 text-center mt-4">No locations available.</div>';
    return;
  }
  
  const buildingFloors = {};
  Object.values(buildings).forEach(b => buildingFloors[b.id] = []);
  Object.values(floors).forEach(f => {
    if (buildingFloors[f.building_id]) buildingFloors[f.building_id].push(f);
  });
  
  const floorRooms = {};
  Object.values(floors).forEach(f => floorRooms[f.id] = []);
  Object.values(rooms).forEach(r => {
    if (r.floor_id && floorRooms[r.floor_id]) floorRooms[r.floor_id].push(r);
  });
  
  Object.values(buildings).forEach(building => {
    const bDiv = document.createElement('div');
    bDiv.className = 'mb-2';
    
    const bHeader = document.createElement('div');
    bHeader.className = 'flex items-center gap-2 bg-[#10b981]/10 px-3 py-2 rounded-t border-b border-[#10b981]/30 dark:border-[#10b981]/20 cursor-pointer hover:bg-[#10b981]/20 transition-colors';
    bHeader.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="text-[#10b981]">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <span class="font-bold text-[#18392B] dark:text-[#a7f3d0] text-sm">${building.name}</span>
    `;
    
    const floorsContainer = document.createElement('div');
    floorsContainer.className = 'bg-white dark:bg-slate-900 border-x border-b border-gray-200 dark:border-white/5 rounded-b p-2 flex flex-col gap-2';
    
    bHeader.addEventListener('click', () => {
      floorsContainer.style.display = floorsContainer.style.display === 'none' ? 'flex' : 'none';
    });
    
    const myFloors = buildingFloors[building.id] || [];
    if (myFloors.length === 0) floorsContainer.innerHTML = '<div class="text-xs text-gray-400 dark:text-gray-500 p-2 text-center">No floors</div>';
    
    myFloors.forEach(floor => {
      const fDiv = document.createElement('div');
      fDiv.className = 'border border-gray-100 dark:border-white/5 rounded bg-gray-50 dark:bg-slate-950/40';
      
      const fHeader = document.createElement('div');
      fHeader.className = 'flex items-center px-2 py-1 border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800/60';
      fHeader.innerHTML = `
        <span class="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400 dark:text-gray-500">
             <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
             <line x1="4" y1="12" x2="20" y2="12" />
          </svg>${floor.name}
        </span>
      `;
      
      const roomsContainer = document.createElement('div');
      roomsContainer.className = 'p-1 flex flex-col gap-1';
      
      fHeader.addEventListener('click', () => {
        roomsContainer.style.display = roomsContainer.style.display === 'none' ? 'flex' : 'none';
      });
      
      const myRooms = floorRooms[floor.id] || [];
      if (myRooms.length === 0) roomsContainer.innerHTML = '<div class="text-[10px] text-gray-400 dark:text-gray-500 p-1 text-center">No rooms</div>';
      
      myRooms.forEach(room => {
        const roomItem = document.createElement('div');
        const occupancy = room.nodeLimit > 0 ? Math.min((room.nodes.length / room.nodeLimit) * 100, 100) : 0;
        roomItem.className = 'room-item bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/5 p-2 rounded cursor-pointer relative hover:border-[#10b981] transition-colors';
        roomItem.setAttribute('data-room', room.id);
        roomItem.innerHTML = `
          <span id="roomBadge-${room.id}" class="hidden absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow-sm z-10">0</span>
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-xs font-bold text-[#18392B] dark:text-[#a7f3d0] truncate">${room.name}</p>
              <p class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">${room.nodes.length} ac sensor nodes</p>
            </div>
          </div>
        `;
        roomItem.addEventListener('click', (e) => {
          e.stopPropagation();
          selectRoom(room);
        });
        roomsContainer.appendChild(roomItem);
      });
      
      fDiv.appendChild(fHeader);
      fDiv.appendChild(roomsContainer);
      floorsContainer.appendChild(fDiv);
    });
    
    bDiv.appendChild(bHeader);
    bDiv.appendChild(floorsContainer);
    roomsList.appendChild(bDiv);
  });
}

function selectRoom(room) {
  if (!room) return;
  const resolvedRoom = typeof room === 'string' ? (rooms[room] || { id: room }) : (rooms[room.id] || room);
  selectedRoomId = String(resolvedRoom.id || '').trim();
  
  // Update selection styling
  document.querySelectorAll('.room-item').forEach(item => {
    item.classList.remove('border-[#18392B]', 'bg-green-50', 'shadow-md', 'dark:border-[#10b981]', 'dark:bg-emerald-950/20');
    item.classList.add('border-[#10b981]', 'bg-white', 'dark:border-white/10', 'dark:bg-slate-900/60');
    item.setAttribute('aria-selected', 'false');
  });
  
  const roomEl = document.querySelector(`[data-room="${resolvedRoom.id}"]`);
  if (roomEl) {
    roomEl.classList.remove('border-[#10b981]', 'bg-white', 'dark:border-white/10', 'dark:bg-slate-900/60');
    roomEl.classList.add('border-[#18392B]', 'bg-green-50', 'shadow-md', 'dark:border-[#10b981]', 'dark:bg-emerald-950/20');
    roomEl.setAttribute('aria-selected', 'true');
  }
  
  // Display nodes for selected room
  displayRoomNodes(resolvedRoom);
  
  // Show messages table when room is selected
  const tableContainer = document.getElementById('messagesTableContainer');
  if (tableContainer) {
    tableContainer.classList.remove('hidden');
  }

  // Render what we already have immediately so the table is never blank
  updateMessagesTable();

  // Then silently refresh from Supabase in the background to catch any new records
  if (sb) {
    sb.from('notifications').select('*').order('created', { ascending: false })
      .then(({ data: records, error }) => {
        if (error || !records) return;
        const readState = loadReadStateMap();

        // Sync all violation records to persistent audit store
        if (typeof saveViolationToAuditHistory === 'function') {
          (records || []).forEach(r => {
            if (isRuleViolationNotification(r)) {
              saveViolationToAuditHistory(r);
            }
          });
        }

        const activeRecords = (records || []).filter(r => !isInboxDismissedNotification(r.content || r.message));
        const freshMessages = activeRecords.map(r => {
          let roomId = String(r.room_id || r.roomId || r.room || '').trim();
          
          const rawContent = r.content || r.message || r.name || '';
          const target = extractTargetNodes(rawContent, rooms[roomId], r.node_id || r.node || r.sensor);
          let specificNode = target.specificNodeId;

          if ((!roomId || !rooms[roomId]) && specificNode) {
            for (const [rmId, rmObj] of Object.entries(rooms)) {
              if (rmObj.nodes && rmObj.nodes.some(n => (typeof n === 'string' ? n.toLowerCase() === specificNode.toLowerCase() : (n.name?.toLowerCase() === specificNode.toLowerCase() || n.id?.toLowerCase() === specificNode.toLowerCase() || n.pb_id === specificNode)))) {
                roomId = rmId;
                break;
              }
            }
          }

          if (!roomId || !rooms[roomId]) {
            const firstRoomId = Object.keys(rooms)[0];
            if (firstRoomId) roomId = firstRoomId;
          }

          const createdDate = r.created ? new Date(r.created) : new Date();
          const rawTime = r.time || (r.created ? createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '');
          const timeVal = formatTime12Hour(rawTime);
          const dateVal = r.date || createdDate.toISOString().split('T')[0];
          const contentVal = rawContent || 'Notification Alert';

          return {
            pbId: r.id,
            id: r.id,
            time: timeVal,
            date: dateVal,
            content: contentVal,
            type: r.type || 'standard',
            room: roomId,
            node: specificNode,
            nodes: target.nodeNames,
            triggered: r.triggered ?? true,
            read: Boolean(readState[r.id] || readState[r.pbId] || readState[String(r.pbId || r.id_internal || r.id || '')]),
          };
        });
        if (JSON.stringify(freshMessages.map(m => m.id + m.triggered + m.read))
            !== JSON.stringify(messages.map(m => m.id + m.triggered + m.read))) {
          messages = freshMessages;
          updateMessagesTable();
        }
      })
      .catch(err => console.warn('Background notification refresh failed:', err));
  }
}

async function loadNotificationMessages() {
  const readState = loadReadStateMap();

  // Load messages from Supabase
  try {
    let records = [];
    if (sb) {
      const { data, error } = await sb.from('notifications').select('*').order('created', { ascending: false });
      if (!error && data) records = data;
    }

    // Sync all violation records to persistent audit store
    if (typeof saveViolationToAuditHistory === 'function') {
      (records || []).forEach(r => {
        if (isRuleViolationNotification(r)) {
          saveViolationToAuditHistory(r);
        }
      });
    }

    const activeRecords = (records || []).filter(r => !isInboxDismissedNotification(r.content || r.message));
    messages = activeRecords.map(r => {
      let roomId = String(r.room_id || r.roomId || r.room || '').trim();
      
      // If roomId is missing or not in loaded rooms, infer room by matching node name inside content
      const rawContent = r.content || r.message || r.name || '';
      const target = extractTargetNodes(rawContent, rooms[roomId], r.node_id || r.node || r.sensor);
      let specificNode = target.specificNodeId;

      if ((!roomId || !rooms[roomId]) && specificNode) {
        for (const [rmId, rmObj] of Object.entries(rooms)) {
          if (rmObj.nodes && rmObj.nodes.some(n => (typeof n === 'string' ? n.toLowerCase() === specificNode.toLowerCase() : (n.name?.toLowerCase() === specificNode.toLowerCase() || n.id?.toLowerCase() === specificNode.toLowerCase() || n.pb_id === specificNode)))) {
            roomId = rmId;
            break;
          }
        }
      }

      if (!roomId || !rooms[roomId]) {
        const firstRoomId = Object.keys(rooms)[0];
        if (firstRoomId) roomId = firstRoomId;
      }

      const createdDate = r.created ? new Date(r.created) : new Date();
      const rawTime = r.time || (r.created ? createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '');
      const timeVal = formatTime12Hour(rawTime);
      const dateVal = r.date || createdDate.toISOString().split('T')[0];
      const contentVal = rawContent || 'Notification Alert';

      return {
        pbId: r.id,
        id: r.id,
        time: timeVal,
        date: dateVal,
        content: contentVal,
        type: r.type || 'standard',
        room: roomId,
        node: specificNode,
        nodes: target.nodeNames,
        triggered: r.triggered ?? true,
        read: Boolean(readState[r.id] || readState[r.pbId] || readState[String(r.pbId || r.id_internal || r.id || '')]),
      };
    });
  } catch (error) {
    console.warn('Supabase load error (notifications):', error);
    messages = [];
  }
  
  // Always re-render so the table reflects the latest state
  updateMessagesTable();
}

function loadReadStateMap() {
  try {
    return JSON.parse(localStorage.getItem(notificationReadStateKey) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function saveReadStateMap(stateMap) {
  localStorage.setItem(notificationReadStateKey, JSON.stringify(stateMap));
  if (typeof window.syncNotificationBadges === 'function') window.syncNotificationBadges();
}

function getNotificationStateKey(message) {
  return String(message?.pbId || message?.id_internal || message?.id || '');
}

function markMessageAsRead(messageId) {
  const message = messages.find(item => item.id === messageId);
  if (!message || message.read) return;

  message.read = true;
  const stateMap = loadReadStateMap();
  stateMap[getNotificationStateKey(message)] = true;
  saveReadStateMap(stateMap);
  updateMessagesTable();
}

function setNotificationFilter(filter) {
  currentNotificationFilter = filter;

  document.querySelectorAll('.notification-filter-btn').forEach(button => {
    const isActive = button.dataset.filter === filter;
    if (isActive) {
      button.className = 'notification-filter-btn px-6 py-2 rounded-lg text-sm font-bold bg-[#0b291d] dark:bg-[#10b981] text-white shadow-sm transition-colors cursor-pointer border-0';
    } else {
      button.className = 'notification-filter-btn px-6 py-2 rounded-lg text-sm font-bold bg-white dark:bg-slate-900 border-2 border-[#10b981] dark:border-[#10b981]/40 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer';
    }
  });

  updateMessagesTable();
}

function _isMessageDue(message) {
  if (!message?.date || !message?.time) return false;
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  if (message.date < today) return true;
  if (message.date > today) return false;

  const nowTotal = now.getHours() * 60 + now.getMinutes();
  const msgTotal = parseTimeToMinutes(message.time);
  if (msgTotal === null) return true;
  return msgTotal <= nowTotal;
}


function updateSelectedSensorsSummary(nodeNames = []) {
  const summaryBadge = document.getElementById('selectedSensorsSummaryBadge');
  const summaryText = document.getElementById('selectedSensorsSummaryText');
  if (!summaryBadge || !summaryText) return;

  if (!nodeNames || nodeNames.length === 0) {
    summaryBadge.classList.add('hidden');
    summaryBadge.classList.remove('flex');
    return;
  }

  summaryBadge.classList.remove('hidden');
  summaryBadge.classList.add('flex');
  if (nodeNames.length <= 3) {
    summaryText.textContent = `${nodeNames.join(', ')} (${nodeNames.length})`;
  } else {
    summaryText.textContent = `${nodeNames.slice(0, 3).join(', ')} +${nodeNames.length - 3} more (${nodeNames.length})`;
  }
}

let _selectedNodesCollapseInitialized = false;
function initSelectedNodesCollapse() {
  if (_selectedNodesCollapseInitialized) return;
  _selectedNodesCollapseInitialized = true;

  const toggleBtn = document.getElementById('toggleSelectedNodesBtn');
  const toggleHeader = document.getElementById('selectedNodesHeader');
  const wrapper = document.getElementById('nodesDisplayWrapper');
  const chevron = document.getElementById('selectedNodesChevron');
  const label = document.getElementById('toggleSelectedNodesLabel');
  const container = document.getElementById('selectedNodesContainer');

  if (!wrapper) return;

  let isCollapsed = localStorage.getItem('ecoTrack_selectedNodesCollapsed') === 'true';

  function applyCollapseState(collapsed) {
    if (collapsed) {
      wrapper.classList.add('hidden');
      if (chevron) chevron.classList.remove('rotate-180');
      if (label) label.textContent = 'Expand';
      if (container) {
        container.classList.remove('p-6');
        container.classList.add('p-4');
      }
    } else {
      wrapper.classList.remove('hidden');
      if (chevron) chevron.classList.add('rotate-180');
      if (label) label.textContent = 'Collapse';
      if (container) {
        container.classList.remove('p-4');
        container.classList.add('p-6');
      }
    }
  }

  applyCollapseState(isCollapsed);

  function toggleCollapse(e) {
    if (e) e.preventDefault();
    isCollapsed = !isCollapsed;
    localStorage.setItem('ecoTrack_selectedNodesCollapsed', isCollapsed ? 'true' : 'false');
    applyCollapseState(isCollapsed);
  }

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCollapse(e);
  });

  toggleHeader?.addEventListener('click', (e) => {
    if (e.target.closest('button') && e.target.closest('button') !== toggleBtn) return;
    toggleCollapse(e);
  });
}

async function displayRoomNodes(room) {
  const nodesDisplay = document.querySelector('#nodesDisplay .flex');
  if (!nodesDisplay) return;
  nodesDisplay.innerHTML = '';
  let roomNodes = Array.isArray(room.nodes) ? room.nodes : [];
  
  if (roomNodes.length === 0) {
    nodesDisplay.innerHTML = '<p class="text-gray-500 text-sm">No nodes in this room</p>';
    updateSelectedSensorsSummary([]);
    return;
  }

  const allNodes = Array.isArray(window.activeNodesData) ? window.activeNodesData : [];
  const sensorNames = [];
  
  for (const nodeEntry of roomNodes) {
    let node = typeof nodeEntry === 'string'
      ? allNodes.find(n => n.id === nodeEntry || n.name === nodeEntry) || { id: nodeEntry, name: nodeEntry }
      : { ...nodeEntry };
    sensorNames.push(node.name || node.id);
      
    // Fetch live sensor data from Supabase / PocketBase (sensor logs)
    if (sb) {
      try {
        const { data: telem } = await sb.from('telemetry').select('*').or(`node_id.eq.${node.id},sensor_name.eq.${node.id}`).order('created', { ascending: false }).limit(1).maybeSingle();
        if (telem) {
          node.temp = telem.temperature;
          node.pressure = telem.pressure;
          node.battery = telem.battery;
          node.rssi = telem.rssi;
          node.status = telem.status;
        } else {
          const { data: nodeRecord } = await sb.from('nodes').select('*').eq('name', node.id).maybeSingle();
          if (nodeRecord) {
            node.temp = nodeRecord.temp;
            node.pressure = nodeRecord.pressure;
            node.battery = nodeRecord.battery;
            node.rssi = nodeRecord.rssi;
            node.status = nodeRecord.status;
          }
        }
      } catch (_) {}
    } else if (pb && typeof pb.collection === 'function') {
      try {
        const telem = await pb.collection('telemetry').getFirstListItem(`node_id.name='${node.id}'`, { sort: '-created' });
        node.temp = telem.temperature;
        node.pressure = telem.pressure;
        node.battery = telem.battery;
        node.rssi = telem.rssi;
        node.status = telem.status;
      } catch (e) {}
    }

    const temp = Number(node.temp ?? node.temperature ?? 0);
    const pressure = Number(node.pressure ?? 0);
    const battery = Number(node.battery ?? 0);
    const signal = Number(node.rssi ?? node.signal ?? 0);
    const isOnline = String(node.status ?? '').toLowerCase() === 'online';
    const batteryPercent = Math.round((battery / 4.2) * 100);
    const signalBars = (signal > -60) ? 4 : (signal > -70) ? 3 : (signal > -80) ? 2 : 1;

    let batteryColor = '#34d399';
    if (batteryPercent < 20) batteryColor = '#f87171';
    else if (batteryPercent < 50) batteryColor = '#fbbf24';
    
    let signalColorClass = 'text-rose-400';
    if (signalBars >= 4) signalColorClass = 'text-emerald-400';
    else if (signalBars >= 3) signalColorClass = 'text-emerald-400';
    else if (signalBars >= 2) signalColorClass = 'text-amber-400';

    const snowflakeSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-0.5"><line x1="12" y1="2" x2="12" y2="22"/><path d="M20 12H4"/><path d="m6 8 6 4-6 4"/><path d="m18 8-6 4 6 4"/><path d="m8 4 4 4 4-4"/><path d="m8 20 4-4 4 4"/></svg>`;
    const fanSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-0.5"><path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/></svg>`;
    const powerSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-0.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`;

    let acState = 'ACTIVE COOLING';
    let activeIconSvg = snowflakeSvg;
    
    if (temp >= 28) {
      acState = 'OFF';
      activeIconSvg = powerSvg;
    } else if (temp >= 26) {
      acState = 'FAN ONLY';
      activeIconSvg = fanSvg;
    } else {
      acState = 'ACTIVE COOLING';
      activeIconSvg = snowflakeSvg;
    }

    if (!isOnline) { 
      acState = 'OFF'; 
      activeIconSvg = powerSvg;
    }

    const thermSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="mb-0.5"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>`;
    const gaugeSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-0.5"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`;

    const nodeCard = document.createElement('div');
    nodeCard.className = 'selected-node-card bg-white dark:bg-slate-900 rounded-2xl p-4 flex-shrink-0 w-[20rem] border-[2px] border-[#10b981] dark:border-[#10b981]/25 shadow-sm';
    let signalColorClassUpdated = signalBars >= 3 ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500 dark:text-gray-500';
    nodeCard.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <div class="text-[10px] uppercase tracking-widest text-[#10b981] font-bold">Selected Sensor</div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" class="${signalColorClassUpdated}">
              <rect x="2" y="16" width="4" height="6" rx="1" fill="currentColor" opacity="${signalBars >= 1 ? 1 : 0.25}"/>
              <rect x="8" y="11" width="4" height="11" rx="1" fill="currentColor" opacity="${signalBars >= 2 ? 1 : 0.25}"/>
              <rect x="14" y="6" width="4" height="16" rx="1" fill="currentColor" opacity="${signalBars >= 3 ? 1 : 0.25}"/>
              <rect x="20" y="1" width="4" height="21" rx="1" fill="currentColor" opacity="${signalBars >= 4 ? 1 : 0.25}"/>
            </svg>
          </div>
          <div class="flex items-center gap-1">
            <svg viewBox="0 0 24 16" width="20" height="13" fill="none">
              <rect x="0.5" y="1" width="20" height="14" rx="2.5" stroke="#10b981" stroke-width="1.5"/>
              <rect x="21" y="5" width="2.5" height="6" rx="1" fill="#10b981"/>
              <rect x="2.5" y="3" width="${Math.min(batteryPercent, 100) * 0.16}" height="10" rx="1.5" fill="#10b981"/>
            </svg>
            <span class="text-[11px] text-gray-700 dark:text-gray-200 font-bold">${batteryPercent.toFixed(0)}%</span>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 mb-4 mt-1">
        <h4 class="text-[#18392B] dark:text-[#a7f3d0] font-bold text-lg leading-tight truncate">${node.name || node.id}</h4>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-bold tracking-widest uppercase whitespace-nowrap ${isOnline ? 'bg-green-100 dark:bg-emerald-950/20 text-[#10b981] dark:text-emerald-400' : 'bg-red-100 dark:bg-rose-950/20 text-red-500 dark:text-rose-400'}">
          <span class="w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-[#10b981]' : 'bg-red-500'}"></span>
          ${isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div class="grid grid-cols-3 gap-2 text-sm">
        <div class="rounded-lg bg-gray-50 dark:bg-slate-950/40 border-[2px] border-[#10b981] dark:border-[#10b981]/20 p-2 flex flex-col items-center justify-center text-center">
          <div class="text-[#10b981] mb-1">${thermSvg}</div>
          <div class="uppercase tracking-widest text-[#18392B] dark:text-cyan-400 text-[8px] font-bold mb-1 whitespace-nowrap">Temp</div>
          <div class="text-[#18392B] dark:text-[#a7f3d0] font-bold text-[0.95rem] leading-none">${Math.round(temp)}<span class="text-[0.55rem] text-gray-500 dark:text-gray-400 ml-0.5">°C</span></div>
        </div>
        <div class="rounded-lg bg-gray-50 dark:bg-slate-950/40 border-[2px] border-[#10b981] dark:border-[#10b981]/20 p-2 flex flex-col items-center justify-center text-center">
          <div class="text-[#18392B] dark:text-[#10b981] mb-1">${gaugeSvg}</div>
          <div class="uppercase tracking-widest text-[#18392B] dark:text-cyan-400 text-[8px] font-bold mb-1 whitespace-nowrap">Air Press</div>
          <div class="text-[#18392B] dark:text-[#a7f3d0] font-bold text-[0.95rem] leading-none">${pressure.toFixed(1)}<span class="text-[0.55rem] text-gray-500 dark:text-gray-400 ml-0.5">kPa</span></div>
        </div>
        <div class="rounded-lg bg-gray-50 dark:bg-slate-950/40 border-[2px] border-[#10b981] dark:border-[#10b981]/20 p-2 flex flex-col items-center justify-center text-center">
          <div class="text-[#10b981] mb-1">${activeIconSvg}</div>
          <div class="uppercase tracking-widest text-[#18392B] dark:text-cyan-400 text-[8px] font-bold mb-1 whitespace-nowrap">AC State</div>
          <div class="text-[#18392B] dark:text-[#a7f3d0] font-bold text-[0.6rem] leading-tight uppercase tracking-tighter">${acState}</div>
        </div>
      </div>
    `;
    nodesDisplay.appendChild(nodeCard);
  }
  updateSelectedSensorsSummary(sensorNames);
}


function showNotification(message, duration = 3000) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: rgba(15, 23, 42, 0.95);
    border: 2px solid rgb(34, 211, 238);
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 100;
    animation: slideIn 0.3s ease-in-out;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in-out';
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

// ===== MESSAGES & NOTIFICATIONS =====
function openMessageModal() {
  document.getElementById('messageModal').style.display = 'flex';
  document.getElementById('composerMessageInput').focus();
}

function closeMessageModal() {
  document.getElementById('messageModal').style.display = 'none';
  document.getElementById('composerMessageInput').value = '';
  document.getElementById('messageTime').value = '';
  document.getElementById('messageDate').value = '';
}

async function addMessage() {
  const messageText = document.getElementById('composerMessageInput').value.trim();
  const time = document.getElementById('messageTime').value;
  const date = document.getElementById('messageDate').value;
  
  if (!messageText) {
    showNotification('⚠️ Please enter a message');
    return;
  }
  
  if (!time) {
    showNotification('⚠️ Please set a send time');
    return;
  }
  
  if (!date) {
    showNotification('⚠️ Please set a send date');
    return;
  }
  
  if (!selectedRoomId) {
    showNotification('⚠️ Please select a room first');
    return;
  }
  
  // Add message to array
  const messageData = {
    time: time,
    date: date,
    content: messageText,
    room_id: selectedRoomId,
    triggered: false
  };
  
  try {
    let newId = 'ntf_' + Date.now();
    if (sb) {
      const { data: newRecord, error } = await sb.from('notifications').insert([messageData]).select().single();
      if (!error && newRecord) {
        newId = newRecord.id;
      }
    }
    messageData.pbId = newId;
    messageData.id = newId;
    messageData.room = selectedRoomId;
    messageData.time = formatTime12Hour(time);
    messages.push(messageData);
    updateMessagesTable();
    closeMessageModal();
    showNotification(`✓ Message scheduled for ${formatTime12Hour(time)}`);
  } catch (error) {
    console.error('Error saving notification to Supabase', error);
    showNotification('⚠️ Error saving to database');
  }
}

function updateRoomBadges() {
  Object.keys(rooms).forEach(roomId => {
    // Count unread triggered messages for this room
    const unreadCount = messages.filter(m => m.room === roomId && !m.read && m.triggered).length;
    const badgeEl = document.getElementById(`roomBadge-${roomId}`);
    if (badgeEl) {
      if (unreadCount > 0) {
        badgeEl.textContent = unreadCount;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
  });
}

function updateMessagesTable() {
  updateRoomBadges();
  
  const tbody = document.getElementById('messagesTableBody');
  const dot = document.getElementById('unreadFilterDot');

  if (!selectedRoomId) {
    tbody.innerHTML = '<tr class="text-sm text-gray-500"><td colspan="7" class="px-4 py-8 text-center">Select a room to view notifications</td></tr>';
    if (dot) dot.classList.add('hidden');
    return;
  }

  // Dynamically show/hide the Unread filter indicator dot
  const roomUnreadCount = messages.filter(m => m.room === selectedRoomId && !m.read && m.triggered).length;
  if (dot) {
    if (roomUnreadCount > 0) {
      dot.classList.remove('hidden');
    } else {
      dot.classList.add('hidden');
    }
  }

  console.log('UpdateMessagesTable - all messages:', messages.length, messages);
  const filtered = messages.filter(msg => {
    const room = rooms[selectedRoomId];
    let matchesRoom = (msg.room === selectedRoomId);
    if (!matchesRoom && room && Array.isArray(room.nodes)) {
      let specificNode = null;
      if (msg.content && msg.content.includes('|||')) {
        specificNode = msg.content.split('|||')[0].trim();
      }
      if (specificNode) {
        matchesRoom = room.nodes.some(n => (typeof n === 'string' ? n === specificNode : (n.name === specificNode || n.id === specificNode || n.pb_id === specificNode)));
      }
    }

    if (!matchesRoom) return false;
    if (currentNotificationFilter === 'read') return Boolean(msg.read);
    if (currentNotificationFilter === 'unread') return !msg.read;
    return true;
  });
  if (filtered.length === 0) {
    const emptyText = currentNotificationFilter === 'read'
      ? 'No read messages in this room'
      : currentNotificationFilter === 'unread'
        ? 'No unread messages in this room'
        : 'No messages scheduled for this room';
    tbody.innerHTML = `<tr class="text-sm text-gray-500 dark:text-gray-400"><td colspan="7" class="px-4 py-8 text-center">${emptyText}</td></tr>`;
    return;
  }
  
  tbody.innerHTML = '';
  filtered.forEach(msg => {
    const room = rooms[msg.room];
    const target = extractTargetNodes(msg.content, room, msg.node);
    const specificNodeId = target.specificNodeId;
    const actualContent = target.actualContent;
    const nodeNames = target.nodeNames;
    
    let acType = 'Mixed/Various';
    if (specificNodeId) {
      // Find node globally to get its aircon_type
      for (const r of Object.values(rooms)) {
        const found = r.nodes?.find(n => (typeof n === 'string' ? n.toLowerCase() === specificNodeId.toLowerCase() : (n.id?.toLowerCase() === specificNodeId.toLowerCase() || n.name?.toLowerCase() === specificNodeId.toLowerCase() || n.pb_id === specificNodeId)));
        if (found && found.aircon_type) { acType = found.aircon_type; break; }
      }
    } else if (msg.room_id && rooms[msg.room_id] && rooms[msg.room_id].nodes && rooms[msg.room_id].nodes.length === 1) {
      acType = rooms[msg.room_id].nodes[0].aircon_type || 'Split Type (Inverter)';
    } else {
      acType = 'Split Type (Inverter)';
    }
    
    const nodeLabel = nodeNames.length ? nodeNames.join(', ') : '—';
    const row = document.createElement('tr');
    row.className = `bg-white dark:bg-transparent border-b border-gray-100 dark:border-white/5 hover:bg-emerald-50/40 dark:hover:bg-slate-800/60 text-sm transition-colors cursor-pointer`;
    row.setAttribute('data-id', msg.id);
    row.innerHTML = `
      <td class="px-6 py-4 align-middle whitespace-nowrap">
        <div class="flex flex-col gap-1.5">
          <span class="font-bold text-[#18392B] dark:text-white text-sm">${formatTime12Hour(msg.time)}</span>
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase ${msg.triggered ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 dark:border dark:border-emerald-800/40' : 'bg-cyan-100 dark:bg-cyan-950/70 text-cyan-800 dark:text-cyan-400 dark:border dark:border-cyan-800/40'} w-fit">
            ${msg.triggered ? 'Triggered' : 'Scheduled'}
          </span>
        </div>
      </td>
      <td class="px-6 py-4 align-middle whitespace-nowrap">
        <div class="flex items-center gap-2 text-gray-600 dark:text-gray-300 font-medium text-sm">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400 dark:text-gray-400 shrink-0">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          ${msg.date}
        </div>
      </td>
      <td class="px-6 py-4 align-middle">
        <div class="flex flex-col">
          <div class="font-bold text-[#18392B] dark:text-gray-100 text-sm">${nodeLabel}</div>
          <div class="text-gray-400 dark:text-gray-400 text-xs mt-0.5">${nodeNames.length ? `${nodeNames.length} node${nodeNames.length > 1 ? 's' : ''}` : 'Room-wide broadcast'}</div>
        </div>
      </td>
      <td class="px-6 py-4 align-middle text-[#18392B] dark:text-gray-200 text-sm font-semibold whitespace-nowrap">
        ${acType}
      </td>
      <td class="px-6 py-4 align-middle">
        <div class="text-gray-800 dark:text-gray-200 text-sm font-medium leading-relaxed">
          ${actualContent.substring(0, 96)}${actualContent.length > 96 ? '...' : ''}
        </div>
      </td>
      <td class="px-6 py-4 align-middle text-center">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${msg.read ? 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10' : 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/40'}">
          ${msg.read ? 'Read' : 'Unread'}
        </span>
      </td>
      <td class="px-6 py-4 align-middle">
        <button class="deleteTableBtn flex items-center gap-1.5 px-3.5 py-1.5 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/40 text-red-500 dark:text-red-400 rounded-lg text-xs font-bold hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer" data-id="${msg.id}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M6 6l1 14h10l1-14" />
          </svg>
          Remove
        </button>
      </td>
    `;
    
    // Make row clickable to view details
    row.addEventListener('click', (e) => {
      // Don't open modal if clicking the delete button
      if (e.target.classList.contains('deleteTableBtn')) {
        return;
      }
      markMessageAsRead(msg.id);
      openViewMessageModal(msg);
    });
    
    row.querySelector('.deleteTableBtn').addEventListener('click', () => deleteMessage(msg.id));
    tbody.appendChild(row);
  });
}

function refreshMessages() {
  const refreshBtn = document.getElementById('refreshBtn');
  const icon = refreshBtn.querySelector('svg');
  
  // Add spin animation
  icon.classList.add('spin-icon');
  
  // Remove animation class after it completes
  setTimeout(() => {
    icon.classList.remove('spin-icon');
  }, 1000);
  
  updateMessagesTable();
  showNotification('✓ Messages refreshed');
}

function deleteMessage(id) {
  pendingDeleteMessageId = id;
  const modal = document.getElementById('confirmDeleteModal');
  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(() => {
      modal.querySelector('div').classList.remove('scale-100', 'scale-95');
      modal.querySelector('div').classList.add('scale-100');
    }, 10);
  }
}

function isInboxDismissedNotification(content) {
  return typeof content === 'string' && content.startsWith('__INBOX_DISMISSED__|||');
}

function isRuleViolationNotification(notif) {
  if (!notif) return false;
  if (notif.rule_id) return true;
  const content = String(notif.content || notif.message || '').toLowerCase();
  if (content.includes('battery') || content.includes('sensor wake up') || content.includes('sensor sleep') || content.includes('schedule applied')) {
    return false;
  }
  return Boolean(notif.triggered);
}

async function confirmDeleteMessage() {
  if (!pendingDeleteMessageId) return;
  const id = pendingDeleteMessageId;
  const msgToDelete = messages.find(m => m.id === id);
  const targetId = msgToDelete?.pbId || msgToDelete?.id || id;
  
  const isViolation = isRuleViolationNotification(msgToDelete);

  // Preserve violation in local persistent audit history so Rule Management never loses it
  if (isViolation && typeof saveViolationToAuditHistory === 'function') {
    saveViolationToAuditHistory(msgToDelete);
  }

  if (sb && targetId) {
    try {
      if (isViolation) {
        // Soft delete from inbox in Supabase so Rule Management retains the violation data
        const rawContent = msgToDelete.rawContent || msgToDelete.content || '';
        const dismissedContent = isInboxDismissedNotification(rawContent) ? rawContent : `__INBOX_DISMISSED__|||${rawContent}`;
        await sb.from('notifications').update({ content: dismissedContent }).eq('id', targetId);
      } else {
        await sb.from('notifications').delete().eq('id', targetId);
      }
    } catch(e) {
      console.warn('Failed to update/delete notification from Supabase:', e);
    }
  }

  const stateMap = loadReadStateMap();
  const stateKey = getNotificationStateKey(msgToDelete);
  if (stateKey && stateMap[stateKey]) {
    delete stateMap[stateKey];
    saveReadStateMap(stateMap);
  }
  
  messages = messages.filter(m => m.id !== id);
  
  // Update global badge
  if (typeof resetNotificationCount === 'function') {
    resetNotificationCount();
  }
  // Update the view
  updateMessagesTable();
  if (document.getElementById('viewMessageModal').style.display !== 'none') {
    closeViewMessageModal();
  }
  
  showNotification('Message deleted');
  cancelDeleteMessage();
}

function cancelDeleteMessage() {
  pendingDeleteMessageId = null;
  const modal = document.getElementById('confirmDeleteModal');
  if (modal) {
    modal.querySelector('div').classList.remove('scale-100');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => {
      modal.classList.add('hidden');
    }, 200);
  }
}

function openClearAllModal() {
  if (!selectedRoomId) return;
  const roomMessages = messages.filter(m => m.room === selectedRoomId);
  if (roomMessages.length === 0) {
    showNotification('No notifications to clear');
    return;
  }
  const modal = document.getElementById('clearAllModal');
  if (modal) modal.classList.remove('hidden');
}

function closeClearAllModal() {
  const modal = document.getElementById('clearAllModal');
  if (modal) modal.classList.add('hidden');
}

async function clearAllMessages() {
  if (!selectedRoomId) return;

  const roomMessages = messages.filter(message => message.room === selectedRoomId);
  if (roomMessages.length === 0) return;

  if (sb) {
    const violationMsgs = [];
    const nonViolationIds = [];

    roomMessages.forEach(m => {
      if (isRuleViolationNotification(m)) {
        violationMsgs.push(m);
        if (typeof saveViolationToAuditHistory === 'function') {
          saveViolationToAuditHistory(m);
        }
      } else {
        const tid = m.pbId || m.id;
        if (tid) nonViolationIds.push(tid);
      }
    });

    try {
      // Soft-dismiss violation records in Supabase so Rule Management retains full compliance history
      for (const vm of violationMsgs) {
        const tid = vm.pbId || vm.id;
        if (!tid) continue;
        const rawContent = vm.rawContent || vm.content || '';
        const dismissedContent = isInboxDismissedNotification(rawContent) ? rawContent : `__INBOX_DISMISSED__|||${rawContent}`;
        await sb.from('notifications').update({ content: dismissedContent }).eq('id', tid);
      }

      // Hard-delete manual/routine non-violation messages
      if (nonViolationIds.length > 0) {
        await sb.from('notifications').delete().in('id', nonViolationIds);
      }
    } catch (error) {
      console.warn('Failed to update/delete notifications from Supabase during clear all:', error);
    }
  }

  const removedTriggeredCount = roomMessages.filter(message => message.triggered).length;
  const stateMap = loadReadStateMap();
  roomMessages.forEach(message => {
    const stateKey = getNotificationStateKey(message);
    if (stateKey && stateMap[stateKey]) {
      delete stateMap[stateKey];
    }
  });
  saveReadStateMap(stateMap);
  messages = messages.filter(message => message.room !== selectedRoomId);

  if (typeof resetNotificationCount === 'function') {
    resetNotificationCount();
  }

  updateMessagesTable();
  showNotification('Notifications cleared');
}

// ===== VIEW MESSAGE MODAL =====
function openViewMessageModal(message) {
  markMessageAsRead(message.id);
  
  const roomRef = rooms[message.room] || 
                  Object.values(rooms || {}).find(r => r.id === message.room || r.name === message.room || (r.name && message.room && r.name.toLowerCase() === String(message.room).toLowerCase())) || 
                  rooms[selectedRoomId];
  const roomLabel = roomRef?.name || rooms[message.room]?.name || message.room || 'Unassigned';
  
  const target = extractTargetNodes(message.content, roomRef, message.node);
  const actualContent = target.actualContent;
  let nodeNames = target.nodeNames || [];

  if (!target.specificNodeId && (!nodeNames || nodeNames.length === 0)) {
    if (message.node) {
      nodeNames = [message.node];
    } else if (Array.isArray(message.nodes) && message.nodes.length > 0) {
      nodeNames = message.nodes;
    }
  }
  
  const sensorsText = nodeNames.length ? nodeNames.join(', ') : (roomRef?.nodes?.length ? 'All Sensors' : '—');
  
  const formattedHtml = `
    <div class="bg-gray-50/90 dark:bg-[#070d1e] rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm">
      <div class="flex flex-col gap-4 mb-6 pb-6 border-b border-gray-200 dark:border-white/10 text-sm text-gray-600 dark:text-gray-400">
        <div class="flex items-center gap-4">
          <div class="p-2.5 rounded-xl bg-white dark:bg-[#0c1328] shadow-sm border border-gray-200 dark:border-white/10 text-[#10b981] dark:text-emerald-400">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          </div>
          <span class="font-medium">Room: <span class="text-[#18392B] dark:text-emerald-300 font-bold ml-1">${roomLabel}</span></span>
        </div>
        <div class="flex items-center gap-4">
          <div class="p-2.5 rounded-xl bg-white dark:bg-[#0c1328] shadow-sm border border-gray-200 dark:border-white/10 text-[#10b981] dark:text-emerald-400">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" /><path d="M12 12l-8-4.3 8-4.3 8 4.3" /></svg>
          </div>
          <span class="font-medium">Sensors: <span class="text-[#18392B] dark:text-gray-200 font-bold ml-1">${sensorsText}</span></span>
        </div>
        <div class="flex items-center gap-4">
          <div class="p-2.5 rounded-xl bg-white dark:bg-[#0c1328] shadow-sm border border-gray-200 dark:border-white/10 text-[#10b981] dark:text-emerald-400">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          </div>
          <span class="font-medium">Scheduled: <span class="text-[#18392B] dark:text-gray-200 font-bold ml-1">${message.date} at ${formatTime12Hour(message.time)}</span></span>
        </div>
      </div>
      
      <div class="bg-white dark:bg-[#0c1328] rounded-xl p-5 border border-gray-200 dark:border-white/10 shadow-sm relative overflow-hidden">
        <div class="absolute top-0 left-0 w-1.5 h-full bg-[#10b981]"></div>
        <h4 class="text-[11px] uppercase font-extrabold tracking-widest text-[#10b981] dark:text-emerald-400 mb-2">Message Content</h4>
        <p class="text-gray-800 dark:text-gray-100 text-sm font-medium leading-relaxed whitespace-pre-wrap">${actualContent || 'No message content'}</p>
      </div>
    </div>
  `;
  
  document.getElementById('viewMessageCombined').innerHTML = formattedHtml;
  currentViewMessageId = message.id;
  document.getElementById('viewMessageModal').style.display = 'flex';
}

function closeViewMessageModal() {
  document.getElementById('viewMessageModal').style.display = 'none';
  currentViewMessageId = null;
}

function toggleNotifications() {
  const btn = document.getElementById('notifyToggleBtn');
  isNotifying = !isNotifying;
  
  if (isNotifying) {
    btn.classList.remove('bg-red-600', 'hover:bg-red-700');
    btn.classList.add('bg-green-600', 'hover:bg-green-700');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>Stop Notifying
    `;
    showNotification('✓ Notifications activated');
  } else {
    btn.classList.remove('bg-green-600', 'hover:bg-green-700');
    btn.classList.add('bg-red-600', 'hover:bg-red-700');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>Notify me
    `;
    showNotification('⊗ Notifications deactivated');
  }
}

// ===== GLOBAL NOTIFICATION SYSTEM =====
function startNotificationCheck() {
  setInterval(async () => {
    if (!isNotifying) return;

    await loadNotificationMessages();

    let tableNeedsUpdate = false;
    messages.forEach(msg => {
      if (_isMessageDue(msg) && !msg.triggered) {
        msg.triggered = true;
        tableNeedsUpdate = true;
      }
      if (!msg.triggered || lastTriggeredIds.has(msg.id)) return;
      lastTriggeredIds.add(msg.id);
      triggerGlobalNotification(msg.content);
    });

    // Re-render the table if any message changed trigger state
    if (tableNeedsUpdate) {
      updateMessagesTable();
    }
  }, 10000);
}

function showGlobalNotification(message) {
  const dialog = document.getElementById('globalNotificationDialog');
  const messageEl = document.getElementById('globalNotificationMessage');
  
  if (dialog && messageEl) {
    messageEl.textContent = message;
    dialog.style.display = 'flex';
  }
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  
  if (badge) {
    const count = getTriggeredNotificationCount();
    if (count > 0) {
      badge.classList.remove('hidden');
      badge.textContent = count;
    } else {
      badge.classList.add('hidden');
    }
  }
}

// Auto-refresh notifications table every 2.5 seconds to reflect newly triggered alerts
setInterval(() => {
  if (selectedRoomId) {
    loadNotificationMessages().catch(() => {});
  }
}, 2500);

window.loadNotificationMessages = loadNotificationMessages;
window.setupNotificationsPage = setupNotificationsPage;

