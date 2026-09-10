// ===== SCHEDULER PAGE LOGIC =====
const sb = window.supabaseClient || window.sb;
const pb = window.pb || (typeof PocketBase === 'function' ? new PocketBase() : null);

let selectedRoomId = null;
let buildings = {};
let floors = {};
let savedRooms = {};
let activeTimePickerTargetId = null;
let activeTimePickerTrigger = null;

function formatTimeDisplay(value) {
  const timeValue = String(value || '05:00');
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(timeValue);
  if (!match) return '05:00 AM';

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${String(hours).padStart(2, '0')}:${minutes} ${period}`;
}

function composeTimeValue(hourValue, minuteValue, periodValue) {
  let hours = parseInt(hourValue, 10);
  const minutes = String(minuteValue).padStart(2, '0');

  if (periodValue === 'AM') {
    if (hours === 12) hours = 0;
  } else if (hours !== 12) {
    hours += 12;
  }

  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function ensureTimePickerModal() {
  if (document.getElementById('timePickerModal')) return;

  const modal = document.createElement('div');
  modal.id = 'timePickerModal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in duration-200';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="bg-white dark:bg-[#0c1328] border-[3px] border-[#10b981] dark:border-[#10b981]/40 rounded-[1.5rem] p-7 w-full max-w-sm relative shadow-2xl">
      <button id="timePickerCloseBtn" class="absolute top-6 right-6 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors border-0 bg-transparent cursor-pointer">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      
      <div class="mb-6">
        <p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Custom Time</p>
        <h3 id="timePickerTitle" class="text-2xl font-bold text-[#18392B] dark:text-cyan-400">Wake Time</h3>
        <p id="timePickerPreview" class="text-sm font-semibold text-[#18392B] dark:text-gray-300 mt-1">06:00 AM</p>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-8">
        <label class="flex flex-col">
          <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 pl-1">Hour</span>
          <select id="timePickerHour" class="bg-white dark:bg-slate-950/40 border-2 border-gray-200 dark:border-white/10 focus:border-[#10b981] hover:border-gray-300 dark:hover:border-white/20 rounded-xl text-xl font-bold text-[#18392B] dark:text-gray-100 px-2 py-3 appearance-none outline-none cursor-pointer text-center transition-colors shadow-sm"></select>
        </label>
        <label class="flex flex-col">
          <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 pl-1">Minute</span>
          <select id="timePickerMinute" class="bg-white dark:bg-slate-950/40 border-2 border-gray-200 dark:border-white/10 focus:border-[#10b981] hover:border-gray-300 dark:hover:border-white/20 rounded-xl text-xl font-bold text-[#18392B] dark:text-gray-100 px-2 py-3 appearance-none outline-none cursor-pointer text-center transition-colors shadow-sm"></select>
        </label>
        <label class="flex flex-col">
          <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 pl-1">Period</span>
          <select id="timePickerPeriod" class="bg-white dark:bg-slate-950/40 border-2 border-gray-200 dark:border-white/10 focus:border-[#10b981] hover:border-gray-300 dark:hover:border-white/20 rounded-xl text-xl font-bold text-[#18392B] dark:text-gray-100 px-2 py-3 appearance-none outline-none cursor-pointer text-center transition-colors shadow-sm"></select>
        </label>
      </div>

      <div class="flex gap-4">
        <button id="timePickerCancelBtn" class="flex-1 bg-white dark:bg-slate-900 border border-[#10b981] dark:border-[#10b981]/40 text-[#10b981] dark:text-emerald-400 font-bold rounded-xl py-3 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors border-0 cursor-pointer">
          Cancel
        </button>
        <button id="timePickerSaveBtn" class="flex-1 bg-[#10b981] text-white hover:bg-emerald-400 font-bold rounded-xl py-3 shadow-md hover:shadow-lg transition-all border-0 cursor-pointer">
          Save Time
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const hourSelect = modal.querySelector('#timePickerHour');
  const minuteSelect = modal.querySelector('#timePickerMinute');
  const periodSelect = modal.querySelector('#timePickerPeriod');

  for (let hour = 1; hour <= 12; hour += 1) {
    const option = document.createElement('option');
    option.value = String(hour);
    option.textContent = String(hour).padStart(2, '0');
    hourSelect.appendChild(option);
  }

  for (let minute = 0; minute < 60; minute += 1) {
    const option = document.createElement('option');
    option.value = String(minute).padStart(2, '0');
    option.textContent = String(minute).padStart(2, '0');
    minuteSelect.appendChild(option);
  }

  ['AM', 'PM'].forEach(period => {
    const option = document.createElement('option');
    option.value = period;
    option.textContent = period;
    periodSelect.appendChild(option);
  });

  const updatePreview = () => {
    const preview = document.getElementById('timePickerPreview');
    if (!preview) return;
    preview.textContent = formatTimeDisplay(composeTimeValue(hourSelect.value, minuteSelect.value, periodSelect.value));
  };

  hourSelect.addEventListener('change', updatePreview);
  minuteSelect.addEventListener('change', updatePreview);
  periodSelect.addEventListener('change', updatePreview);

  modal.addEventListener('click', (event) => {
    if (event.target.id === 'timePickerModal') {
      closeTimePicker();
    }
  });

  modal.querySelector('#timePickerCloseBtn').addEventListener('click', closeTimePicker);
  modal.querySelector('#timePickerCancelBtn').addEventListener('click', closeTimePicker);
  modal.querySelector('#timePickerSaveBtn').addEventListener('click', saveTimePicker);
}

function openTimePicker(targetInputId, triggerElement) {
  const modal = document.getElementById('timePickerModal');
  const hourSelect = document.getElementById('timePickerHour');
  const minuteSelect = document.getElementById('timePickerMinute');
  const periodSelect = document.getElementById('timePickerPeriod');
  const title = document.getElementById('timePickerTitle');
  const preview = document.getElementById('timePickerPreview');
  const targetInput = document.getElementById(targetInputId);

  if (!modal || !hourSelect || !minuteSelect || !periodSelect || !targetInput) return;

  const currentValue = targetInput.value || '05:00';
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(currentValue) || ['05:00', '05', '00'];
  const hour24 = parseInt(match[1], 10);
  const minute = match[2];
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;

  activeTimePickerTargetId = targetInputId;
  activeTimePickerTrigger = triggerElement || document.querySelector(`[data-time-target="${targetInputId}"]`);

  hourSelect.value = String(hour12);
  minuteSelect.value = minute;
  periodSelect.value = period;

  if (title && activeTimePickerTrigger) {
    title.textContent = activeTimePickerTrigger.dataset.timeLabel || 'Select Time';
  }
  if (preview) {
    preview.textContent = formatTimeDisplay(currentValue);
  }

  modal.style.display = 'flex';
}

function closeTimePicker() {
  const modal = document.getElementById('timePickerModal');
  if (modal) modal.style.display = 'none';
  activeTimePickerTargetId = null;
  activeTimePickerTrigger = null;
}

function saveTimePicker() {
  if (!activeTimePickerTargetId) return;

  const hourSelect = document.getElementById('timePickerHour');
  const minuteSelect = document.getElementById('timePickerMinute');
  const periodSelect = document.getElementById('timePickerPeriod');
  const targetInput = document.getElementById(activeTimePickerTargetId);
  if (!hourSelect || !minuteSelect || !periodSelect || !targetInput) return;

  const timeValue = composeTimeValue(hourSelect.value, minuteSelect.value, periodSelect.value);
  targetInput.value = timeValue;

  if (activeTimePickerTrigger) {
    const valueNode = activeTimePickerTrigger.querySelector('.sched-time-trigger-value');
    if (valueNode) valueNode.textContent = formatTimeDisplay(timeValue);
  }

  closeTimePicker();
}

document.addEventListener('DOMContentLoaded', async () => {
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

    // Fetch latest telemetry for each node to get real temperature/pressure
    let telemetryByNodeId = {};
    let telemetryRecords = [];
    if (sb) {
      try {
        const { data: sbTelem } = await sb.from('telemetry').select('*').order('created', { ascending: false });
        if (sbTelem && sbTelem.length) telemetryRecords = sbTelem;
      } catch (e) {
        console.warn('Failed to fetch Supabase telemetry for scheduler:', e);
      }
    }
    if (!telemetryRecords.length && pb && typeof pb.collection === 'function') {
      try {
        telemetryRecords = await pb.collection('telemetry').getFullList({
          sort: '-created',
        });
      } catch (e) {
        console.warn('Failed to fetch telemetry for scheduler:', e);
      }
    }

    telemetryRecords.forEach(t => {
      if (t.node_id && !telemetryByNodeId[t.node_id]) {
        telemetryByNodeId[t.node_id] = t;
      }
      if (t.sensor_name && !telemetryByNodeId[t.sensor_name]) {
        telemetryByNodeId[t.sensor_name] = t;
      }
    });

    buildingRecords.forEach(b => buildings[b.id] = b);
    floorRecords.forEach(f => floors[f.id] = f);

    roomRecords.forEach(record => {
      const roomNodes = nodeRecords
        .filter(n => n.room_id === record.id)
        .map(n => {
          const latestTelemetry = telemetryByNodeId[n.name] || telemetryByNodeId[n.id] || {};
          const tVal = latestTelemetry.temperature !== undefined ? latestTelemetry.temperature : (n.temp !== undefined ? n.temp : 24.5);
          const pVal = latestTelemetry.pressure !== undefined ? latestTelemetry.pressure : (n.pressure !== undefined ? n.pressure : 0.45);
          return {
            id: n.name,
            pb_id: n.id,
            name: n.name,
            status: latestTelemetry.status || n.status || 'online',
            temp: parseFloat(tVal),
            pressure: parseFloat(pVal),
            wakeTime: n.wake_time && n.wake_time !== '00:00' ? n.wake_time : '06:00',
            sleepTime: n.sleep_time && n.sleep_time !== '00:00' ? n.sleep_time : '22:00',
            intervalVal: parseInt(n.interval_val) || 15,
            intervalUnit: n.interval_unit || 'Minutes',
            aircon_type: n.aircon_type || 'Split Type (Inverter)'
          };
        });

      savedRooms[record.id] = {
        id: record.id,
        name: record.name,
        floor_id: record.floor_id,
        nodeLimit: record.node_limit || 5,
        nodes: roomNodes
      };
    });
  } catch (error) {
    console.warn('PocketBase load error on Scheduler:', error);
  }

  const roomsList = document.getElementById('roomsList');
  roomsList.innerHTML = '';
  
  if (Object.keys(buildings).length === 0 && Object.keys(savedRooms).length === 0) {
    roomsList.innerHTML = '<div class="text-sm text-gray-500 text-center mt-4">No locations available.</div>';
  } else {
    const buildingFloors = {};
    Object.values(buildings).forEach(b => buildingFloors[b.id] = []);
    Object.values(floors).forEach(f => {
      if (buildingFloors[f.building_id]) buildingFloors[f.building_id].push(f);
    });
    
    const floorRooms = {};
    Object.values(floors).forEach(f => floorRooms[f.id] = []);
    Object.values(savedRooms).forEach(r => {
      if (r.floor_id && floorRooms[r.floor_id]) floorRooms[r.floor_id].push(r);
    });
    
    Object.values(buildings).forEach(building => {
      const bDiv = document.createElement('div');
      bDiv.className = 'mb-2';
      
      const bHeader = document.createElement('div');
      bHeader.className = 'flex items-center gap-2 bg-[#10b981]/10 px-3 py-2 rounded-t border-b border-[#10b981]/30 cursor-pointer hover:bg-[#10b981]/20 transition-colors';
      bHeader.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="text-[#10b981]">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span class="font-bold text-[#18392B] dark:text-cyan-400 text-sm">${building.name}</span>
      `;
      
      const floorsContainer = document.createElement('div');
      floorsContainer.className = 'bg-white dark:bg-[#0c1328]/40 border-x border-b border-gray-200 dark:border-white/5 rounded-b p-2 flex flex-col gap-2';
      
      bHeader.addEventListener('click', () => {
        floorsContainer.style.display = floorsContainer.style.display === 'none' ? 'flex' : 'none';
      });
      
      const myFloors = buildingFloors[building.id] || [];
      if (myFloors.length === 0) floorsContainer.innerHTML = '<div class="text-xs text-gray-400 p-2 text-center">No floors</div>';
      
      myFloors.forEach(floor => {
        const fDiv = document.createElement('div');
        fDiv.className = 'border border-gray-100 dark:border-white/5 rounded bg-gray-50 dark:bg-slate-900/60';
        
        const fHeader = document.createElement('div');
        fHeader.className = 'flex items-center px-2 py-1 border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800';
        fHeader.innerHTML = `
          <span class="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400">
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
        if (myRooms.length === 0) roomsContainer.innerHTML = '<div class="text-[10px] text-gray-400 p-1 text-center">No rooms</div>';
        
        myRooms.forEach(room => {
          const roomItem = document.createElement('div');
          const occupancy = room.nodeLimit > 0 ? Math.min((room.nodes.length / room.nodeLimit) * 100, 100) : 0;
          roomItem.className = 'room-item bg-white dark:bg-slate-950/40 border border-gray-200 dark:border-white/10 p-2 rounded cursor-pointer relative hover:border-[#10b981] dark:hover:border-[#10b981]/60 transition-colors';
          roomItem.setAttribute('data-room', room.id);
          roomItem.innerHTML = `
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-bold text-[#18392B] dark:text-gray-200 truncate">${room.name}</p>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">${room.nodes.length} ac sensor nodes</p>
              </div>
            </div>
          `;
          roomItem.addEventListener('click', (e) => {
            e.stopPropagation();
            selectRoom(room.id, room, savedRooms);
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

  if (Object.keys(savedRooms).length > 0) {
    const firstRoomId = Object.keys(savedRooms)[0];
    selectRoom(firstRoomId, savedRooms[firstRoomId], savedRooms);
  }

  ensureTimePickerModal();

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.sched-time-trigger');
    if (!trigger) return;
    const targetInputId = trigger.dataset.timeTarget;
    if (!targetInputId) return;
    openTimePicker(targetInputId, trigger);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeTimePicker();
    }
  });

  // Start background live telemetry sync so temperature matches live dashboard
  setInterval(refreshSchedulerTelemetry, 2500);
});

async function refreshSchedulerTelemetry() {
  const sb = window.supabaseClient || window.sb;
  if (!sb) return;
  try {
    const { data: telemData } = await sb.from('telemetry').select('*').order('created', { ascending: false }).limit(40);
    if (!telemData || !telemData.length) return;

    const telemMap = {};
    telemData.forEach(t => {
      if (t.node_id && !telemMap[t.node_id]) telemMap[t.node_id] = t;
      if (t.sensor_name && !telemMap[t.sensor_name]) telemMap[t.sensor_name] = t;
    });

    const { data: nodeData } = await sb.from('nodes').select('id, name, temp, pressure, status');
    if (nodeData) {
      nodeData.forEach(n => {
        if (!telemMap[n.name] && !telemMap[n.id]) {
          telemMap[n.name] = { temperature: n.temp, pressure: n.pressure, status: n.status };
        }
      });
    }

    Object.values(savedRooms).forEach(room => {
      if (room.nodes) {
        room.nodes.forEach(node => {
          const latest = telemMap[node.name] || telemMap[node.id] || telemMap[node.pb_id];
          if (latest) {
            if (latest.temperature !== undefined && latest.temperature !== null) {
              node.temp = parseFloat(latest.temperature);
            }
            if (latest.pressure !== undefined && latest.pressure !== null) {
              node.pressure = parseFloat(latest.pressure);
            }
            if (latest.status) node.status = latest.status;
          }
        });
      }
    });

    const rows = document.querySelectorAll('#schedulerTableBody .sched-table-row');
    rows.forEach(row => {
      const nameEl = row.querySelector('.font-bold.text-sm');
      if (nameEl) {
        const name = nameEl.textContent.trim();
        const latest = telemMap[name];
        if (latest) {
          const tempVal = parseFloat(latest.temperature ?? latest.temp);
          if (!isNaN(tempVal)) {
            const tempCell = row.cells[2];
            if (tempCell) {
              const tempSpan = tempCell.querySelector('span');
              if (tempSpan) tempSpan.innerHTML = `${Math.round(tempVal)} &deg;C`;
            }
          }
          const pressVal = parseFloat(latest.pressure);
          if (!isNaN(pressVal)) {
            const pressCell = row.cells[3];
            if (pressCell) {
              const pressSpan = pressCell.querySelector('span');
              if (pressSpan) pressSpan.innerHTML = `${pressVal.toFixed(1)} kPa`;
            }
          }
        }
      }
    });
  } catch (_) {}
}

function selectRoom(roomId, room, allRooms) {
  // Remove previous selection
  document.querySelectorAll('.room-item').forEach(item => {
    item.classList.remove('border-[#18392B]', 'bg-green-50', 'shadow-md', 'dark:border-[#10b981]', 'dark:bg-emerald-950/20');
    item.classList.add('border-gray-200', 'bg-white', 'dark:border-white/10', 'dark:bg-slate-950/40');
    item.setAttribute('aria-selected', 'false');
  });

  // Add selection to clicked room
  const roomElement = document.querySelector(`[data-room="${roomId}"]`);
  if (roomElement) {
    roomElement.classList.remove('border-gray-200', 'bg-white', 'dark:border-white/10', 'dark:bg-slate-950/40');
    roomElement.classList.add('border-[#18392B]', 'bg-green-50', 'shadow-md', 'dark:border-[#10b981]', 'dark:bg-emerald-950/20');
    roomElement.setAttribute('aria-selected', 'true');
  }

  // Update selected room
  selectedRoomId = roomId;

  // Update table title
  document.getElementById('tableTitle').innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" class="text-cyan-400"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/><path d="M12 12l-8-4.3 8-4.3 8 4.3"/></svg>${room.name} - Node Schedules`;

  // Load nodes for this room in the table
  loadRoomNodes(room.nodes);
}

function loadRoomNodes(nodes) {
  const schedulerTableBody = document.getElementById('schedulerTableBody');

  if (!nodes || nodes.length === 0) {
    schedulerTableBody.innerHTML = `
      <tr class="text-center bg-white dark:bg-[#0c1328]/40">
        <td colspan="8" class="px-4 py-6 text-gray-500 dark:text-gray-400 font-medium">No AC sensor nodes in this room</td>
      </tr>
    `;
    return;
  }

  let tableRows = '';
  nodes.forEach(node => {
    tableRows += createTableRow(node);
  });

  schedulerTableBody.innerHTML = tableRows;

  // Add event listeners for newly added apply buttons
  document.querySelectorAll('.apply-schedule-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const nodeId = e.currentTarget.dataset.nodeId;
      applyNodeSchedule(nodeId, e.currentTarget);
    });
  });
}

function createTableRow(node) {
  const temp = node.temp || 0.0;
  const pressure = node.pressure || 0.0;
  const stateRaw = (node.status || 'offline').toLowerCase();
  const isOnline = stateRaw === 'online';
  const acType = node.aircon_type || 'Split Type (Inverter)';
  
  return `
    <tr class="sched-table-row bg-white dark:bg-[#0c1328]/40 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors border-b border-gray-100 dark:border-white/5">
      <!-- AC SENSOR NAME -->
      <td class="px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="sched-icon-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="2" x2="12" y2="22"></line>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              <line x1="4.93" y1="19.07" x2="19.07" y2="4.93"></line>
            </svg>
          </div>
          <div>
            <div class="font-bold text-[#18392B] dark:text-cyan-400 text-sm">${node.name}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 font-medium">${node.name.includes('SRV') ? 'Server Room Node' : 'Lab Room Node'}</div>
          </div>
        </div>
      </td>

      <!-- AIRCON TYPE -->
      <td class="px-6 py-4">
        <span class="font-bold text-[#18392B] dark:text-gray-200 text-sm whitespace-nowrap">${acType}</span>
      </td>

      <!-- TEMPERATURE -->
      <td class="px-6 py-4">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path>
          </svg>
          <span class="font-bold text-[#18392B] dark:text-cyan-400 text-sm">${Math.round(temp)} &deg;C</span>
        </div>
      </td>

      <!-- AIRFLOW PRESSURE -->
      <td class="px-6 py-4">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 14 4-4"/>
            <path d="M3.34 19a10 10 0 1 1 17.32 0"/>
          </svg>
          <span class="font-bold text-[#18392B] dark:text-cyan-400 text-sm">${pressure.toFixed(1)} kPa</span>
        </div>
      </td>

      <!-- CURRENT STATE -->
      <td class="px-6 py-4">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#10b981]/10 dark:bg-emerald-950/20">
          <div class="w-2 h-2 rounded-full ${isOnline ? 'bg-[#10b981]' : 'bg-red-500'}"></div>
          <span class="text-xs font-bold ${isOnline ? 'text-[#18392B] dark:text-emerald-400' : 'text-red-500 dark:text-rose-400'}">${isOnline ? 'Online' : 'Offline'}</span>
        </div>
      </td>

      <!-- WAKE TIME -->
      <td class="px-6 py-4">
        <button type="button" class="sched-time-trigger" data-time-target="wake-${node.id}" data-time-label="Wake Time" aria-label="Edit wake time">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sched-time-trigger-icon">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2v2"></path>
            <path d="M12 20v2"></path>
            <path d="m4.93 4.93 1.41 1.41"></path>
            <path d="m17.66 17.66 1.41 1.41"></path>
            <path d="M2 12h2"></path>
            <path d="M20 12h2"></path>
            <path d="m6.34 17.66-1.41 1.41"></path>
            <path d="m19.07 4.93-1.41 1.41"></path>
          </svg>
          <div class="sched-time-trigger-content">
            <span class="sched-time-trigger-label">WAKE TIME</span>
            <span class="sched-time-trigger-value" id="wake-display-${node.id}">${formatTimeDisplay(node.wakeTime || '06:00')}</span>
          </div>
        </button>
        <input type="hidden" id="wake-${node.id}" value="${node.wakeTime || '06:00'}">
      </td>

      <!-- SLEEP TIME -->
      <td class="px-6 py-4">
        <button type="button" class="sched-time-trigger sleep" data-time-target="sleep-${node.id}" data-time-label="Sleep Time" aria-label="Edit sleep time">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sched-time-trigger-icon">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
          <div class="sched-time-trigger-content">
            <span class="sched-time-trigger-label">SLEEP TIME</span>
            <span class="sched-time-trigger-value" id="sleep-display-${node.id}">${formatTimeDisplay(node.sleepTime || '22:00')}</span>
          </div>
        </button>
        <input type="hidden" id="sleep-${node.id}" value="${node.sleepTime || '22:00'}">
      </td>

      <!-- SEND INTERVAL -->
      <td class="px-6 py-4">
        <div class="sched-interval-box flex items-center gap-1 border-[1px] border-[#10b981] dark:border-[#10b981]/40 rounded-[14px] bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow">
          <div class="text-[#334155] dark:text-gray-300 shrink-0">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <div class="flex flex-col justify-center">
            <span class="text-[10px] font-bold text-gray-400 tracking-widest uppercase">EVERY</span>
            <div class="flex items-center gap-2">
              <input type="number" id="interval-val-${node.id}" value="${node.intervalVal || 15}" min="1" class="w-8 text-lg font-bold text-[#18392B] dark:text-gray-100 bg-transparent border-b-2 border-gray-200 dark:border-white/10 focus:border-[#10b981] focus:outline-none p-0 text-center transition-colors" data-node-id="${node.id}">
              <select id="interval-unit-${node.id}" class="appearance-none border-[1.5px] border-[#10b981] dark:border-[#10b981]/40 rounded-lg px-2 py-0.5 text-sm font-bold text-[#18392B] dark:text-cyan-400 bg-white dark:bg-slate-900 cursor-pointer outline-none focus:ring-2 focus:ring-[#10b981]/20 transition-shadow" style="padding-right: 1.5rem; background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2318392B%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: right 0.25rem center; background-size: 1em;" data-node-id="${node.id}">
                <option value="Seconds" ${node.intervalUnit === 'Seconds' ? 'selected' : ''}>SEC</option>
                <option value="Minutes" ${!node.intervalUnit || node.intervalUnit === 'Minutes' ? 'selected' : ''}>MIN</option>
                <option value="Hours" ${node.intervalUnit === 'Hours' ? 'selected' : ''}>HR</option>
              </select>
            </div>
          </div>
        </div>
      </td>

      <!-- ACTIONS (APPLY BUTTON) -->
      <td class="px-6 py-4">
        <button data-node-id="${node.id}" class="apply-schedule-btn bg-[#18392B] dark:bg-[#10b981] hover:bg-[#10b981] dark:hover:bg-[#059669] hover:text-[#18392B] dark:hover:text-white text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-md border border-[#10b981] dark:border-[#10b981]/40 cursor-pointer">
          Apply
        </button>
      </td>
    </tr>
  `;
}

function applyNodeSchedule(nodeId, buttonElement) {
  const wakeTime = document.getElementById(`wake-${nodeId}`).value;
  const sleepTime = document.getElementById(`sleep-${nodeId}`).value;
  const intervalVal = parseInt(document.getElementById(`interval-val-${nodeId}`).value) || 15;
  const intervalUnit = document.getElementById(`interval-unit-${nodeId}`).value;

  // Global Collision Detection Logic (Across all rooms)
  let collisionRoom = null;
  let collisionNodeName = null;
  let hasCollision = false;

  for (const roomId in savedRooms) {
    const room = savedRooms[roomId];
    const collisionNode = room.nodes.find(n =>
      n.id !== nodeId &&
      n.intervalVal == intervalVal &&
      n.intervalUnit === intervalUnit
    );

    if (collisionNode) {
      hasCollision = true;
      collisionRoom = room.name || room.id;
      collisionNodeName = collisionNode.name || collisionNode.id;
      break;
    }
  }

  if (hasCollision) {
    showWarningModal(`Another AC sensor (${collisionNodeName} in ${collisionRoom}) is already using ${intervalVal} ${intervalUnit}. To prevent wireless data collisions across the system, please choose a different interval (e.g., ${intervalVal + 1} ${intervalUnit}).`);
    return; // Stop applying
  }

  // Calculate total seconds for the Hardware Node
  let sleepSecs = intervalVal;
  if (intervalUnit === 'Minutes') sleepSecs *= 60;
  if (intervalUnit === 'Hours') sleepSecs *= 3600;

  // Update the schedule in memory and PocketBase
  let targetRoomId = null;
  let targetRoom = null;
  let targetNodePbId = null;

  for (const roomId in savedRooms) {
    const room = savedRooms[roomId];
    const nodeIndex = room.nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex > -1) {
      room.nodes[nodeIndex].wakeTime = wakeTime;
      room.nodes[nodeIndex].sleepTime = sleepTime;
      room.nodes[nodeIndex].intervalVal = intervalVal;
      room.nodes[nodeIndex].intervalUnit = intervalUnit;

      targetRoomId = roomId;
      targetRoom = room;
      targetNodePbId = room.nodes[nodeIndex].pb_id;
      break;
    }
  }

  if (targetNodePbId && sb) {
    // Save to Supabase nodes table
    sb.from('nodes').update({
      wake_time: wakeTime,
      sleep_time: sleepTime,
      interval_val: intervalVal,
      interval_unit: intervalUnit,
      updated: new Date().toISOString()
    }).eq('id', targetNodePbId).then(() => {
      if (typeof window.invalidateScheduleCache === 'function') {
        window.invalidateScheduleCache(nodeId);
      }
      if (typeof notifyScheduleChange === 'function') {
        notifyScheduleChange(nodeId, targetRoom ? targetRoom.name : 'Room', wakeTime, sleepTime, targetRoomId);
      }
      if (typeof window.checkSensorSchedules === 'function') {
        window.checkSensorSchedules(true);
      }
      if (typeof syncSupabaseNodesToPocketBase === 'function') {
        syncSupabaseNodesToPocketBase().catch(() => {});
      }
    }).catch(err => console.error('Failed to save schedule to Supabase:', err));
  } else if (typeof notifyScheduleChange === 'function') {
    if (typeof window.invalidateScheduleCache === 'function') {
      window.invalidateScheduleCache(nodeId);
    }
    notifyScheduleChange(nodeId, targetRoom ? targetRoom.name : 'Room', wakeTime, sleepTime, targetRoomId);
    if (typeof window.checkSensorSchedules === 'function') {
      window.checkSensorSchedules(true);
    }
  }

  // Send the command to the Python backend to queue the LoRa downlink
  fetch('http://localhost:5000/api/set-sleep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      node_id: nodeId,
      sleep_seconds: sleepSecs
    })
  })
    .then(res => res.json())
    .then(data => {
      console.log("Hardware Schedule Queued:", data);
    })
    .catch(err => console.error("Failed to send sleep command to hardware:", err));

  // Provide user feedback
  if (buttonElement) {
    buttonElement.textContent = '✓ Applied';
    buttonElement.classList.replace('bg-[#18392B]', 'bg-[#10b981]');
    buttonElement.classList.add('text-[#18392B]');
    setTimeout(() => {
      buttonElement.textContent = 'Apply';
      buttonElement.classList.replace('bg-[#10b981]', 'bg-[#18392B]');
      buttonElement.classList.remove('text-[#18392B]');
    }, 2000);
  }
}

// Custom Warning Modal
function showWarningModal(message) {
  const modalHTML = `
    <div id="collision-modal" class="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in duration-200">
      <div class="bg-slate-800 border border-amber-500/50 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 transform transition-all">
        <div class="flex items-center gap-3 mb-4 text-amber-400">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <h3 class="text-xl font-bold">Collision Warning</h3>
        </div>
        <p class="text-slate-300 mb-6 leading-relaxed">${message}</p>
        <div class="flex justify-end">
          <button onclick="document.getElementById('collision-modal').remove()" class="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded transition-colors border border-slate-600">
            Got it
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}




