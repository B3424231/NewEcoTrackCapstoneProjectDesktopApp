'use strict';

// Local profile fixtures only; no accounts, database, network, or real timers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.env.ECOTRACK_PROFILE_ROOT || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'public/js/profile.js'), 'utf8');
const photoA = 'data:image/png;base64,fixture-admin-a';
const photoB = 'data:image/png;base64,fixture-admin-b';
const account = id => ({ id, name: id, userType: 'admin', email: id + '@example.invalid' });

function harness(profile = account('admin-b'), initial = {}) {
  const values = new Map(Object.entries({ ecoTrack_profile_user: JSON.stringify(profile || {}), ...initial }));
  const readyHandlers = [], readers = [], messages = [];
  function element(hidden = false) {
    const classes = new Set(hidden ? ['hidden'] : []), handlers = new Map();
    return {
      src: '', files: [], textContent: '',
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      removeAttribute(name) { if (name === 'src') this.src = ''; },
      addEventListener: (name, handler) => handlers.set(name, handler),
      emit: name => handlers.get(name)?.(),
      click() {}
    };
  }
  const image = element(true), icon = element(), input = element(), container = element();
  const elements = { profileAvatarImg: image, profileAvatarSvg: icon, avatarFileInput: input, avatarContainer: container };
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  let remote = profile;
  const context = vm.createContext({
    document: {
      getElementById: id => elements[id] || null,
      querySelectorAll: () => [],
      addEventListener: (name, handler) => { if (name === 'DOMContentLoaded') readyHandlers.push(handler); }
    },
    localStorage, location: { hash: '', pathname: '/profile.html', search: '' },
    console, setInterval() {}, addEventListener() {},
    getSessionTimeoutSetting: () => '30 minutes',
    EcoToast: { success: message => messages.push(message), error: message => messages.push(message) },
    supabaseClient: {
      rpc: async name => ({ data: name === 'ecotrack_my_profile' ? remote : true, error: null }),
      auth: { getUser: async () => ({ data: { user: null } }) }
    },
    FileReader: class { readAsDataURL(file) { readers.push(() => this.onload({ target: { result: file.data } })); } }
  });
  context.window = context;
  vm.runInContext(source, context);
  return {
    context, values, image, icon, messages,
    ready: readyHandlers[0](),
    user: () => vm.runInContext('currentUser', context),
    refresh: () => context.loadProfileWithSWR(true),
    async switchAccount(next) {
      remote = next;
      localStorage.setItem('ecoTrack_profile_user', JSON.stringify(next || {}));
      await context.loadProfileWithSWR(true);
    },
    upload(data, finish = true) {
      input.files = data ? [{ data }] : [];
      input.emit('change');
      if (finish) readers.shift()?.();
    },
    finishRead: () => readers.shift()?.()
  };
}

test('a new administrator never inherits the unowned legacy photo', async () => {
  const app = harness(account('admin-b'), { ecoTrack_avatar: photoA });
  await app.ready;
  assert.equal(app.user().avatar, '');
  assert.equal(app.image.classList.contains('hidden'), true);
  assert.equal(app.icon.classList.contains('hidden'), false);
  assert.equal(app.values.get('ecoTrack_avatar'), photoA, 'Do not delete an unowned legacy image');
});

test('each administrator loads only their own saved photo', async () => {
  const app = harness(account('admin-a'), { 'ecoTrack_avatar:admin-a': photoA, 'ecoTrack_avatar:admin-b': photoB });
  await app.ready;
  assert.equal(app.image.src, photoA);
  await app.switchAccount(account('admin-b'));
  assert.equal(app.image.src, photoB);
  assert.equal(app.user().avatar, photoB);
});

test('switching to an account without a photo clears the displayed image', async () => {
  const app = harness(account('admin-a'), { ecoTrack_avatar: photoA, 'ecoTrack_avatar:admin-a': photoA });
  await app.ready;
  assert.equal(app.image.classList.contains('hidden'), false);
  await app.switchAccount(account('admin-b'));
  assert.equal(app.image.classList.contains('hidden'), true);
  assert.equal(app.image.src, '');
  assert.equal(app.icon.classList.contains('hidden'), false);
});

test('upload updates the UI, survives refresh and reload, and keeps other photos intact', async () => {
  const app = harness(account('admin-b'), { 'ecoTrack_avatar:admin-a': photoA });
  await app.ready;
  app.upload(photoB);
  assert.equal(app.image.src, photoB);
  assert.equal(app.image.classList.contains('hidden'), false);
  assert.equal(app.icon.classList.contains('hidden'), true);
  assert.equal(app.user().avatar, photoB);
  assert.equal(app.values.get('ecoTrack_avatar:admin-b'), photoB);
  assert.equal(app.values.get('ecoTrack_avatar:admin-a'), photoA);
  assert.equal(app.values.has('ecoTrack_avatar'), false);
  await app.refresh();
  assert.equal(app.image.src, photoB);
  const reload = harness(account('admin-b'), Object.fromEntries(app.values));
  await reload.ready;
  assert.equal(reload.image.src, photoB);
  assert(app.messages.includes('Profile picture updated successfully!'));
});

test('a delayed file read cannot assign a photo to the next account', async () => {
  const app = harness(account('admin-a'));
  await app.ready;
  app.upload(photoA, false);
  await app.switchAccount(account('admin-b'));
  app.finishRead();
  assert.equal(app.user().avatar, '');
  assert.equal(app.values.has('ecoTrack_avatar:admin-b'), false);
  assert.equal(app.image.classList.contains('hidden'), true);
});

test('upload requires an actual account and cancelling the picker changes nothing', async () => {
  const app = harness(null, { ecoTrack_avatar: photoA });
  await app.ready;
  const before = Object.fromEntries(app.values);
  app.upload(null);
  assert.deepEqual(Object.fromEntries(app.values), before);
  app.upload(photoB);
  assert.deepEqual(Object.fromEntries(app.values), before);
  assert.equal(app.image.classList.contains('hidden'), true);
});
