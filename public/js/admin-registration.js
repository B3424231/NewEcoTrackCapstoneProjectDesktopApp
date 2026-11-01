(function (root) {
  'use strict';

  function registrationError(message, code) {
    return Object.assign(new Error(message), { code });
  }

  function normalizeProfile(profile = {}) {
    const username = typeof profile.username === 'string' ? profile.username.trim() : '';
    const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
    const password = typeof profile.password === 'string' ? profile.password : '';
    if (username.length < 3 || username.length > 120) throw registrationError('Username must be between 3 and 120 characters.', 'INVALID_PROFILE');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw registrationError('Enter a valid email address.', 'INVALID_PROFILE');
    if (password.length < 8 || password.length > 1024) throw registrationError('Password must be between 8 and 1024 characters.', 'INVALID_PROFILE');
    // User-supplied roles, IDs and active flags never reach the provisioning service.
    return { username, email, password };
  }

  async function verifiedAdministrator(client) {
    if (!client?.auth || typeof client.rpc !== 'function') return null;
    const sessionResult = await client.auth.getSession();
    const session = sessionResult?.data?.session;
    if (sessionResult?.error || !session?.access_token || !session?.refresh_token || !session?.user?.id) return null;
    const identity = await client.auth.getUser();
    if (identity?.error || identity?.data?.user?.id !== session.user.id) return null;
    const allowed = await client.rpc('ecotrack_is_admin');
    if (allowed?.error || allowed?.data !== true) return null;
    const result = await client.rpc('ecotrack_my_profile');
    const profile = result?.data;
    if (result?.error || !profile?.id || profile.userType !== 'admin' || profile.authUserId !== session.user.id || profile.is_active === false || profile.isArchived === true) return null;
    return { session, profile };
  }

  function confirmedReceipt(data) {
    if (data?.success === false || typeof data?.adminId !== 'string' || !/^admin_[A-Za-z0-9_-]+$/.test(data.adminId)
      || typeof data?.authUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.authUserId)) {
      throw registrationError('Account creation could not be confirmed. Check the account before trying again.', 'UNCONFIRMED');
    }
    return { adminId: data.adminId, authUserId: data.authUserId };
  }

  async function serviceError(error, data) {
    let body = data;
    const response = error?.context;
    if (!body?.error && response && typeof response.json === 'function') {
      try { body = await (response.clone ? response.clone() : response).json(); } catch (_) {}
    }
    const status = response?.status || error?.status;
    if (status === 401 || status === 403) return 'Administrator registration is unavailable. Update the provision-admin server function and try again.';
    if (status === 404) return 'Administrator registration is unavailable. The provision-admin server function needs deployment.';
    if (status === 429) return 'Too many registration attempts. Wait before trying again.';
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim().slice(0, 400);
    if (status === 409) return 'The name or email is already in use, or the account could not be provisioned. Check the existing account.';
    return 'Administrator registration could not be confirmed. Check your connection and the account before retrying.';
  }

  async function provisionAdministrator(client, input) {
    const profile = normalizeProfile(input);
    if (typeof client?.functions?.invoke !== 'function') throw registrationError('Administrator registration is unavailable. Reload and try again.', 'UNAVAILABLE');
    const { data, error } = await client.functions.invoke('provision-admin', { body: { profile }, timeout: 20000 });
    if (error || data?.error || data?.success === false) throw registrationError(await serviceError(error, data), 'PROVISIONING_FAILED');
    return confirmedReceipt(data);
  }

  async function registerAdministrator(client, input, options = {}) {
    const profile = normalizeProfile(input);
    if (typeof options.invoke === 'function') {
      const result = await options.invoke('auth-register-admin', profile);
      if (!result?.success) throw registrationError(result?.error || 'Administrator registration could not be confirmed.', result?.code || 'PROVISIONING_FAILED');
      return confirmedReceipt(result);
    }
    return provisionAdministrator(client, profile);
  }

  const api = { normalizeProfile, verifiedAdministrator, confirmedReceipt, provisionAdministrator, registerAdministrator };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EcoTrackAdminRegistration = api;
})(typeof globalThis === 'object' ? globalThis : this);
