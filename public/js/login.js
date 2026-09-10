/**
 * EcoTrack Login & Registration Controller
 * Handles Supabase authentication, session synchronization, Remember-Me, and input validation.
 */

document.addEventListener('DOMContentLoaded', () => {
    /** @type {HTMLFormElement | null} */
    const loginForm = document.getElementById('login-form');
    /** @type {HTMLFormElement | null} */
    const registerForm = document.getElementById('register-form');
    const showRegisterBtn = document.getElementById('show-register-btn');
    const showLoginBtn = document.getElementById('show-login-btn');
    const formSubtitle = document.getElementById('form-subtitle');
    const authAlert = document.getElementById('auth-alert');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const rememberCheckbox = document.getElementById('remember-me');

    // Restore Remembered Username
    try {
        const savedUsername = localStorage.getItem('ecoTrack_remember_username');
        if (savedUsername && usernameInput) {
            usernameInput.value = savedUsername;
            if (rememberCheckbox) rememberCheckbox.checked = true;
            if (passwordInput) passwordInput.focus();
        }
    } catch (e) {
        console.warn('Could not read remember-me storage:', e);
    }

    /**
     * Display styled alert feedback
     * @param {'error' | 'success' | 'info'} type 
     * @param {string} message 
     */
    function showAlert(type, message) {
        if (!authAlert) return;
        authAlert.className = 'mb-5 p-3.5 rounded-xl text-sm font-medium flex items-start gap-2.5 transition-all animate-fade-up';
        
        let iconSvg = '';
        if (type === 'error') {
            authAlert.classList.add('bg-red-50', 'dark:bg-red-950/40', 'border', 'border-red-200', 'dark:border-red-800/50', 'text-red-700', 'dark:text-red-300');
            iconSvg = `<svg class="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
        } else if (type === 'success') {
            authAlert.classList.add('bg-emerald-50', 'dark:bg-emerald-950/40', 'border', 'border-emerald-200', 'dark:border-emerald-800/50', 'text-emerald-700', 'dark:text-emerald-300');
            iconSvg = `<svg class="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`;
        } else {
            authAlert.classList.add('bg-cyan-50', 'dark:bg-cyan-950/40', 'border', 'border-cyan-200', 'dark:border-cyan-800/50', 'text-cyan-700', 'dark:text-cyan-300');
            iconSvg = `<svg class="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>`;
        }

        authAlert.innerHTML = `${iconSvg}<div>${message}</div>`;
        authAlert.classList.remove('hidden');
    }

    function clearAlert() {
        if (!authAlert) return;
        authAlert.classList.add('hidden');
        authAlert.innerHTML = '';
    }

    // Auto-clear alert when user types in inputs
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
            clearAlert();
        });
    });

    // Toggle forms
    if (showRegisterBtn && showLoginBtn && loginForm && registerForm) {
        showRegisterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAlert();
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
            if (formSubtitle) formSubtitle.textContent = 'Create a new administrator account.';
            const firstRegInput = document.getElementById('reg-username');
            if (firstRegInput) firstRegInput.focus();
        });

        showLoginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAlert();
            registerForm.style.display = 'none';
            loginForm.style.display = 'block';
            if (formSubtitle) formSubtitle.textContent = 'Welcome back! Please login to your account.';
            if (usernameInput) usernameInput.focus();
        });
    }

    // Password Toggle Logic
    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const input = btn.parentElement.querySelector('input');
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
            } else {
                input.type = 'password';
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
            }
        });
    });

    // Check for Session Timeout parameter in URL
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('timeout') === 'true') {
            showAlert('error', 'Your session timed out due to inactivity. Please log in again.');
        }
    } catch (e) {}

    // Record login activity entry
    function recordLoginHistoryEntry(username) {
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem('ecoTrack_loginHistory')) || [];
        } catch (e) {
            history = [];
        }
        
        const ua = navigator.userAgent;
        let os = 'Windows';
        if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
        else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('Linux')) os = 'Linux';

        let browser = 'Chrome';
        if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Edg/')) browser = 'Edge';
        else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';

        const now = new Date();
        const formattedDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        const newEntry = {
            id: 'log_' + Date.now(),
            device: `${os} • ${browser}`,
            ip: '127.0.0.1 (Current Session)',
            time: `${formattedDate} • ${formattedTime}`,
            status: 'Active',
            isCurrent: true
        };

        history = history.map(h => ({ ...h, isCurrent: false, status: 'Completed' }));
        history.unshift(newEntry);
        if (history.length > 20) history = history.slice(0, 20);

        localStorage.setItem('ecoTrack_loginHistory', JSON.stringify(history));
    }

    // Helper to persist user profile session
    function saveUserSession(record) {
        if (!record) return;
        const profile = {
            id: record.id || '',
            username: record.username || '',
            email: record.email || (record.username ? `${record.username}@ecotrack.com` : ''),
            role: record.role || 'Administrator',
            is_active: record.is_active !== undefined ? record.is_active : true,
            created: record.created || new Date().toISOString(),
            last_login: new Date().toISOString(),
            location: 'Philippines'
        };
        localStorage.setItem('ecoTrack_profile_user', JSON.stringify(profile));
        recordLoginHistoryEntry(record.username || 'admin');
    }

    // ===== LOGIN SUBMISSION =====
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAlert();

            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            const isRemember = rememberCheckbox ? rememberCheckbox.checked : false;
            const loginBtn = loginForm.querySelector('.submit-btn');

            if (!username || !password) {
                showAlert('error', 'Please enter both username and password.');
                return;
            }

            // Save or clear remember-me
            if (isRemember) {
                localStorage.setItem('ecoTrack_remember_username', username);
            } else {
                localStorage.removeItem('ecoTrack_remember_username');
            }

            // Loading state
            if (loginBtn) {
                loginBtn.innerHTML = `
                    <span class="inline-flex items-center gap-2">
                        <svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Logging in...
                    </span>
                `;
                loginBtn.disabled = true;
            }

            try {
                const sb = window.supabaseClient || window.sb;
                let authRecord = null;

                if (sb) {
                    // Authenticate directly against Supabase administrators table
                    const { data: user, error: sbError } = await sb
                        .from('administrators')
                        .select('*')
                        .or(`username.eq.${username},email.eq.${username}`)
                        .eq('password', password)
                        .maybeSingle();

                    if (!sbError && user) {
                        authRecord = user;
                    }
                }

                // If user authenticated via Supabase
                if (authRecord) {
                    console.log('✅ Supabase Login successful:', authRecord.username);
                    saveUserSession(authRecord);
                    
                    showAlert('success', `Welcome back, ${authRecord.username || 'Administrator'}! Redirecting...`);

                    if (typeof window.showPageLoader === 'function') {
                        window.showPageLoader('spinner');
                    }

                    setTimeout(() => {
                        window.location.href = 'analytics.html';
                    }, 500);
                    return;
                }

                showAlert('error', 'Invalid username or password. Please verify your credentials.');

            } catch (error) {
                console.error('Supabase auth attempt error:', error);
                showAlert('error', error.message || 'Authentication failed. Please check your credentials.');

            } finally {
                if (loginBtn) {
                    loginBtn.innerHTML = 'Login';
                    loginBtn.disabled = false;
                }
            }
        });
    }

    // ===== REGISTRATION SUBMISSION =====
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAlert();

            const regUsernameInput = document.getElementById('reg-username');
            const regEmailInput = document.getElementById('reg-email');
            const regPasswordInput = document.getElementById('reg-password');
            const regPasswordConfirmInput = document.getElementById('reg-password-confirm');
            const registerBtn = registerForm.querySelector('.submit-btn');

            const username = regUsernameInput ? regUsernameInput.value.trim() : '';
            const email = regEmailInput ? regEmailInput.value.trim() : '';
            const password = regPasswordInput ? regPasswordInput.value : '';
            const passwordConfirm = regPasswordConfirmInput ? regPasswordConfirmInput.value : '';

            // Client-side validations
            if (!username || username.length < 3) {
                showAlert('error', 'Username must be at least 3 characters long.');
                if (regUsernameInput) regUsernameInput.focus();
                return;
            }

            if (!email || !email.includes('@') || !email.includes('.')) {
                showAlert('error', 'Please enter a valid email address.');
                if (regEmailInput) regEmailInput.focus();
                return;
            }

            if (!password || password.length < 8) {
                showAlert('error', 'Password must be at least 8 characters long.');
                if (regPasswordInput) regPasswordInput.focus();
                return;
            }

            if (password !== passwordConfirm) {
                showAlert('error', 'Passwords do not match. Please check and try again.');
                if (regPasswordConfirmInput) regPasswordConfirmInput.focus();
                return;
            }

            if (registerBtn) {
                registerBtn.innerHTML = `
                    <span class="inline-flex items-center gap-2">
                        <svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating Account...
                    </span>
                `;
                registerBtn.disabled = true;
            }

            try {
                const sb = window.supabaseClient || window.sb;
                if (!sb) throw new Error('Supabase client is not initialized.');

                // Check if username or email is already registered in Supabase
                const { data: existing, error: checkErr } = await sb
                    .from('administrators')
                    .select('id, username, email')
                    .or(`username.eq.${username},email.eq.${email}`);

                if (existing && existing.length > 0) {
                    if (existing.some(u => u.username.toLowerCase() === username.toLowerCase())) {
                        showAlert('error', 'Username is already taken.');
                        return;
                    }
                    if (existing.some(u => u.email.toLowerCase() === email.toLowerCase())) {
                        showAlert('error', 'Email is already registered.');
                        return;
                    }
                }

                // Insert administrator into Supabase
                const { data: newRecord, error: insertError } = await sb
                    .from('administrators')
                    .insert([{
                        username: username,
                        email: email,
                        password: password,
                        role: 'admin',
                        is_active: true
                    }])
                    .select()
                    .single();

                if (insertError) {
                    throw new Error(insertError.message || 'Failed to create administrator account.');
                }

                console.log('✅ Admin registered in Supabase:', newRecord);
                saveUserSession(newRecord);

                showAlert('success', 'Account created successfully in Supabase! Redirecting to dashboard...');

                if (typeof window.showPageLoader === 'function') {
                    window.showPageLoader('spinner');
                }

                setTimeout(() => {
                    window.location.href = 'analytics.html';
                }, 700);

            } catch (error) {
                console.error('Supabase registration failed:', error);
                showAlert('error', error.message || 'Registration failed. Please check your information.');

            } finally {
                if (registerBtn) {
                    registerBtn.innerHTML = 'Create Account';
                    registerBtn.disabled = false;
                }
            }
        });
    }
});
