document.addEventListener('DOMContentLoaded', () => {
  const sb = window.supabaseClient || window.sb;
  
  // Load profile merging localStorage and Supabase session
  const localUser = JSON.parse(localStorage.getItem('ecoTrack_profile_user') || '{}');
  const user = {
    id: localUser.id || 'admin_default_01',
    username: localUser.username || 'admin',
    email: localUser.email || 'admin@ecotrack.local',
    role: localUser.role || 'admin',
    location: localUser.location || 'Philippines',
    avatar: localStorage.getItem('ecoTrack_avatar') || '',
    created: localUser.created || '2026-07-03T00:00:00Z',
    last_login: localUser.last_login || '2026-07-03T08:00:00Z',
    is_active: localUser.is_active !== undefined ? localUser.is_active : true,
    session_timeout: localUser.session_timeout || '30 minutes'
  };

  // Format Date Function
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  // Populate UI Fields
  const roleDisplay = user.role === 'admin' ? 'Administrator' : (user.role || 'User');
  const roleTitle = user.role === 'admin' ? 'System Administrator' : 'System User';
  const name = user.username || 'Administrator';
  
  const profileNameEl = document.getElementById('profile-name');
  if (profileNameEl) profileNameEl.textContent = name;
  
  const roleBadgeEl = document.getElementById('profile-role-badge');
  if (roleBadgeEl) roleBadgeEl.textContent = roleTitle;
  
  const profileEmailEl = document.getElementById('profile-email');
  if (profileEmailEl) profileEmailEl.textContent = user.email;
  
  const profileJoinedEl = document.getElementById('profile-joined');
  if (profileJoinedEl) profileJoinedEl.textContent = formatDate(user.created);

  const profileLocationEl = document.getElementById('profile-location');
  if (profileLocationEl) profileLocationEl.textContent = user.location;

  // Bind avatar
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarSvg = document.getElementById('profileAvatarSvg');
  if (user.avatar && profileAvatarImg && profileAvatarSvg) {
    profileAvatarImg.src = user.avatar;
    profileAvatarImg.classList.remove('hidden');
    profileAvatarSvg.classList.add('hidden');
  }
  
  const profileRoleTextEl = document.getElementById('profile-role-text');
  if (profileRoleTextEl) profileRoleTextEl.textContent = roleDisplay;
  
  const profilePermissionsEl = document.getElementById('profile-permissions');
  if (profilePermissionsEl) profilePermissionsEl.textContent = user.role === 'admin' ? 'Full Access' : 'Limited Access';
  
  const profileLastLoginEl = document.getElementById('profile-last-login');
  if (profileLastLoginEl) profileLastLoginEl.textContent = formatDateTime(user.last_login || user.created);
  
  const overviewUsernameEl = document.getElementById('overview-username');
  if (overviewUsernameEl) overviewUsernameEl.textContent = user.username;
  
  const overviewEmailEl = document.getElementById('overview-email');
  if (overviewEmailEl) overviewEmailEl.textContent = user.email;
  
  // Initialize and bind Dark Mode Toggle
  const darkModeToggle = document.getElementById('dark-mode-toggle-ui');
  const darkModeStatusText = document.getElementById('dark-mode-status-text');

  function updateDarkModeStatus(isDark) {
    if (!darkModeStatusText) return;
    if (isDark) {
      darkModeStatusText.textContent = 'Dark Mode';
      darkModeStatusText.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 transition-colors shadow-sm';
    } else {
      darkModeStatusText.textContent = 'Light Mode';
      darkModeStatusText.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 transition-colors shadow-sm';
    }
  }

  if (darkModeToggle) {
    const isDark = localStorage.getItem('ecoTrackTheme') === 'dark' || document.documentElement.classList.contains('dark');
    darkModeToggle.checked = isDark;
    updateDarkModeStatus(isDark);

    darkModeToggle.addEventListener('change', () => {
      const isChecked = darkModeToggle.checked;
      const newTheme = isChecked ? 'dark' : 'light';
      localStorage.setItem('ecoTrackTheme', newTheme);
      updateDarkModeStatus(isChecked);
      
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      
      window.dispatchEvent(new CustomEvent('theme:changed', { detail: newTheme }));
      
      // Sync other listeners on the same window
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'ecoTrackTheme',
        newValue: newTheme
      }));
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'ecoTrackTheme') {
        const isDarkNow = e.newValue === 'dark';
        darkModeToggle.checked = isDarkNow;
        updateDarkModeStatus(isDarkNow);
      }
    });

    window.addEventListener('theme:changed', (e) => {
      const isDarkNow = e.detail === 'dark';
      darkModeToggle.checked = isDarkNow;
      updateDarkModeStatus(isDarkNow);
    });
  }
  
  const overviewStatusEl = document.getElementById('overview-status');
  if (overviewStatusEl) {
    if (user.is_active === false) {
      overviewStatusEl.textContent = 'Inactive';
      overviewStatusEl.classList.replace('bg-emerald-50', 'bg-red-50');
      overviewStatusEl.classList.replace('text-[#10b981]', 'text-red-500');
    } else {
      overviewStatusEl.textContent = 'Active';
    }
  }

  // Populate Timeout dropdown
  const sessionTimeoutSelect = document.getElementById('session-timeout-select');
  if (sessionTimeoutSelect) {
    const savedTimeout = localStorage.getItem('ecoTrack_session_timeout') || user.session_timeout || '30 minutes';
    sessionTimeoutSelect.value = savedTimeout;
    sessionTimeoutSelect.addEventListener('change', () => {
      user.session_timeout = sessionTimeoutSelect.value;
      localStorage.setItem('ecoTrack_session_timeout', sessionTimeoutSelect.value);
      localStorage.setItem('ecoTrack_profile_user', JSON.stringify(user));
      
      if (typeof resetSessionTimeoutTimer === 'function') {
        resetSessionTimeoutTimer();
      }
      
      showProfileToast(`✓ Session timeout set to ${sessionTimeoutSelect.value}`, 'success');
    });
  }
  
  // Populate Edit Modal Fields
  const editNameEl = document.getElementById('edit-name');
  if (editNameEl) editNameEl.value = name;
  
  const editRoleEl = document.getElementById('edit-role');
  if (editRoleEl) {
    editRoleEl.value = roleTitle;
    editRoleEl.disabled = true; // Role shouldn't be casually editable by the user themselves here
  }
  
  const editEmailEl = document.getElementById('edit-email');
  if (editEmailEl) editEmailEl.value = user.email;

  const editLocationEl = document.getElementById('edit-location');
  if (editLocationEl) editLocationEl.value = user.location;

  // Modal logic
  const editProfileBtn = document.getElementById('editProfileBtn');
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  const viewHistoryBtn = document.getElementById('viewHistoryBtn');
  
  const editProfileModal = document.getElementById('editProfileModal');
  const changePasswordModal = document.getElementById('changePasswordModal');
  const viewHistoryModal = document.getElementById('viewHistoryModal');
  const viewAirconTypesModal = document.getElementById('viewAirconTypesModal');
  const addAirconTypeModal = document.getElementById('addAirconTypeModal');
  const closeBtns = document.querySelectorAll('.close-modal-btn');

  function openModal(modal) {
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function closeModal(modal) {
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => openModal(editProfileModal));
  }

  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', () => openModal(changePasswordModal));
  }

  if (viewHistoryBtn) {
    viewHistoryBtn.addEventListener('click', () => {
      openModal(viewHistoryModal);
      renderLoginHistory();
    });
  }

  const viewAirconTypesBtn = document.getElementById('viewAirconTypesBtn');
  if (viewAirconTypesBtn) {
    viewAirconTypesBtn.addEventListener('click', () => {
      openModal(viewAirconTypesModal);
      renderAirconTypes();
    });
  }

  const addAirconTypeBtn = document.getElementById('addAirconTypeBtn');
  if (addAirconTypeBtn) {
    addAirconTypeBtn.addEventListener('click', () => openModal(addAirconTypeModal));
  }

  closeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('div[id$="Modal"]');
      closeModal(modal);
    });
  });

  // Close when clicking outside modal content
  window.addEventListener('click', (e) => {
    if (e.target === editProfileModal) {
      closeModal(editProfileModal);
    }
    if (e.target === changePasswordModal) {
      closeModal(changePasswordModal);
    }
    if (e.target === viewHistoryModal) {
      closeModal(viewHistoryModal);
    }
    if (e.target === viewAirconTypesModal) {
      closeModal(viewAirconTypesModal);
    }
    if (e.target === addAirconTypeModal) {
      closeModal(addAirconTypeModal);
    }
  });

  // Save Profile Changes
  const saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
      const originalText = saveProfileBtn.textContent;
      saveProfileBtn.textContent = 'Saving...';
      saveProfileBtn.disabled = true;
      
      try {
        const updatedData = {
          username: editNameEl.value,
          email: editEmailEl.value,
          location: editLocationEl ? editLocationEl.value : 'Philippines'
        };
        
        // Save to localStorage
        const profileToSave = { ...user, ...updatedData };
        localStorage.setItem('ecoTrack_profile_user', JSON.stringify(profileToSave));

        if (sb && user.id) {
          const { error: sbUpdateErr } = await sb.from('administrators').update({
            username: updatedData.username,
            email: updatedData.email,
            updated: new Date().toISOString()
          }).eq('id', user.id);

          if (sbUpdateErr) {
            console.warn('[Supabase Profile Update]', sbUpdateErr.message);
          }
        }
        
        alert('Profile updated successfully!');
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert('Failed to update profile: ' + (err.data?.message || err.message));
      } finally {
        saveProfileBtn.textContent = originalText;
        saveProfileBtn.disabled = false;
      }
    });
  }

  // Update Password
  const updatePasswordBtn = document.getElementById('update-password-btn');
  if (updatePasswordBtn) {
    updatePasswordBtn.addEventListener('click', async () => {
      const currentPassword = document.getElementById('current-password').value;
      const newPassword = document.getElementById('new-password').value;
      const confirmPassword = document.getElementById('confirm-password').value;
      
      if (!currentPassword || !newPassword || !confirmPassword) {
        alert('Please fill in all password fields.');
        return;
      }
      
      if (newPassword !== confirmPassword) {
        alert('New passwords do not match.');
        return;
      }
      
      const originalText = updatePasswordBtn.textContent;
      updatePasswordBtn.textContent = 'Updating...';
      updatePasswordBtn.disabled = true;
      
      try {
        if (sb && user.id) {
          const { error: pwdErr } = await sb.from('administrators').update({
            password: newPassword,
            updated: new Date().toISOString()
          }).eq('id', user.id);

          if (pwdErr) throw new Error(pwdErr.message);
        }
        alert('Password updated successfully!');
        closeModal(changePasswordModal);
        
        // Clear inputs
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        
      } catch (err) {
        console.error(err);
        alert('Failed to update password: ' + (err.data?.message || err.message));
      } finally {
        updatePasswordBtn.textContent = originalText;
        updatePasswordBtn.disabled = false;
      }
    });
  }

  // Avatar Upload Logic
  const avatarContainer = document.getElementById('avatarContainer');
  const avatarFileInput = document.getElementById('avatarFileInput');
  if (avatarContainer && avatarFileInput) {
    avatarContainer.addEventListener('click', () => {
      avatarFileInput.click();
    });

    avatarFileInput.addEventListener('change', () => {
      const file = avatarFileInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Data = e.target.result;
        localStorage.setItem('ecoTrack_avatar', base64Data);
        
        if (profileAvatarImg && profileAvatarSvg) {
          profileAvatarImg.src = base64Data;
          profileAvatarImg.classList.remove('hidden');
          profileAvatarSvg.classList.add('hidden');
        }
        alert('Profile picture updated successfully!');
      };
      reader.readAsDataURL(file);
    });
  }

  // Login History Rendering
  function getLoginHistory() {
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('ecoTrack_loginHistory')) || [];
    } catch (e) {
      history = [];
    }
    if (!history.length) {
      const now = new Date();
      const formattedDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      history = [
        { id: 'log_cur', device: 'Windows • Chrome', ip: '127.0.0.1 (Current Session)', time: `${formattedDate} • ${formattedTime}`, status: 'Active', isCurrent: true }
      ];
      localStorage.setItem('ecoTrack_loginHistory', JSON.stringify(history));
    }
    return history;
  }

  function renderLoginHistory() {
    const listEl = document.getElementById('login-history-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const history = getLoginHistory();
    if (history.length === 0) {
      listEl.innerHTML = '<li class="text-sm text-gray-500 dark:text-gray-400 text-center py-6">No login activity recorded yet.</li>';
      return;
    }

    history.forEach(item => {
      const isCur = item.isCurrent;
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center p-3 rounded-xl bg-gray-50 dark:bg-slate-900/60 border border-gray-200 dark:border-white/5 transition-all';
      li.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl ${isCur ? 'bg-emerald-50 dark:bg-emerald-950/50 text-[#10b981] border border-emerald-500/30' : 'bg-gray-100 dark:bg-slate-800 text-gray-500'} flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <p class="font-bold text-gray-900 dark:text-gray-100 text-xs">${item.device || 'Desktop Dashboard'}</p>
              ${isCur ? '<span class="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40">Active Now</span>' : ''}
            </div>
            <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5">
              <span>IP: ${item.ip || '127.0.0.1'}</span>
              <span>•</span>
              <span>${item.time}</span>
            </p>
          </div>
        </div>
      `;
      listEl.appendChild(li);
    });
  }

  const clearHistoryBtn = document.getElementById('clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      const history = getLoginHistory();
      const cur = history.find(h => h.isCurrent);
      const newHistory = cur ? [cur] : [];
      localStorage.setItem('ecoTrack_loginHistory', JSON.stringify(newHistory));
      renderLoginHistory();
      showProfileToast('Past login activity history cleared.', 'info');
    });
  }

  // Aircon Types Logic
  let airconTypes = JSON.parse(localStorage.getItem('ecoTrack_airconTypes')) || [
    { name: 'Window Type (Inverter)' },
    { name: 'Split Type (Inverter)' },
    { name: 'Floor Standing' }
  ];

  function renderAirconTypes() {
    const listEl = document.getElementById('aircon-types-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    if (airconTypes.length === 0) {
      listEl.innerHTML = '<li class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No aircon types added yet.</li>';
      return;
    }

    airconTypes.forEach((type, index) => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center py-2 border-b border-gray-100 dark:border-white/5 last:border-0';
      li.innerHTML = `
        <div>
          <p class="font-bold text-gray-800 dark:text-gray-200 text-sm">${type.name}</p>
        </div>
        <button class="text-red-500 hover:text-red-700 text-xs px-2 py-1 bg-red-50 dark:bg-red-950/20 border border-red-500/10 rounded font-semibold transition-colors delete-type-btn" data-index="${index}">Remove</button>
      `;
      listEl.appendChild(li);
    });

    // Attach delete listeners
    document.querySelectorAll('.delete-type-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'));
        airconTypes.splice(index, 1);
        localStorage.setItem('ecoTrack_airconTypes', JSON.stringify(airconTypes));
        renderAirconTypes();
      });
    });
  }

  const saveAirconTypeBtn = document.getElementById('save-aircon-type-btn');
  if (saveAirconTypeBtn) {
    saveAirconTypeBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('new-aircon-name');
      const name = nameInput.value.trim();
      
      if (!name) {
        alert('Please fill in the Type Name.');
        return;
      }
      
      airconTypes.push({ name });
      localStorage.setItem('ecoTrack_airconTypes', JSON.stringify(airconTypes));
      
      // Clear inputs
      nameInput.value = '';
      closeModal(addAirconTypeModal);
      
      // If view modal is open, refresh it
      if (!viewAirconTypesModal.classList.contains('hidden')) {
        renderAirconTypes();
      }
      alert('Aircon type added successfully!');
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
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        btn.title = 'Show Password';
      }
    });
  });
});

// Profile Toast Helper
function showProfileToast(message, type = 'info') {
  let container = document.getElementById('ecoTrackToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ecoTrackToastContainer';
    container.className = 'fixed bottom-6 right-6 z-[99999] flex flex-col gap-2.5 pointer-events-none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border text-sm font-semibold transition-all duration-300 transform translate-y-2 opacity-0';

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
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </div>`;
  } else {
    borderColor = 'border-[#10b981]/50';
    iconSvg = `<div class="w-7 h-7 rounded-full bg-[#10b981]/20 text-[#10b981] flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>`;
  }

  toast.classList.add(borderColor, bgColor, textColor);
  toast.innerHTML = `
    ${iconSvg}
    <span class="flex-1">${message}</span>
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
