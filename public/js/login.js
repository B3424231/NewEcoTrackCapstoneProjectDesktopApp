/**
 * EcoTrack Login & Registration Controller
 * Handles Supabase authentication, session synchronization, Remember-Me, and input validation.
 */

document.addEventListener('DOMContentLoaded', async () => {
    /** @type {HTMLFormElement | null} */
    const loginForm = document.getElementById('login-form');
    /** @type {HTMLFormElement | null} */
    const registerForm = document.getElementById('register-form');
    const showRegisterBtn = document.getElementById('show-register-btn');
    const showLoginBtn = document.getElementById('show-login-btn');
    const formSubtitle = document.getElementById('form-subtitle');
    const authAlert = document.getElementById('auth-alert');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const rememberCheckbox = document.getElementById('remember-me');
    let registrationPending = false;
    let loginPending = false;
    const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

    // Migrate remembered emails only; usernames and phone numbers are not sign-in identifiers.
    try {
        const savedEmail = (localStorage.getItem('ecoTrack_remember_email') || localStorage.getItem('ecoTrack_remember_username') || '').trim().toLowerCase();
        localStorage.removeItem('ecoTrack_remember_username');
        if (isValidEmail(savedEmail) && emailInput) {
            emailInput.value = savedEmail;
            localStorage.setItem('ecoTrack_remember_email', savedEmail);
            if (rememberCheckbox) rememberCheckbox.checked = true;
            if (passwordInput) passwordInput.focus();
        } else {
            localStorage.removeItem('ecoTrack_remember_email');
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
            authAlert.classList.add('bg-red-950/70', 'border', 'border-red-800/60', 'text-red-300');
            iconSvg = `<svg class="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
        } else if (type === 'success') {
            authAlert.classList.add('bg-emerald-950/70', 'border', 'border-emerald-800/60', 'text-emerald-300');
            iconSvg = `<svg class="w-5 h-5 flex-shrink-0 mt-0.5 text-teal-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`;
        } else {
            authAlert.classList.add('bg-cyan-950/70', 'border', 'border-cyan-800/60', 'text-cyan-300');
            iconSvg = `<svg class="w-5 h-5 flex-shrink-0 mt-0.5 text-cyan-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>`;
        }

        authAlert.innerHTML = iconSvg;
        const messageElement = document.createElement('div');
        messageElement.textContent = message;
        authAlert.appendChild(messageElement);
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
    const cardMainTitle = document.getElementById('card-main-title');

    // Toggle forms (Login vs Register)
    if (showRegisterBtn && showLoginBtn && loginForm && registerForm) {
        showRegisterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAlert();
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
            if (cardMainTitle) cardMainTitle.textContent = 'Register as an Administrator';
            if (formSubtitle) formSubtitle.textContent = 'Enter your details to register an administrator account.';
            const firstRegInput = document.getElementById('reg-username');
            if (firstRegInput) firstRegInput.focus();
        });

        showLoginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAlert();
            registerForm.style.display = 'none';
            loginForm.style.display = 'block';
            if (cardMainTitle) cardMainTitle.textContent = 'Welcome back!';
            if (formSubtitle) formSubtitle.textContent = 'Enter your credentials to access your EcoTrack account.';
            if (emailInput) emailInput.focus();
        });
    }

    // Recovery uses an isolated, temporary Auth client and never signs in to the dashboard.
    window.EcoTrackPasswordRecovery?.mount({
        getInitialEmail: () => emailInput?.value || '',
        onSuccess: email => {
            if (emailInput) emailInput.value = email;
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.focus();
            }
            showAlert('success', 'Password updated. Sign in with your email and new password.');
        }
    });

    // Privacy Policy & Terms Modal
    const privacyBtn = document.getElementById('privacy-policy-btn');
    const termsBtn = document.getElementById('terms-service-btn');
    const infoModal = document.getElementById('info-modal');
    const infoModalTitle = document.getElementById('info-modal-title');
    const infoModalBody = document.getElementById('info-modal-body');
    const closeInfoBtn = document.getElementById('close-info-modal');
    const dismissInfoBtn = document.getElementById('dismiss-info-modal');

    if (infoModal && infoModalTitle && infoModalBody) {
        const openInfoModal = (title, html) => {
            infoModalTitle.textContent = title;
            infoModalBody.innerHTML = html;
            infoModal.classList.remove('hidden');
        };

        if (privacyBtn) {
            privacyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openInfoModal('Privacy Policy', `
                    <p class="mb-2"><strong>EcoTrack Privacy Commitment</strong></p>
                    <p class="text-slate-300">EcoTrack manages air-conditioning units and targeted IR commands to optimize facility climate and energy control.</p>
                    <p class="text-slate-300">All data transmitted to and from AC Controller Devices is processed locally or stored securely within encrypted databases. We do not sell or monetize facility data.</p>
                `);
            });
        }

        if (termsBtn) {
            termsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openInfoModal('Terms of Service', `
                    <p class="mb-2"><strong>EcoTrack System Operations</strong></p>
                    <p class="text-slate-300">By using the EcoTrack Desktop Dashboard, you agree to maintain responsible control of facility HVAC equipment and monitor telemetry control thresholds.</p>
                    <p class="text-slate-300">Automated IR command transmissions and relay cutoffs are governed by user-configured scheduling and threshold rules.</p>
                `);
            });
        }

        [closeInfoBtn, dismissInfoBtn].forEach(btn => {
            if (btn) btn.addEventListener('click', () => infoModal.classList.add('hidden'));
        });
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) infoModal.classList.add('hidden');
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
                btn.setAttribute('aria-label', 'Hide password');
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
            } else {
                input.type = 'password';
                btn.setAttribute('aria-label', 'Show password');
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

    function cloudAuthMessage(error) {
        const message = typeof error === 'string' ? error : error?.message || '';
        const status = error?.status;
        if (status === 0 || status >= 500 || /fetch|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ERR_NAME_NOT_RESOLVED|NameResolutionError|getaddrinfo|load failed/i.test(message + ' ' + (error?.code || ''))) {
            return 'The cloud connection is temporarily unavailable. Check your internet connection and try signing in again.';
        }
        return message || 'Authentication failed. Please check your credentials.';
    }

    // Authenticate with the exact password entered; recovery and sign-in share Supabase Auth.
    async function attemptSupabaseAuth(email, password) {
        const sb = window.supabaseClient || window.sb;
        if (!sb || !sb.auth) {
            return { success: false, error: 'Supabase authentication service is unavailable.' };
        }

        const res = await sb.auth.signInWithPassword({ email, password });
        if (!res.error && res.data && res.data.user) {
            return { success: true, user: res.data.user, session: res.data.session };
        }

        const rawMsg = (res.error && res.error.message) ? res.error.message : '';
        const errMessage = rawMsg.toLowerCase();
        if (errMessage.includes('secret api key') || errMessage.includes('forbidden use of secret')) {
            console.error('[EcoTrack Auth] Forbidden secret key error intercepted:', rawMsg);
            return { success: false, error: 'Authentication service requires a valid publishable key. Please verify configuration.' };
        }

        return { success: false, error: res.error ? cloudAuthMessage(res.error) : 'Invalid credentials' };
    }

    function isDesktopAdministrator(record, user) {
        return record && user?.id && record.userType === 'admin' && record.authUserId === user.id &&
            record.is_active !== false && record.isActive !== false &&
            record.is_archived !== true && record.isArchived !== true;
    }

    // Helper to persist user profile session without recording a reopen as a new login.
    function saveUserSession(record, authSession, restoring = false) {
        if (!record) return;
        let previousProfile = {};
        if (restoring) {
            try {
                const cached = JSON.parse(localStorage.getItem('ecoTrack_profile_user') || '{}');
                if (cached.id === record.id) previousProfile = cached;
            } catch (_) {}
        }
        const profile = {
            id: record.id || '',
            username: record.name || record.username || (record.email ? record.email.split('@')[0] : 'Administrator'),
            name: record.name || record.username || 'Administrator',
            email: record.email || '',
            role: record.role || (record.userType === 'staff' ? 'Staff' : 'Administrator'),
            userType: record.userType || (record.role === 'admin' ? 'admin' : 'staff'),
            phone: record.phone || '',
            photoUrl: record.photoUrl || record.photo_url || '',
            avatar: record.avatar || '',
            assignment: record.assignment || '',
            is_active: record.is_active !== undefined ? record.is_active : true,
            created: record.created || previousProfile.created || new Date().toISOString(),
            last_login: restoring ? previousProfile.last_login || record.last_login || null : new Date().toISOString(),
            location: record.location || previousProfile.location || 'Philippines'
        };
        localStorage.setItem('ecoTrack_profile_user', JSON.stringify(profile));

        const token = (authSession && authSession.access_token)
            ? authSession.access_token
            : ('sb_token_' + (profile.id || 'admin'));

        localStorage.setItem('ecoTrack_auth_token', token);
        localStorage.setItem('userToken', token);
        if (authSession?.refresh_token) {
            localStorage.setItem('ecoTrack_refresh_token', authSession.refresh_token);
        }
        localStorage.removeItem('ecoTrack_require_login');
        if (!restoring) recordLoginHistoryEntry(profile.username || 'admin');
    }

    async function restoreSavedSession() {
        const parameters = new URLSearchParams(window.location.search);
        // Only an app launch requests restoration. Direct sign-in visits also serve registration/recovery.
        if (parameters.get('resume') !== '1' || parameters.get('timeout') === 'true' || localStorage.getItem('ecoTrack_require_login')) {
            document.documentElement?.classList.remove('restoring-session');
            return;
        }
        const sb = window.supabaseClient || window.sb;
        if (!sb?.auth) {
            document.documentElement?.classList.remove('restoring-session');
            return;
        }
        const loginBtn = loginForm?.querySelector('.submit-btn');
        const previousContent = loginBtn?.innerHTML;
        let redirecting = false;
        let restorationTimedOut = false;
        let deadlineTimer;
        loginPending = true;
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.setAttribute('aria-busy', 'true');
            loginBtn.textContent = 'Restoring session...';
        }
        try {
            await Promise.race([
                (async () => {
                    await window.ecotrackAuthReady;
                    if (restorationTimedOut) return;
                    const { data, error } = await sb.auth.getSession();
                    if (restorationTimedOut) return;
                    if (error) throw error;
                    const savedSession = data?.session;
                    if (!savedSession) return;
                    const { data: identity, error: userError } = await sb.auth.getUser();
                    if (restorationTimedOut) return;
                    if (userError) throw userError;
                    if (!identity?.user?.id || identity.user.id !== savedSession.user?.id) throw new Error('Session identity mismatch');
                    const { data: account, error: profileError } = await sb.rpc('ecotrack_my_profile');
                    if (restorationTimedOut) return;
                    if (profileError) throw profileError;
                    if (!isDesktopAdministrator(account, identity.user)) throw new Error('An active administrator account is required.');
                    if (window.electron?.invoke) {
                        const authorized = await window.electron.invoke('auth-set-session', savedSession);
                        if (!authorized?.success) throw new Error(authorized?.error || 'Session could not be restored.');
                    }
                    // Late requests and another window's logout/timeout cannot restore this account.
                    if (restorationTimedOut || localStorage.getItem('ecoTrack_require_login')) return;
                    saveUserSession(account, savedSession, true);
                    window.location.replace(window.EcoTrackMode?.home() || 'dashboard.html');
                    redirecting = true;
                })(),
                new Promise((_, reject) => {
                    deadlineTimer = setTimeout(() => {
                        restorationTimedOut = true;
                        reject(new Error('Session restoration timed out.'));
                    }, 15000);
                })
            ]);
        } catch (_) {
            showAlert('info', 'Your saved session could not be restored. Please sign in to continue.');
        } finally {
            clearTimeout(deadlineTimer);
            if (!redirecting) document.documentElement?.classList.remove('restoring-session');
            loginPending = false;
            if (loginBtn) {
                loginBtn.innerHTML = previousContent;
                loginBtn.disabled = false;
                loginBtn.removeAttribute('aria-busy');
            }
        }
    }

    // ===== LOGIN SUBMISSION =====
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginPending) return;
            clearAlert();

            const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
            const password = passwordInput ? passwordInput.value : '';
            const isRemember = rememberCheckbox ? rememberCheckbox.checked : false;
            const loginBtn = loginForm.querySelector('.submit-btn');
            const loginButtonContent = loginBtn?.innerHTML || 'Sign in';

            if (!isValidEmail(email)) {
                showAlert('error', 'Please enter a valid email address.');
                emailInput?.focus();
                return;
            }
            if (!password) {
                showAlert('error', 'Please enter your password.');
                passwordInput?.focus();
                return;
            }
            if (emailInput) emailInput.value = email;

            // Save or clear remember-me
            try {
                if (isRemember) localStorage.setItem('ecoTrack_remember_email', email);
                else localStorage.removeItem('ecoTrack_remember_email');
                localStorage.removeItem('ecoTrack_remember_username');
            } catch (_) {}

            // Loading state
            loginPending = true;
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
                loginBtn.setAttribute('aria-busy', 'true');
            }

            try {
                const sb = window.supabaseClient || window.sb;

                if (!sb) {
                    throw new Error('Supabase client is not loaded. Please verify your internet connection.');
                }

                const attempt = await attemptSupabaseAuth(email, password);
                const activeSession = attempt.session;
                const authenticatedUser = attempt.user;

                // Successful login handler
                if (attempt.success && authenticatedUser && activeSession) {
                    // Fetch profile details via security-definer RPC
                    const { data: profileData, error: profileError } = await sb.rpc('ecotrack_my_profile');
                    if (profileError) throw profileError;
                    if (!profileData) throw new Error('Your account profile could not be verified. Please try signing in again.');

                    if (!isDesktopAdministrator(profileData, authenticatedUser)) {
                        await sb.auth.signOut();
                        throw new Error('An active administrator account is required for the desktop dashboard.');
                    }
                    if (window.electron?.invoke) {
                        const authorized = await window.electron.invoke('auth-set-session', activeSession);
                        if (!authorized.success) throw new Error(authorized.error);
                    }

                    const sessionRecord = {
                        id: profileData?.id || authenticatedUser.id,
                        username: profileData?.name || profileData?.username || authenticatedUser.user_metadata?.full_name || email,
                        name: profileData?.name || authenticatedUser.user_metadata?.full_name || email,
                        email: profileData?.email || authenticatedUser.email,
                        role: profileData?.role || (profileData?.userType === 'staff' ? 'Staff' : 'Administrator'),
                        userType: profileData?.userType || 'admin',
                        phone: profileData?.phone || '',
                        photoUrl: profileData?.photoUrl || '',
                        avatar: profileData?.avatar || '',
                        assignment: profileData?.assignment || '',
                        created: new Date().toISOString(),
                        last_login: new Date().toISOString()
                    };

                    saveUserSession(sessionRecord, activeSession);

                    showAlert('success', `Welcome back, ${sessionRecord.name || 'Administrator'}! Redirecting...`);

                    if (typeof window.showPageLoader === 'function') {
                        window.showPageLoader('spinner');
                    }

                    setTimeout(() => {
                        window.location.href = window.EcoTrackMode?.home() || 'dashboard.html';
                    }, 500);
                    return;
                }

                showAlert('error', attempt.error || 'Invalid email or password. Please verify your credentials.');

            } catch (error) {
                console.error('Supabase auth attempt error:', error);
                showAlert('error', cloudAuthMessage(error));

            } finally {
                loginPending = false;
                if (loginBtn) {
                    loginBtn.innerHTML = loginButtonContent;
                    loginBtn.disabled = false;
                    loginBtn.removeAttribute('aria-busy');
                }
            }
        });
    }

    // ===== REGISTRATION SUBMISSION =====
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (registrationPending) return;
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

            registrationPending = true;
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
                if (!sb) throw new Error('Database client is not initialized. Please ensure live configuration is loaded.');

                const registration = window.EcoTrackAdminRegistration;
                if (!registration) throw new Error('Administrator registration is unavailable. Reload and try again.');
                await registration.registerAdministrator(sb, { username, email, password }, {
                    invoke: window.electron?.invoke ? (channel, input) => window.electron.invoke(channel, input) : null
                });

                // Creating another administrator keeps the current administrator's session.
                registerForm.reset();
                registerForm.style.display = 'none';
                if (loginForm) loginForm.style.display = 'block';
                if (cardMainTitle) cardMainTitle.textContent = 'Welcome back!';
                if (formSubtitle) formSubtitle.textContent = 'Enter your credentials to access your EcoTrack account.';
                if (emailInput) emailInput.value = email.toLowerCase();
                if (passwordInput) passwordInput.value = '';
                showAlert('success', 'Administrator account created. The new administrator can now sign in with their email and password.');

            } catch (error) {
                const msg = error.message || '';
                if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch') || msg.includes('ENOTFOUND')) {
                    showAlert('error', 'Unable to reach the cloud database. Please verify your internet connection.');
                } else {
                    showAlert('error', msg || 'Registration failed. Please check your information.');
                }

            } finally {
                registrationPending = false;
                if (registerBtn) {
                    registerBtn.innerHTML = 'Register as an Administrator';
                    registerBtn.disabled = false;
                }
            }
        });
    }
    await restoreSavedSession();
});
