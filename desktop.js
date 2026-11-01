'use strict';

/*
 * Desktop adapter for the original AI Video Agent prototype.
 * The original editor, canvas renderer, tool implementations and embedded
 * SKILL_FILES / SKILL_ORDER remain in index.html unchanged.
 */
(function () {
  const view = document.documentElement.dataset.view || 'studio';
  const A = window.aiva;
  if (!A) {
    console.error('Electron preload bridge not found.');
    return;
  }

  let activeProvider = null;
  let providerReady = false;
  let toolStates = {};
  let settingsData = null;
  let projectId = null;
  let projectName = 'Untitled project';
  let saveTimer = null;
  let loadingProject = false;
  let ffmpegAvailable = false;
  let muted = false;

  const $id = id => document.getElementById(id);
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  function status(message) {
    const el = $id('status');
    if (el) el.textContent = message || '';
  }
  function agentStatus(message) {
    if (typeof window.agentStatus === 'function') window.agentStatus(message);
    else if ($id('agentStatus')) $id('agentStatus').textContent = message || '';
  }
  function settingsStatus(message, ok) {
    const el = $id('settingsStatus');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = ok === false ? '#B42318' : '#28724F';
  }
  function ensureSvgButton(id, title, pathData) {
    const button = document.createElement('button');
    button.id = id;
    button.className = 'iconBtn';
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.dataset.tip = title;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + pathData + '</svg>';
    return button;
  }
  function injectStudioChrome() {
    const header = document.querySelector('.app > header');
    if (!header || $id('btnProjects')) return;
    const projectButton = ensureSvgButton('btnProjects', 'Projects',
      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"/>');
    const settingsButton = ensureSvgButton('btnSettings', 'Settings',
      '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2 2.1-2.1 2.1-2.1-1.2-.1-.1a8 8 0 0 1-2 .8l-.1.1-.3 2.4h-3l-.3-2.4-.1-.1a8 8 0 0 1-2-.8l-.1.1-2.1 1.2-2.1-2.1 1.2-2.1.1-.1a8 8 0 0 1-.8-2l-.1-.1L2 12.6v-3l2.4-.3.1-.1a8 8 0 0 1 .8-2L4 5l2.1-2.1 2.1 1.2.1.1a8 8 0 0 1 2-.8l.1-.1.3-2.4h3l.3 2.4.1.1a8 8 0 0 1 2 .8l2.1-1.2L20.4 5l-1.2 2.1-.1.1a8 8 0 0 1 .8 2l2.4.3v3l-2.4.3-.1.1a8 8 0 0 1-.8 2Z"/>');
    const newButton = ensureSvgButton('btnNewProject', 'New project',
      '<path d="M12 5v14M5 12h14"/>');
    const first = $id('formatSel');
    header.insertBefore(projectButton, first);
    header.insertBefore(settingsButton, first);
    header.insertBefore(newButton, first);
    projectButton.onclick = openProjectGallery;
    settingsButton.onclick = () => A.app.openSettings();
    newButton.onclick = () => createNewProject();
    if ($id('btnLoad')) $id('btnLoad').onclick = openProjectGallery;
    if ($id('btnSave')) $id('btnSave').onclick = saveProject;
    if ($id('btnReset')) $id('btnReset').style.display = 'none';
  }

  function applyAppearance(value) {
    if (!value) return;
    const root = document.documentElement;
    root.dataset.theme = value.mode === 'dark' ? 'dark' : 'light';
    root.dataset.motion = value.reduceMotion ? 'reduced' : 'normal';
    root.dataset.density = value.density === 'compact' ? 'compact' : 'comfortable';
    root.style.setProperty('--accent', value.accent || '#111111');
    root.style.fontSize = ({100:'14px',110:'15.4px',125:'17.5px'})[value.fontScale] || '14px';
  }

  function currentProjectData() {
    if (!projectId || loadingProject || !window.SPEC) return null;
    try {
      SPEC.fonts = Object.keys(CUSTOM_FONTS).length ? CUSTOM_FONTS : undefined;
      const currentFormat = FORMATS[SPEC.format] || [stage.width, stage.height];
      return {
        id: projectId,
        name: projectName || SPEC.title || 'Untitled project',
        format: { width: currentFormat[0], height: currentFormat[1], fps: Number(SPEC.fps) || 30 },
        duration: Number(DUR) || 15,
        playhead: Number(time) || 0,
        background: (SPEC.scenes[0] && SPEC.scenes[0].bg) || '#111111',
        spec: SPEC,
        items: EDIT.items,
        edit: { items: EDIT.items, scenes: EDIT.scenes, base: EDIT.base },
        music: MUSIC,
        sfx: SFX,
        chat: CHAT.slice(-300),
        showBeats: !!SPEC.showBeats,
        playbackSpeed: Number($id('playbackSpeed') && $id('playbackSpeed').value || 1)
      };
    } catch (error) {
      console.error('Could not prepare project data', error);
      return null;
    }
  }

  async function persistNow() {
    if (!projectId || loadingProject || window.__EXPORTING) return;
    const payload = currentProjectData();
    if (!payload) return;
    try {
      await A.project.save(payload);
      status('Saved · ' + projectName);
    } catch (error) {
      status('Save failed · ' + (error.message || error));
    }
  }
  function scheduleSave() {
    if (!projectId || loadingProject || window.__EXPORTING) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 1200);
  }

  function installAutosaveHooks() {
    if (window.__AIVA_DESKTOP_AUTOSAVE__) return;
    window.__AIVA_DESKTOP_AUTOSAVE__ = true;
    const originalSyncSpec = window.syncSpec;
    if (typeof originalSyncSpec === 'function') {
      window.syncSpec = function () {
        const result = originalSyncSpec.apply(this, arguments);
        scheduleSave();
        return result;
      };
    }
    const originalPushHistory = window.pushHistory;
    if (typeof originalPushHistory === 'function') {
      window.pushHistory = function () {
        const result = originalPushHistory.apply(this, arguments);
        scheduleSave();
        return result;
      };
    }
    window.addEventListener('blur', persistNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistNow();
    });
  }

  function applyProjectData(data) {
    if (!data || !data.spec) throw new Error('This file is not a valid AI Video Agent project.');
    loadingProject = true;
    try {
      SPEC = data.spec;
      EDIT.items = (data.edit && data.edit.items) || data.items || {};
      EDIT.scenes = (data.edit && data.edit.scenes) || data.scenes || {};
      EDIT.base = (data.edit && data.edit.base) || data.base || {};
      if (data.music) Object.assign(MUSIC, data.music);
      if (data.sfx) {
        SFX.length = 0;
        data.sfx.forEach(item => SFX.push(Object.assign({}, item)));
        if (typeof renderSfxList === 'function') renderSfxList();
      }
      if (SPEC.music) {
        Object.assign(MUSIC, SPEC.music);
        if (MUSIC.dataUrl && audioEl.src !== MUSIC.dataUrl) {
          audioEl.src = MUSIC.dataUrl;
          hookMusicAudio();
        }
        applyMusic(true);
      }
      if (SPEC.fonts) Object.keys(SPEC.fonts).forEach(name => registerFont(name, SPEC.fonts[name]));
      SELECTED = null;
      buildScenes();
      syncSpec();
      setTime(Math.max(0, Math.min(DUR, Number(data.playhead) || 0)));
      renderScenes();
      refresh();
      renderPanel();
      renderItems();
      if ($id('playbackSpeed')) $id('playbackSpeed').value = String(data.playbackSpeed || 1);
      if (Array.isArray(data.chat)) {
        CHAT.length = 0;
        data.chat.slice(-300).forEach(message => CHAT.push(message));
      }
    } finally {
      loadingProject = false;
    }
    status('Project loaded · ' + (data.name || 'Untitled project'));
  }

  async function createNewProject(name) {
    const title = String(name || 'Untitled project').trim() || 'Untitled project';
    try {
      const created = await A.project.create(title);
      projectId = created.id;
      projectName = created.name;
      SPEC = JSON.parse(JSON.stringify(DEFAULT_SPEC));
      EDIT.items = {};
      EDIT.scenes = {};
      EDIT.base = {};
      SELECTED = null;
      CHAT.length = 0;
      if (typeof TODOS !== 'undefined') TODOS = [];
      Object.keys(CROP_IMGS).forEach(key => delete CROP_IMGS[key]);
      setMusic({ clear: true, enabled: false });
      SFX.length = 0;
      if (typeof renderSfxList === 'function') renderSfxList();
      buildScenes();
      syncSpec();
      setTime(0);
      if ($id('prompt')) $id('prompt').value = '';
      if ($id('chat')) $id('chat').innerHTML = '';
      if ($id('homeScreen')) $id('homeScreen').classList.remove('open');
      sysNote('New empty project. Describe the video you want the agent to create.');
      status('New project · ' + projectName);
      await persistNow();
      return created;
    } catch (error) {
      status('Could not create project · ' + error.message);
      throw error;
    }
  }

  async function openProject(id) {
    try {
      const data = await A.project.load(id);
      applyProjectData(data);
      projectId = data.id;
      projectName = data.name || data.spec.title || 'Untitled project';
      if ($id('homeScreen')) $id('homeScreen').classList.remove('open');
      status('Opened · ' + projectName);
      if ($id('fileVideo') && data.spec && data.spec.media) {
        agentStatus('Project opened. Re-upload source video if the media is not embedded.');
      }
    } catch (error) {
      status('Open failed · ' + error.message);
    }
  }

  function installProjectGallery() {
    if ($id('homeScreen')) return;
    const el = document.createElement('section');
    el.id = 'homeScreen';
    el.className = 'home-screen';
    el.innerHTML = '<div class="home-head"><div><h1>Projects</h1><p>Your projects stay on this Windows device.</p></div><span class="spacer"></span><button id="homeNewProject" class="primary">+ New project</button><button id="homeClose">Close</button></div><div id="projectGrid" class="home-grid"></div>';
    document.body.appendChild(el);
    $id('homeNewProject').onclick = () => createNewProject();
    $id('homeClose').onclick = () => el.classList.remove('open');
  }

  async function openProjectGallery() {
    installProjectGallery();
    const home = $id('homeScreen');
    const grid = $id('projectGrid');
    home.classList.add('open');
    grid.innerHTML = '<div class="home-empty">Loading projects…</div>';
    try {
      const projects = await A.project.list();
      grid.innerHTML = '';
      if (!projects.length) {
        grid.innerHTML = '<div class="home-empty">No saved projects yet. Create a new project to start.</div>';
        return;
      }
      projects.forEach(project => {
        const card = document.createElement('button');
        card.className = 'project-card';
        const thumb = document.createElement('div');
        thumb.className = 'project-thumb';
        thumb.textContent = '▶';
        const name = document.createElement('strong');
        name.textContent = project.name;
        const date = document.createElement('small');
        date.textContent = project.updatedAt ? new Date(project.updatedAt).toLocaleString() : 'Saved project';
        card.appendChild(thumb);
        card.appendChild(name);
        card.appendChild(date);
        card.onclick = () => openProject(project.id);
        grid.appendChild(card);
      });
    } catch (error) {
      grid.innerHTML = '<div class="home-empty">Could not load projects · ' + escapeHtml(error.message) + '</div>';
    }
  }

  async function saveProject() {
    if (!projectId) {
      await createNewProject((SPEC && SPEC.title) || 'Untitled project');
    } else {
      await persistNow();
    }
  }

  async function loadProviderConfig() {
    const data = await A.providers.list();
    const providers = data.providers || [];
    activeProvider = providers.find(item => item.id === data.active) || providers[0] || null;
    providerReady = !!(activeProvider && activeProvider.keyConfigured);
    if ($id('model') && activeProvider) {
      const models = (activeProvider.enabled_models && activeProvider.enabled_models.length)
        ? activeProvider.enabled_models : (activeProvider.models || []);
      const previous = $id('model').value;
      $id('model').innerHTML = '';
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        $id('model').appendChild(option);
      });
      if (models.indexOf(previous) >= 0) $id('model').value = previous;
      else if (models.length) $id('model').value = models[0];
      if ($id('baseUrl')) $id('baseUrl').value = activeProvider.base_url;
    }
    // Never put the key into the DOM, localStorage, or chat history.
    if ($id('apiKey')) $id('apiKey').value = '';
    if (typeof SECRETS !== 'undefined') {
      SECRETS.get = () => providerReady ? 'secure-provider-configured' : '';
      SECRETS.stored = () => '';
      SECRETS.fromHost = () => '';
      SECRETS.fromUrl = () => '';
      SECRETS.set = () => A.app.openSettings();
      SECRETS.clear = () => A.app.openSettings();
    }
    window.apiKey = () => providerReady ? 'secure-provider-configured' : '';
    window.apiBase = () => activeProvider ? activeProvider.base_url.replace(/\/+$/, '') : 'https://api.deepseek.com';
    if (!providerReady) agentStatus('Add an API key in Settings → Providers.');
    else agentStatus('Connected · ' + activeProvider.name);
    return activeProvider;
  }

  async function secureStreamChat(messages, tools, onState, signal, toolChoice) {
    if (!providerReady) throw new Error('No API key is configured. Open Settings → Providers.');
    if (signal && signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    const requestId = 'aiva-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
    const body = {
      providerId: activeProvider && activeProvider.id,
      model: (window.MODEL_OVERRIDE && $id('modelRoute') && $id('modelRoute').checked)
        ? window.MODEL_OVERRIDE : ($id('model') ? $id('model').value : ''),
      messages: messages,
      tools: tools && tools.length ? tools : undefined,
      tool_choice: toolChoice || 'auto',
      temperature: 0.6,
      max_tokens: 2400
    };
    const thinking = window.THINK_OVERRIDE || ($id('thinking') && $id('thinking').value);
    if (thinking === 'on') body.thinking = { type: 'enabled' };
    if (thinking === 'off') body.thinking = { type: 'disabled' };
    const cancel = () => { A.ai.cancel(requestId).catch(() => {}); };
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await A.ai.chat(Object.assign({ requestId }, body));
      if (signal && signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
      const answer = {
        content: result.content || '',
        reasoning: result.reasoning_content || result.reasoning || '',
        toolCalls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
        usage: result.usage || null
      };
      onState(answer);
      return answer;
    } catch (error) {
      if (signal && signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
      throw error;
    } finally {
      if (signal) signal.removeEventListener('abort', cancel);
    }
  }

  function installSecureAgent() {
    window.streamChat = secureStreamChat;
    // Old browser-held credentials are deliberately discarded.
    try {
      localStorage.removeItem('aiva_key');
      localStorage.removeItem('aiva_key_remember');
    } catch (error) {}
    if ($id('apiKey')) {
      $id('apiKey').value = '';
      $id('apiKey').disabled = true;
      $id('apiKey').placeholder = 'API key is stored securely in Settings';
    }
    if ($id('rememberKey')) {
      $id('rememberKey').checked = false;
      $id('rememberKey').disabled = true;
    }
    if ($id('btnSaveKey')) $id('btnSaveKey').onclick = () => A.app.openSettings();
    if ($id('btnForgetKey')) $id('btnForgetKey').onclick = () => A.app.openSettings();
    if ($id('btnModels')) {
      $id('btnModels').onclick = async () => {
        if (!activeProvider) return A.app.openSettings();
        try {
          const result = await A.providers.test({
            id: activeProvider.id, name: activeProvider.name,
            base_url: activeProvider.base_url, headers: activeProvider.headers
          });
          await loadProviderConfig();
          agentStatus('Loaded ' + result.models.length + ' models.');
        } catch (error) { agentStatus('Could not refresh models · ' + error.message); }
      };
    }
  }

  function toolState(name) {
    if (toolStates[name]) return toolStates[name];
    if (['get_project','replace_spec','verify_video'].indexOf(name) >= 0) return 'on';
    return 'lazy';
  }
  function installToolPolicy() {
    if (window.__AIVA_TOOL_POLICY__) return;
    window.__AIVA_TOOL_POLICY__ = true;
    const baseIsActive = window.isActiveTool;
    window.isActiveTool = function (name) {
      const state = toolState(name);
      if (state === 'off') return false;
      if (state === 'on') return true;
      return baseIsActive ? baseIsActive(name) : false;
    };
    const baseSchema = window.toolSchema;
    window.toolSchema = function () {
      return (baseSchema ? baseSchema.apply(this, arguments) : []).filter(item => {
        const name = item && item.function && item.function.name;
        return name && toolState(name) !== 'off';
      });
    };
    const basePrompt = window.systemPrompt;
    window.systemPrompt = function () {
      let result = basePrompt ? basePrompt.apply(this, arguments) : '';
      const disabled = Object.keys(TOOL_IMPL).filter(name => toolState(name) === 'off');
      if (disabled.length) {
        result = result.split('\n').filter(line => !disabled.some(name =>
          line.trim().startsWith(name + '(') || line.indexOf(' ' + name + '(') >= 0
        )).join('\n');
      }
      return result + '\n[tools] ' + Object.keys(TOOL_IMPL).filter(name => toolState(name) === 'on').length +
        ' always-on; lazy tools must be discovered via find_tools; off tools cannot be called.';
    };
    Object.keys(TOOL_IMPL).forEach(name => {
      const original = TOOL_IMPL[name];
      if (typeof original !== 'function' || original.__aivaGuarded) return;
      const guarded = function (args) {
        const state = toolState(name);
        if (state === 'off') return name + ' is switched off in Settings → Tools. Enable it to use it.';
        if (state === 'lazy' && !(ACTIVE_TOOLS && ACTIVE_TOOLS[name])) {
          return name + ' is lazy. Use find_tools to unlock it for this session.';
        }
        return original.apply(this, arguments);
      };
      guarded.__aivaGuarded = true;
      TOOL_IMPL[name] = guarded;
    });
  }

  function installPlayerControls() {
    const bar = document.querySelector('.transport');
    if (!bar || $id('btnMute')) return;
    const mute = document.createElement('button');
    mute.id = 'btnMute'; mute.className = 'tiny'; mute.title = 'Mute / unmute'; mute.textContent = 'Volume';
    const volume = document.createElement('input');
    volume.id = 'masterVolume'; volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '.01'; volume.value = '1';
    volume.title = 'Master volume'; volume.style.width = '74px';
    const speed = document.createElement('select');
    speed.id = 'playbackSpeed'; speed.title = 'Playback speed'; speed.style.width = '62px';
    ['0.25','0.5','0.75','1','1.25','1.5','2'].forEach(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value + '×';
      if (value === '1') option.selected = true;
      speed.appendChild(option);
    });
    const present = document.createElement('button');
    present.id = 'btnPresent'; present.className = 'tiny'; present.title = 'Fullscreen presentation'; present.textContent = '⛶';
    bar.appendChild(mute); bar.appendChild(volume); bar.appendChild(speed); bar.appendChild(present);
    mute.onclick = () => {
      muted = !muted;
      const v = Number(volume.value);
      if (audioEl) audioEl.volume = muted ? 0 : v;
      if (MEDIA && MEDIA.video) MEDIA.video.volume = muted ? 0 : v;
      if (typeof sfxBus !== 'undefined' && sfxBus && sfxBus.gain) sfxBus.gain.value = muted ? 0 : v;
      mute.textContent = muted ? 'Unmute' : 'Volume';
    };
    volume.oninput = () => {
      const v = Number(volume.value) * (muted ? 0 : 1);
      if (audioEl) audioEl.volume = v;
      if (MEDIA && MEDIA.video) MEDIA.video.volume = v;
      if (typeof sfxBus !== 'undefined' && sfxBus && sfxBus.gain) sfxBus.gain.value = v;
    };
    speed.onchange = () => {
      const rate = Number(speed.value) || 1;
      if (audioEl) audioEl.playbackRate = rate;
      if (MEDIA && MEDIA.video) MEDIA.video.playbackRate = rate;
      scheduleSave();
    };
    present.onclick = async () => {
      try {
        const target = $id('stageInner');
        if (!document.fullscreenElement) await target.requestFullscreen();
        else await document.exitFullscreen();
      } catch (error) { agentStatus('Fullscreen unavailable · ' + error.message); }
    };
  }

  function installPosterExport() {
    window.exportPoster = async function () {
      try {
        pause();
        const dataUrl = stage.toDataURL('image/png');
        if (dataUrl.length < 1000) throw new Error('The canvas returned an empty image.');
        const result = await A.export.image(dataUrl, 'AI-Video-Agent-Poster.png');
        if (!result.canceled) status('Saved · ' + result.path + ' · ' + Math.round(result.bytes / 1024) + ' KB');
      } catch (error) { status('Poster export failed · ' + error.message); }
    };
    if ($id('btnPoster')) $id('btnPoster').onclick = window.exportPoster;
  }

  function createSettingsMarkup() {
    if ($id('settingsShell')) return;
    const shell = document.createElement('div');
    shell.id = 'settingsShell';
    shell.className = 'settings-shell';
    shell.innerHTML = '<nav class="settings-rail">' +
      '<div class="settings-brand">AI Video Agent<small>Desktop settings</small></div>' +
      '<button class="settings-nav active" data-settings-tab="appearance">Appearance</button>' +
      '<button class="settings-nav" data-settings-tab="providers">Providers</button>' +
      '<button class="settings-nav" data-settings-tab="tools">Tools</button>' +
      '<button class="settings-nav" data-settings-tab="integrations">Integrations</button>' +
      '<button class="settings-nav" data-settings-tab="music">Music &amp; SFX</button>' +
      '<button class="settings-nav" data-settings-tab="advanced">Advanced</button>' +
      '<button class="settings-nav" data-settings-tab="about">About</button></nav>' +
      '<section class="settings-main"><header class="settings-top"><h1 id="settingsTitle">Appearance</h1><span id="settingsStatus" class="settings-status"></span></header>' +
      '<div class="settings-content" id="settingsContent"></div></section>';
    document.body.appendChild(shell);
  }

  function settingCard(title, description, rows) {
    return '<section class="settings-card"><h2>' + title + '</h2>' +
      (description ? '<p>' + description + '</p>' : '') + rows + '</section>';
  }
  function settingRow(title, hint, control) {
    return '<div class="setting-row"><div><label>' + title + '</label>' +
      (hint ? '<small>' + hint + '</small>' : '') + '</div>' + control + '</div>';
  }
  function setSettingsTab(tab) {
    window.__AIVA_SETTINGS_TAB__ = tab;
    document.querySelectorAll('[data-settings-tab]').forEach(button =>
      button.classList.toggle('active', button.dataset.settingsTab === tab));
    const labels = {
      appearance:'Appearance',providers:'AI Providers',tools:'Agent Tools',
      integrations:'Integrations',music:'Music & SFX',advanced:'Advanced',about:'About'
    };
    $id('settingsTitle').textContent = labels[tab] || 'Settings';
    settingsStatus('');
    if (tab === 'appearance') renderAppearance();
    else if (tab === 'providers') renderProviders();
    else if (tab === 'tools') renderTools();
    else if (tab === 'integrations') renderIntegrations();
    else if (tab === 'music') renderMusicSettings();
    else if (tab === 'advanced') renderAdvanced();
    else renderAbout();
  }

  function renderAppearance() {
    const value = settingsData.appearance || {};
    const rows =
      settingRow('Theme','Light, dark or follow the Windows setting.',
        '<select id="settingTheme"><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option><option value="custom">Custom</option></select>') +
      settingRow('Accent colour','Selection and focus colour.',
        '<input id="settingAccent" type="color" value="' + escapeHtml(value.accent || '#111111') + '">') +
      settingRow('Font size','Scale the editor interface.',
        '<select id="settingFont"><option value="100">100%</option><option value="110">110%</option><option value="125">125%</option></select>') +
      settingRow('Density','Choose control spacing.',
        '<select id="settingDensity"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>') +
      settingRow('Reduce motion','Reduce transitions and animation.',
        '<input id="settingMotion" type="checkbox">');
    const material =
      settingRow('Window material','Windows 11 22H2+ only. The app recreates the window when changed.',
        '<select id="settingMaterial"><option value="acrylic">Acrylic</option><option value="mica">Mica</option><option value="tabbed">Tabbed</option><option value="auto">Auto</option><option value="none">None</option></select>');
    $id('settingsContent').innerHTML =
      settingCard('Theme','Changes are saved automatically.',rows) +
      settingCard('Windows material','Windows 10 and unsupported Windows builds use an opaque surface.',material +
        '<p class="settings-note">For the acrylic backdrop to paint correctly, Windows Energy Saver should be off.</p>');
    $id('settingTheme').value = value.mode || 'light';
    $id('settingFont').value = String(value.fontScale || 100);
    $id('settingDensity').value = value.density || 'comfortable';
    $id('settingMotion').checked = !!value.reduceMotion;
    $id('settingMaterial').value = value.windowMaterial || 'mica';
    const save = async () => {
      const next = {
        mode:$id('settingTheme').value,accent:$id('settingAccent').value,
        fontScale:Number($id('settingFont').value),density:$id('settingDensity').value,
        reduceMotion:$id('settingMotion').checked,windowMaterial:$id('settingMaterial').value
      };
      try {
        settingsData.appearance = await A.settings.saveAppearance(next);
        applyAppearance(settingsData.appearance);
        settingsStatus('Saved',true);
      } catch (error) { settingsStatus(error.message,false); }
    };
    ['settingTheme','settingAccent','settingFont','settingDensity','settingMotion','settingMaterial'].forEach(id =>
      $id(id).addEventListener('change',save));
  }

  function renderProviders() {
    const data = settingsData.providers || { active:null,providers:[] };
    const providers = data.providers || [];
    let selected = providers.find(item => item.id === data.active) || providers[0] || null;
    let editor;
    const listHtml = providers.map(item =>
      '<button class="provider-item' + (item.id === data.active ? ' active':'') + '" data-provider-id="' + escapeHtml(item.id) + '">' +
      '<strong>' + escapeHtml(item.name) + (item.id === data.active ? ' · Active':'') + '</strong>' +
      '<small>' + escapeHtml(item.base_url) + '</small>' +
      '<small>' + (item.keyConfigured ? 'Key saved securely' : 'No API key') + ' · ' + (item.models || []).length + ' models</small></button>'
    ).join('');
    $id('settingsContent').innerHTML = settingCard('OpenAI-compatible providers',
      'API keys are encrypted by Windows DPAPI in the Electron main process. The key is never sent to the renderer.',
      '<div class="provider-layout"><div><div class="provider-list" id="providerList">' + listHtml + '</div><button id="providerAdd" style="width:100%;margin-top:8px">+ Add provider</button></div><div id="providerEditor" class="provider-editor"></div></div>');
    function drawEditor(provider) {
      selected = provider;
      const p = provider || { id:'',name:'',base_url:'https://api.deepseek.com',models:[],enabled_models:[],headers:{},keyConfigured:false };
      const models = p.models || [];
      const modelHtml = models.map(model =>
        '<label class="model-line"><input type="checkbox" data-model="' + escapeHtml(model) + '"' +
        ((p.enabled_models || []).indexOf(model) >= 0 ? ' checked':'') + '>' + escapeHtml(model) + '</label>'
      ).join('');
      $id('providerEditor').innerHTML =
        '<label class="field">Provider name<input id="providerName" value="' + escapeHtml(p.name) + '" placeholder="DeepSeek"></label>' +
        '<label class="field">Base URL<input id="providerUrl" value="' + escapeHtml(p.base_url) + '" placeholder="https://api.deepseek.com"></label>' +
        '<label class="field">API key<input id="providerKey" type="password" autocomplete="off" placeholder="' +
          (p.keyConfigured ? 'Saved securely · enter to replace':'Paste API key') + '"></label>' +
        '<div class="setting-actions"><button id="providerTest">Test connection &amp; fetch models</button></div>' +
        '<label class="field" style="margin-top:10px">Models · select the models available in Studio<div class="model-list" id="providerModels">' +
          (modelHtml || '<span class="settings-note">Test the connection to fetch model IDs.</span>') + '</div></label>' +
        '<label class="field">Extra HTTP headers · JSON<textarea id="providerHeaders" rows="2">' + escapeHtml(JSON.stringify(p.headers || {},null,2)) + '</textarea></label>' +
        '<div class="setting-actions"><button id="providerSave" class="primary">Save provider</button>' +
        '<button id="providerActivate">Set active</button>' + (p.id ? '<button id="providerDelete">Delete</button>':'') + '</div>';
      $id('providerTest').onclick = async () => {
        try {
          settingsStatus('Testing provider…');
          const result = await A.providers.test({
            id:p.id,name:$id('providerName').value,base_url:$id('providerUrl').value,
            api_key:$id('providerKey').value,headers:JSON.parse($id('providerHeaders').value || '{}')
          });
          p.name = $id('providerName').value;
          p.base_url = $id('providerUrl').value;
          p.models = result.models.map(model => model.id);
          p.enabled_models = p.models.slice();
          drawEditor(p);
          settingsStatus('Connected · ' + p.models.length + ' models',true);
        } catch (error) { settingsStatus(error.message,false); }
      };
      $id('providerSave').onclick = async () => {
        try {
          const checked = Array.from($id('providerModels').querySelectorAll('[data-model]:checked')).map(x => x.dataset.model);
          const all = Array.from($id('providerModels').querySelectorAll('[data-model]')).map(x => x.dataset.model);
          const payload = {
            id:p.id || undefined,name:$id('providerName').value,base_url:$id('providerUrl').value,
            models:all,enabled_models:checked,headers:JSON.parse($id('providerHeaders').value || '{}')
          };
          if ($id('providerKey').value.trim()) payload.api_key = $id('providerKey').value.trim();
          await A.providers.save(payload);
          settingsData.providers = await A.providers.list();
          selected = (settingsData.providers.providers || []).find(item => item.name === payload.name) || null;
          drawEditor(selected);
          settingsStatus('Provider saved securely',true);
        } catch (error) { settingsStatus(error.message,false); }
      };
      $id('providerActivate').onclick = async () => {
        if (!p.id) { settingsStatus('Save the provider first.',false); return; }
        try {
          await A.providers.setActive(p.id);
          settingsData.providers = await A.providers.list();
          selected = (settingsData.providers.providers || []).find(item => item.id === p.id);
          renderProviders();
          settingsStatus('Active provider updated',true);
        } catch (error) { settingsStatus(error.message,false); }
      };
      if ($id('providerDelete')) $id('providerDelete').onclick = async () => {
        if (!confirm('Delete this provider and its encrypted key?')) return;
        try {
          await A.providers.remove(p.id);
          settingsData.providers = await A.providers.list();
          renderProviders();
          settingsStatus('Provider deleted',true);
        } catch (error) { settingsStatus(error.message,false); }
      };
    }
    document.querySelectorAll('[data-provider-id]').forEach(button => {
      button.onclick = () => {
        const found = providers.find(item => item.id === button.dataset.providerId);
        drawEditor(found || null);
      };
    });
    $id('providerAdd').onclick = () => drawEditor({
      id:'',name:'',base_url:'https://api.deepseek.com',models:[],enabled_models:[],headers:{},keyConfigured:false
    });
    drawEditor(selected);
  }

  function renderTools() {
    const core = ['get_project','replace_spec','verify_video'];
    const names = Object.keys(TOOL_IMPL || {});
    const state = settingsData.tools && settingsData.tools.state || {};
    const rows = names.map(name => {
      const value = core.indexOf(name) >= 0 ? 'on' : (state[name] || 'lazy');
      const description = (TOOL_HELP[name] || '').split(/(?<=\.)\s/)[0].slice(0,100);
      return '<div class="settings-list-row"><div><strong>' + escapeHtml(name) + '</strong><small>' +
        escapeHtml(description) + '</small></div><select data-tool="' + escapeHtml(name) + '"' +
        (core.indexOf(name) >= 0 ? ' disabled':'') + '><option value="on">On</option><option value="lazy">Lazy</option><option value="off">Off</option></select></div>';
    }).join('');
    $id('settingsContent').innerHTML = settingCard('Agent tool access',
      'On tools are always available. Lazy tools are discovered using find_tools. Off tools are removed from the schema and blocked when called.',
      '<div class="setting-actions"><button id="toolsAll">All on</button><button id="toolsLazy">All lazy</button><button id="toolsNone">All off</button><button id="toolsCore">Core only</button></div>' +
      '<div class="settings-list" id="toolsList">' + rows + '</div><div class="setting-actions"><button id="toolsSave" class="primary">Save tool settings</button></div>');
    document.querySelectorAll('[data-tool]').forEach(select => select.value = state[select.dataset.tool] || (core.indexOf(select.dataset.tool) >= 0 ? 'on':'lazy'));
    $id('toolsAll').onclick = () => document.querySelectorAll('[data-tool]:not(:disabled)').forEach(x => x.value = 'on');
    $id('toolsLazy').onclick = () => document.querySelectorAll('[data-tool]:not(:disabled)').forEach(x => x.value = 'lazy');
    $id('toolsNone').onclick = () => document.querySelectorAll('[data-tool]:not(:disabled)').forEach(x => x.value = 'off');
    $id('toolsCore').onclick = () => document.querySelectorAll('[data-tool]:not(:disabled)').forEach(x => x.value = 'off');
    $id('toolsSave').onclick = async () => {
      const next = { state:Object.assign({},state),options:(settingsData.tools && settingsData.tools.options) || {} };
      document.querySelectorAll('[data-tool]').forEach(x => next.state[x.dataset.tool] = x.value);
      core.forEach(name => next.state[name] = 'on');
      try {
        settingsData.tools = await A.settings.saveTools(next);
        toolStates = settingsData.tools.state || {};
        settingsStatus('Tool access saved',true);
      } catch (error) { settingsStatus(error.message,false); }
    };
  }

  function renderIntegrations() {
    const info = settingsData.integrations || {};
    const items = [
      ['ffmpeg','FFmpeg export','Native MP4 export using the bundled binary.'],
      ['captions','Auto captions','Whisper-compatible speech transcription.'],
      ['tts','Text-to-speech','Create narration and voiceovers.'],
      ['image','Image generation','Generate optional posters and backgrounds.'],
      ['music','Music generation','Create complete music tracks.'],
      ['webSearch','Web search','Research before writing a video script.']
    ];
    const rows = items.map(item => {
      const checked = item[0] === 'ffmpeg' ? info.ffmpeg !== false : !!info[item[0]];
      const disabled = item[0] === 'ffmpeg' && !ffmpegAvailable;
      return settingRow(item[1],item[2],
        '<input type="checkbox" data-integration="' + item[0] + '"' + (checked?' checked':'') + (disabled?' disabled':'') + '>');
    }).join('');
    $id('settingsContent').innerHTML = settingCard('Optional integrations',
      'FFmpeg is bundled and can export the canvas. Caption, TTS, image, music and web-search connectors are currently marked as optional integration slots; their provider-specific handlers are not yet wired.',
      rows + '<div class="setting-actions"><button id="integrationsSave" class="primary">Save integration settings</button></div>');
    $id('integrationsSave').onclick = async () => {
      const next = {};
      document.querySelectorAll('[data-integration]').forEach(x => next[x.dataset.integration] = x.checked);
      try {
        settingsData.integrations = await A.settings.saveIntegrations(next);
        settingsStatus('Integration preferences saved',true);
      } catch (error) { settingsStatus(error.message,false); }
    };
  }

  function renderMusicSettings() {
    const music = settingsData.music || {};
    const rows =
      settingRow('Default BPM','Beat clock for generated motion.','<input id="musicBpm" type="number" min="40" max="240">') +
      settingRow('Music volume','Default master music volume.','<input id="musicVolume" type="range" min="0" max="1" step=".01">') +
      settingRow('Fade in · seconds','','<input id="musicFadeIn" type="number" min="0" max="10" step=".1">') +
      settingRow('Fade out · seconds','','<input id="musicFadeOut" type="number" min="0" max="10" step=".1">') +
      settingRow('Auto-place sound effects','Use subtle effects on scene cuts.','<input id="musicAutoSfx" type="checkbox">') +
      settingRow('Music off by default','New projects start without music.','<input id="musicOff" type="checkbox">');
    $id('settingsContent').innerHTML = settingCard('Music & sound defaults',
      'These values are defaults for new projects. You can change the music in each project.',
      rows + '<div class="setting-actions"><button id="musicSave" class="primary">Save defaults</button></div>');
    $id('musicBpm').value = music.bpm || 120;
    $id('musicVolume').value = music.volume == null ? .7 : music.volume;
    $id('musicFadeIn').value = music.fadeIn == null ? .5 : music.fadeIn;
    $id('musicFadeOut').value = music.fadeOut == null ? .5 : music.fadeOut;
    $id('musicAutoSfx').checked = music.autoSfx !== false;
    $id('musicOff').checked = music.musicOffByDefault !== false;
    $id('musicSave').onclick = async () => {
      try {
        settingsData.music = await A.settings.saveMusic({
          bpm:$id('musicBpm').value,volume:$id('musicVolume').value,
          fadeIn:$id('musicFadeIn').value,fadeOut:$id('musicFadeOut').value,
          autoSfx:$id('musicAutoSfx').checked,musicOffByDefault:$id('musicOff').checked
        });
        settingsStatus('Music defaults saved',true);
      } catch (error) { settingsStatus(error.message,false); }
    };
  }

  async function renderAdvanced() {
    const info = await A.app.info();
    $id('settingsContent').innerHTML =
      settingCard('Application data','Projects and encrypted provider credentials are stored locally.',
        settingRow('Data folder',escapeHtml(info.userData),'<button id="openDataFolder">Open folder</button>') +
        settingRow('FFmpeg',info.ffmpegAvailable ? 'Bundled binary available.' : 'Bundled binary not found.',info.ffmpegAvailable?'Ready':'Unavailable') +
        settingRow('Windows backdrop',info.materialSupported?'Windows 11 22H2+ supported.':'Opaque fallback.',info.materialSupported?'Supported':'Fallback')) +
      settingCard('Maintenance','Project gallery reads the project files directly; no external index is required.',
        '<div class="setting-actions"><button id="refreshProjectList">Refresh project gallery</button><button id="openDevTools">Developer tools</button></div>');
    $id('openDataFolder').onclick = () => A.app.revealData();
    $id('refreshProjectList').onclick = () => settingsStatus('Project files are read directly from the local data folder.',true);
    $id('openDevTools').onclick = () => settingsStatus('Developer tools can be opened with Ctrl+Shift+I.',true);
  }
  function renderAbout() {
    A.app.info().then(info => {
      $id('settingsContent').innerHTML =
        settingCard('AI Video Agent','Describe → watch → refine.',
          '<p>Windows desktop video editor · Version ' + escapeHtml(info.version) +
          ' · Electron ' + escapeHtml(info.electron) + '</p><p>Canvas-based motion design, AI agent tools, project library and standalone video export.</p>') +
        settingCard('Keyboard shortcuts','',
          '<p>Space · Play / pause</p><p>← / → · Seek 0.5 seconds</p><p>F · Fullscreen</p><p>M · Mute</p><p>Ctrl+S · Save project</p><p>Ctrl+, · Settings</p>');
    }).catch(error => settingsStatus(error.message,false));
  }

  async function initSettings() {
    createSettingsMarkup();
    try {
      const pair = await Promise.all([A.settings.get(),A.providers.list(),A.app.info()]);
      settingsData = pair[0];
      settingsData.providers = pair[1];
      settingsData.integrations = settingsData.integrations || {};
      ffmpegAvailable = !!pair[2].ffmpegAvailable;
      toolStates = (settingsData.tools && settingsData.tools.state) || {};
      applyAppearance(settingsData.appearance);
      document.querySelectorAll('[data-settings-tab]').forEach(button => {
        button.onclick = () => setSettingsTab(button.dataset.settingsTab);
      });
      setSettingsTab('appearance');
    } catch (error) { settingsStatus(error.message,false); }
  }

  async function initStudio() {
    installAutosaveHooks();
    installStudioChrome();
    installProjectGallery();
    installSecureAgent();
    installToolPolicy();
    installPlayerControls();
    installPosterExport();
    try {
      const pair = await Promise.all([A.app.info(),A.settings.get()]);
      ffmpegAvailable = !!pair[0].ffmpegAvailable;
      toolStates = pair[1].tools && pair[1].tools.state || {};
      applyAppearance(pair[1].appearance);
      await loadProviderConfig();
      if ($id('btnExport')) $id('btnExport').title = ffmpegAvailable ? 'Export MP4 · FFmpeg' : 'Export video';
      if ($id('btnSave')) $id('btnSave').title = 'Save project';
      if ($id('btnClearChat')) {
        $id('btnClearChat').addEventListener('click',scheduleSave);
      }
      status('Ready · New project opens empty.');
      // New installations deliberately open an empty stage, not a demo scene.
      if ($id('chat') && !$id('chat').children.length) {
        agentStatus(providerReady ? 'Describe the video you want to create.' : 'Add a provider key in Settings to start.');
      }
    } catch (error) { agentStatus('Desktop startup failed · ' + error.message); }
  }

  // Native menu actions are forwarded through a narrow allow-listed preload bridge.
  A.onMenu('menu:new-project', () => createNewProject());
  A.onMenu('menu:home', openProjectGallery);
  A.onMenu('menu:theme', async mode => {
    const current = settingsData && settingsData.appearance || {};
    current.mode = mode;
    applyAppearance(current);
    try { await A.settings.saveAppearance(current); } catch (error) { status(error.message); }
  });
  A.onThemeChanged(applyAppearance);

  window.addEventListener('keydown', event => {
    if (window.__EXPORTING) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); persistNow();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      if (view !== 'settings') A.app.openSettings();
    }
  });

  // Export the original data format only through Electron's native save dialog.
  window.exportPoster = null;

  if (view === 'settings') initSettings();
  else {
    injectStudioChrome();
    installProjectGallery();
    initStudio();
  }
})();
