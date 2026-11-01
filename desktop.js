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
  let projectComments = [];
  let projectTemplate = 'blank';
  let commentMode = false;
  let brandImage = null;
  let brandImageSource = '';
  const MOTION_PRESETS = [
    {id:'kinetic-title',name:'Kinetic title',description:'Staggered typography with a clean settle.'},
    {id:'orbital-rings',name:'Orbital rings',description:'Layered circular motion with depth.'},
    {id:'particle-field',name:'Particle field',description:'Procedural particle drift and connection lines.'},
    {id:'waveform',name:'Waveform',description:'Animated frequency-like lines.'},
    {id:'product-spotlight',name:'Product spotlight',description:'Radial highlight and rotating orbit.'},
    {id:'data-bars',name:'Data bars',description:'Animated bar chart and numeric callout.'}
  ];

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
    const first = $id('formatSel');
    const menuButton = ensureSvgButton('btnSidebar', 'Show / hide projects sidebar',
      '<path d="M4 5h16v14H4z"/><path d="M10 5v14"/>');
    const projectButton = ensureSvgButton('btnProjects', 'Recent projects',
      '<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/>');
    const settingsButton = ensureSvgButton('btnSettings', 'Settings',
      '<circle cx="12" cy="12" r="3"/><path d="m19 15 2 1-2 4-2-1-2 1v2H9v-2l-2-1-2 1-2-4 2-1v-2l-2-1 2-4 2 1 2-1V6h5v2l2 1 2-1 2 4-2 1z"/>');
    const newButton = ensureSvgButton('btnNewProject', 'New project',
      '<path d="M12 5v14M5 12h14"/>');
    const agentButton = ensureSvgButton('btnAgentToggle', 'Show / hide agent chat',
      '<path d="M4 5h16v14H4z"/><path d="M4 10h16"/><path d="M9 10v9"/>');
    const shareButton = ensureSvgButton('btnShare', 'Share project',
      '<path d="M12 16V3m-5 5 5-5 5 5"/><path d="M5 13v7h14v-7"/>');
    const title = document.createElement('button');
    title.id = 'btnProjectName';
    title.className = 'project-title-button';
    title.type = 'button';
    title.title = 'Rename current project';
    title.textContent = projectName || 'Untitled project';
    const saveDot = document.createElement('span');
    saveDot.id = 'saveIndicator';
    saveDot.className = 'save-indicator';
    saveDot.title = 'All changes saved';
    saveDot.setAttribute('aria-label', 'All changes saved');
    header.insertBefore(menuButton, first);
    header.insertBefore(projectButton, first);
    header.insertBefore(title, first);
    header.insertBefore(saveDot, first);
    header.insertBefore(agentButton, first);
    header.insertBefore(newButton, first);
    header.insertBefore(shareButton, first);
    header.insertBefore(settingsButton, first);
    menuButton.onclick = () => {
      document.body.classList.toggle('sidebar-hidden');
      persistUiState();
    };
    projectButton.onclick = () => {
      document.body.classList.remove('sidebar-hidden');
      renderProjectSidebar();
      $id('projectSearch')?.focus();
      persistUiState();
    };
    settingsButton.onclick = () => A.app.openSettings();
    newButton.onclick = () => openNewProjectWizard();
    agentButton.onclick = () => {
      document.body.classList.toggle('agent-hidden');
      persistUiState();
    };
    shareButton.onclick = showShareMenu;
    title.onclick = () => beginProjectRename();
    if ($id('btnLoad')) $id('btnLoad').onclick = openProjectGallery;
    if ($id('btnSave')) $id('btnSave').onclick = saveProject;
    if ($id('btnReset')) $id('btnReset').style.display = 'none';
    ['btnRestart','btnLetter','btnCrop','btnMusic','btnMusicOn','btnFont','btnLoad','btnSave','btnPoster'].forEach(id => {
      if ($id(id)) $id(id).style.display = 'none';
    });
    const iconMarkup = {
      btnPlay: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>',
      btnUndo: '<svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg>',
      btnRedo: '<svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a7 7 0 0 0-7 7"/></svg>',
      btnExport: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/></svg>'
    };
    Object.entries(iconMarkup).forEach(([id,markup]) => {
      const button = $id(id);
      if (!button) return;
      button.classList.add('iconBtn');
      button.innerHTML = markup;
      button.setAttribute('aria-label',button.title || id);
      if (!button.title) button.title = id === 'btnPlay' ? 'Play / pause' : id === 'btnExport' ? 'Export video' : id === 'btnUndo' ? 'Undo' : 'Redo';
    });
    if ($id('btnPlay')) {
      const originalSync = window.syncPlayBtn;
      window.syncPlayBtn = function () {
        if (typeof originalSync === 'function') originalSync();
        const button = $id('btnPlay');
        if (!button) return;
        const isPlaying = /Pause/i.test(button.textContent || '');
        button.innerHTML = isPlaying
          ? '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>';
        button.title = isPlaying ? 'Pause' : 'Play';
        button.setAttribute('aria-label',button.title);
      };
      window.syncPlayBtn();
      const originalPlay = $id('btnPlay').onclick;
      $id('btnPlay').onclick = function () {
        if (typeof originalPlay === 'function') originalPlay.apply(this,arguments);
        window.syncPlayBtn();
      };
    }
    updateProjectTitle();
  }

  function updateProjectTitle() {
    const button = $id('btnProjectName');
    if (button) {
      button.textContent = projectName || 'Untitled project';
      button.title = projectName ? 'Rename ' + projectName : 'Rename current project';
    }
  }

  function beginProjectRename() {
    const button = $id('btnProjectName');
    if (!button || !projectId || $id('projectNameEditor')) return;
    const input = document.createElement('input');
    input.id = 'projectNameEditor';
    input.className = 'project-name-editor';
    input.value = projectName || 'Untitled project';
    input.maxLength = 100;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value && value !== projectName) {
        try {
          await A.project.rename(projectId, value);
          projectName = value;
          status('Renamed · ' + projectName);
          renderProjectSidebar();
          scheduleSave();
        } catch (error) { status('Rename failed · ' + error.message); }
      }
      const next = document.createElement('button');
      next.id = 'btnProjectName';
      next.className = 'project-title-button';
      next.type = 'button';
      next.onclick = beginProjectRename;
      input.replaceWith(next);
      updateProjectTitle();
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function persistUiState() {
    try {
      await A.ui.save({
        sidebarHidden: document.body.classList.contains('sidebar-hidden'),
        agentHidden: document.body.classList.contains('agent-hidden')
      });
    } catch (error) { console.warn('Could not save layout state', error); }
  }

  function installProjectSidebar() {
    if ($id('aivaSidebar')) return;
    const aside = document.createElement('aside');
    aside.id = 'aivaSidebar';
    aside.innerHTML =
      '<div class="sidebar-brand"><span class="sidebar-mark">AV</span><span class="sidebar-brand-copy"><strong>Video Agent</strong><small>Studio</small></span>' +
      '<button id="sidebarCollapse" class="icon" title="Collapse sidebar" aria-label="Collapse sidebar"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M10 5v14"/></svg></button></div>' +
      '<button id="sidebarNewProject" class="sidebar-new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>New project</span></button>' +
      '<div class="sidebar-search"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>' +
      '<input id="projectSearch" type="search" placeholder="Find a project…" autocomplete="off"><kbd>Ctrl K</kbd></div>' +
      '<div class="sidebar-section-head"><span>Recent projects</span><button id="sidebarRefresh" class="icon" title="Refresh projects" aria-label="Refresh projects"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 12.1-2L20 12M4 12l1.8 5a7 7 0 0 0 12.1-2"/></svg></button></div>' +
      '<div id="sidebarProjects" class="sidebar-projects"></div>' +
      '<div class="sidebar-footer"><button id="sidebarImport" class="sidebar-foot-button" title="Import project"><svg viewBox="0 0 24 24"><path d="M12 15V3m-5 5 5-5 5 5"/><path d="M4 15v5h16v-5"/></svg><span>Import project</span></button>' +
      '<button id="sidebarSettings" class="sidebar-foot-button" title="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="m19 15 2 1-2 4-2-1-2 1v2H9v-2l-2-1-2 1-2-4 2-1v-2l-2-1 2-4 2 1 2-1V6h5v2l2 1 2-1 2 4-2 1z"/></svg><span>Settings</span></button></div>';
    const main = document.querySelector('.app main');
    const agent = $id('agentPane');
    if (main && agent) main.insertBefore(aside, agent);
    $id('sidebarNewProject').onclick = openNewProjectWizard;
    $id('sidebarCollapse').onclick = () => {
      document.body.classList.add('sidebar-hidden');
      persistUiState();
    };
    $id('sidebarRefresh').onclick = renderProjectSidebar;
    $id('projectSearch').addEventListener('input', renderProjectSidebar);
    $id('sidebarImport').onclick = importProjectFile;
    $id('sidebarSettings').onclick = () => A.app.openSettings();
    renderProjectSidebar();
  }

  async function renderProjectSidebar() {
    const host = $id('sidebarProjects');
    if (!host) return;
    host.innerHTML = '<div class="sidebar-empty">Loading projects…</div>';
    try {
      const projects = await A.project.list();
      const query = ($id('projectSearch')?.value || '').trim().toLowerCase();
      const visible = projects.filter(project => !query || String(project.name).toLowerCase().includes(query));
      host.innerHTML = '';
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'sidebar-empty';
        empty.textContent = query ? 'No matching projects' : 'Your next idea starts here';
        host.appendChild(empty);
        return;
      }
      visible.forEach(project => {
        const row = document.createElement('div');
        row.className = 'sidebar-project-row' + (project.id === projectId ? ' active' : '');
        const open = document.createElement('button');
        open.className = 'sidebar-project-open';
        open.type = 'button';
        open.title = project.name;
        open.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h7l2 2h7v10H4z"/><path d="M4 7V5h7l2 2"/></svg><span><strong></strong><small></small></span>';
        open.querySelector('strong').textContent = project.name;
        const date = project.updatedAt || project.lastOpenedAt || project.createdAt;
        open.querySelector('small').textContent = date ? new Date(date).toLocaleDateString() : 'Project';
        open.onclick = () => openProject(project.id);
        const more = document.createElement('button');
        more.className = 'sidebar-project-more icon';
        more.type = 'button';
        more.title = 'Project actions';
        more.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
        more.onclick = event => {
          event.stopPropagation();
          showProjectActions(project, more);
        };
        row.append(open, more);
        host.appendChild(row);
      });
    } catch (error) {
      host.innerHTML = '<div class="sidebar-empty">Project list unavailable · ' + escapeHtml(error.message) + '</div>';
    }
  }

  function showProjectActions(project, anchor) {
    const old = $id('projectActionMenu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.id = 'projectActionMenu';
    menu.className = 'project-action-menu';
    menu.innerHTML =
      '<button data-action="open"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m9 12 2 2 4-4"/></svg>Open</button>' +
      '<button data-action="rename"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4.8L8 20l10.8-10.8-4-4z"/></svg>Rename</button>' +
      '<button data-action="duplicate"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>Duplicate</button>' +
      '<button data-action="reveal"><svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3z"/></svg>Show in folder</button>' +
      '<button data-action="delete" class="danger"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v7m4-7v7M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>Delete</button>';
    document.body.appendChild(menu);
    const rect = anchor?.getBoundingClientRect();
    menu.style.left = Math.max(12, (rect?.left || 230) - 12) + 'px';
    menu.style.top = Math.min(window.innerHeight - 230, Math.max(60, rect?.top || 160)) + 'px';
    menu.querySelectorAll('[data-action]').forEach(button => {
      button.onclick = async () => {
        menu.remove();
        try {
          const action = button.dataset.action;
          if (action === 'open') return openProject(project.id);
          if (action === 'rename') {
            const value = window.prompt('Project name', project.name);
            if (value && value.trim()) {
              await A.project.rename(project.id, value.trim());
              if (projectId === project.id) { projectName = value.trim(); updateProjectTitle(); }
            }
          } else if (action === 'duplicate') {
            const copy = await A.project.duplicate(project.id);
            status('Duplicated · ' + copy.name);
          } else if (action === 'reveal') {
            await A.project.reveal(project.id);
          } else if (action === 'delete') {
            if (!window.confirm('Delete "' + project.name + '"? This cannot be undone.')) return;
            await A.project.delete(project.id);
            if (projectId === project.id) {
              projectId = null;
              projectName = 'Untitled project';
              CHAT.length = 0;
              $id('chat').innerHTML = '';
            }
          }
          renderProjectSidebar();
        } catch (error) { status('Project action failed · ' + error.message); }
      };
    });
    const close = event => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('pointerdown',close,true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown',close,true),0);
  }

  async function openNewProjectWizard() {
    let modal = $id('newProjectWizard');
    if (modal) { modal.classList.add('open'); $id('newProjectName')?.focus(); return; }
    modal = document.createElement('div');
    modal.id = 'newProjectWizard';
    modal.className = 'new-project-overlay open';
    modal.innerHTML =
      '<section class="new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="newProjectTitle">' +
      '<div class="new-project-head"><div><span class="wizard-kicker">NEW WORKSPACE</span><h2 id="newProjectTitle">Start a project</h2><p>Give your idea a name and choose where it lives.</p></div>' +
      '<button id="newProjectClose" class="icon" aria-label="Close" title="Close"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>' +
      '<label class="wizard-field"><span>Project name</span><input id="newProjectName" maxlength="100" placeholder="e.g. Google loading animation" autocomplete="off"></label>' +
      '<div class="wizard-field"><span>Save location</span><div class="wizard-location"><svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/></svg><span id="newProjectPath">Choose a folder for this project</span>' +
      '<button id="newProjectBrowse" class="icon" title="Choose folder" aria-label="Choose folder"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/></svg></button></div>' +
      '<small id="newProjectPathHint">Projects are saved locally on this computer and can be reopened later.</small></div>' +
      '<div class="wizard-field"><span>Video format</span><div class="wizard-formats">' +
      '<button data-format="16:9" class="wizard-format"><span class="format-shape wide"></span><strong>Landscape</strong><small>16:9 · YouTube</small></button>' +
      '<button data-format="9:16" class="wizard-format selected"><span class="format-shape vertical"></span><strong>Portrait</strong><small>9:16 · Shorts / Reels</small></button>' +
      '<button data-format="1:1" class="wizard-format"><span class="format-shape square"></span><strong>Square</strong><small>1:1 · Social</small></button></div></div>' +
      '<div class="new-project-actions"><button id="newProjectCancel" class="icon" title="Cancel">Cancel</button>' +
      '<button id="newProjectCreate" class="wizard-create" disabled><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Create project</span></button></div></section>';
    document.body.appendChild(modal);
    let workspace = await A.project.getWorkspaceInfo();
    let selectedFormat = '9:16';
    const pathLabel = $id('newProjectPath');
    const createButton = $id('newProjectCreate');
    function updatePath() {
      pathLabel.textContent = workspace.configured ? workspace.root : 'Choose a folder for this project';
      createButton.disabled = !workspace.configured || !$id('newProjectName').value.trim();
    }
    $id('newProjectName').addEventListener('input', updatePath);
    $id('newProjectBrowse').onclick = async () => {
      const result = await A.project.chooseRoot();
      if (!result.canceled) {
        workspace = { root: result.root, configured: true };
        updatePath();
      }
    };
    modal.querySelectorAll('[data-format]').forEach(button => {
      button.onclick = () => {
        selectedFormat = button.dataset.format;
        modal.querySelectorAll('[data-format]').forEach(item => item.classList.toggle('selected', item === button));
      };
    });
    const close = () => modal.classList.remove('open');
    $id('newProjectClose').onclick = close;
    $id('newProjectCancel').onclick = close;
    modal.addEventListener('pointerdown', event => { if (event.target === modal) close(); });
    $id('newProjectCreate').onclick = async () => {
      const name = $id('newProjectName').value.trim();
      if (!name || !workspace.configured) return;
      createButton.disabled = true;
      try {
        await createNewProject({ name, format: selectedFormat });
        modal.classList.remove('open');
      } catch (error) {
        status('Could not create project · ' + error.message);
        createButton.disabled = false;
      }
    };
    updatePath();
    $id('newProjectName').focus();
  }

  function installComposerUI() {
    const send = $id('btnSend');
    const stop = $id('btnStop');
    if (send) {
      send.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
      send.title = 'Send message';
      send.setAttribute('aria-label','Send message');
    }
    if (stop) {
      stop.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
      stop.title = 'Stop agent';
      stop.setAttribute('aria-label','Stop agent');
    }
    const input = $id('fileVideo');
    if (input && !$id('btnAttachVideo')) {
      const attach = document.createElement('button');
      attach.id = 'btnAttachVideo';
      attach.type = 'button';
      attach.className = 'iconBtn composer-attach';
      attach.title = 'Attach a video';
      attach.setAttribute('aria-label','Attach a video');
      attach.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="m10 13 5 3-5 3z"/></svg>';
      attach.onclick = () => input.click();
      const row = send && send.parentElement;
      if (row) row.insertBefore(attach,send);
      const oldLabel = input.closest('.filebtn');
      if (oldLabel) oldLabel.style.display = 'none';
    }
  }

  function installSelectionContext() {
    const composer = document.querySelector('.composer');
    if (!composer || $id('selectionContext')) return;
    const chip = document.createElement('div');
    chip.id = 'selectionContext';
    chip.className = 'selection-context';
    chip.hidden = true;
    chip.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z"/><path d="M9 9h6v6H9z"/></svg><span id="selectionContextLabel"></span>' +
      '<button id="selectionContextClear" class="icon" title="Remove selection context" aria-label="Remove selection context"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
    composer.insertBefore(chip, $id('prompt'));
    function refreshSelection() {
      const selected = typeof SELECTED !== 'undefined' ? SELECTED : null;
      const label = selected ? (typeof labelOf === 'function' ? labelOf(selected) : String(selected)) : '';
      chip.hidden = !selected;
      if ($id('selectionContextLabel')) $id('selectionContextLabel').textContent = selected ? 'Selected · ' + label : '';
    }
    $id('selectionContextClear').onclick = () => {
      SELECTED = null;
      if (typeof drawOverlay === 'function') drawOverlay();
      if (typeof renderPanel === 'function') renderPanel();
      refreshSelection();
    };
    if ($id('stage')) {
      $id('stage').addEventListener('pointerup', () => requestAnimationFrame(refreshSelection));
      $id('stage').addEventListener('dblclick', () => requestAnimationFrame(refreshSelection));
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') requestAnimationFrame(refreshSelection);
    });
    const includeSelection = () => {
      const selected = typeof SELECTED !== 'undefined' ? SELECTED : null;
      const input = $id('prompt');
      if (!selected || !input || !input.value.trim()) return;
      const label = typeof labelOf === 'function' ? labelOf(selected) : String(selected);
      if (!input.value.startsWith('Regarding the selected element')) {
        input.value = 'Regarding the selected video element "' + label + '" (id: ' + selected + '): ' + input.value;
      }
    };
    $id('btnSend')?.addEventListener('click', includeSelection, true);
    $id('prompt')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && (event.ctrlKey || event.metaKey)) includeSelection();
    }, true);
    refreshSelection();
  }


  function applyAppearance(value) {
    if (!value) return;
    const root = document.documentElement;
    root.dataset.theme = value.mode === 'dark' ? 'dark' : 'light';
    root.dataset.motion = value.reduceMotion ? 'reduced' : 'normal';
    root.dataset.density = value.density === 'compact' ? 'compact' : 'comfortable';
    root.style.setProperty('--accent', value.accent || '#C65A2E');
    if (value.mode === 'custom') {
      root.style.setProperty('--bg',value.bg || '#F7F6F3');
      root.style.setProperty('--paper',value.paper || '#FFFFFF');
      root.style.setProperty('--ink',value.ink || '#171614');
    } else {
      root.style.removeProperty('--bg');
      root.style.removeProperty('--paper');
      root.style.removeProperty('--ink');
    }
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
        comments: projectComments.slice(-500),
        brandKit: window.AIVA_BRAND_KIT || settingsData?.brandKit || null,
        template: projectTemplate,
        sourceMediaName: window.AIVA_SOURCE_NAME || null,
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
      if ($id('saveIndicator')) $id('saveIndicator').classList.add('saving');
      await A.project.save(payload);
      if ($id('saveIndicator')) {
        $id('saveIndicator').classList.remove('saving','error');
        $id('saveIndicator').classList.add('saved');
        $id('saveIndicator').title = 'All changes saved';
      }
      status('Saved · ' + projectName);
      renderProjectSidebar();
    } catch (error) {
      if ($id('saveIndicator')) {
        $id('saveIndicator').classList.remove('saving','saved');
        $id('saveIndicator').classList.add('error');
        $id('saveIndicator').title = 'Save failed';
      }
      status('Save failed · ' + (error.message || error));
    }
  }
  function scheduleSave() {
    if (!projectId || loadingProject || window.__EXPORTING) return;
    if ($id('saveIndicator')) {
      $id('saveIndicator').classList.remove('saved','error');
      $id('saveIndicator').classList.add('saving');
      $id('saveIndicator').title = 'Saving changes…';
    }
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
    const originalSetTime = window.setTime;
    if (typeof originalSetTime === 'function') {
      window.setTime = function () {
        const result = originalSetTime.apply(this, arguments);
        if (!window.playing) scheduleSave();
        return result;
      };
    }
    const originalPause = window.pause;
    if (typeof originalPause === 'function') {
      window.pause = function () {
        const result = originalPause.apply(this, arguments);
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
      projectComments = Array.isArray(data.comments) ? data.comments.slice(-500) : [];
      projectTemplate = data.template || 'blank';
      if (data.brandKit) {
        window.AIVA_BRAND_KIT = data.brandKit;
        applyAivaBrandKit(data.brandKit);
      } else if (settingsData && settingsData.brandKit) {
        window.AIVA_BRAND_KIT = settingsData.brandKit;
        applyAivaBrandKit(settingsData.brandKit);
      }
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

  function renderStoredChat() {
    const host = $id('chat');
    if (!host) return;
    host.innerHTML = '';
    CHAT.filter(message => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
      .slice(-120)
      .forEach(message => {
        if (!message.content) return;
        const bubble = document.createElement('div');
        bubble.className = 'msg ' + (message.role === 'user' ? 'user' : message.role === 'system' ? 'sys' : 'bot');
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = message.role === 'user' ? 'you' : message.role === 'system' ? 'system' : 'agent';
        const body = document.createElement('div');
        body.className = 'mbody';
        body.textContent = String(message.content);
        bubble.append(tag, body);
        host.appendChild(bubble);
      });
    host.scrollTop = host.scrollHeight;
  }

  async function createNewProject(options) {
    if (!options || typeof options !== 'object') {
      return openNewProjectWizard();
    }
    const title = String(options.name || 'Untitled project').trim() || 'Untitled project';
    try {
      await persistNow();
      const created = await A.project.create(title);
      projectId = created.id;
      projectName = created.name;
      SPEC = JSON.parse(JSON.stringify(DEFAULT_SPEC));
      SPEC.title = title;
      SPEC.format = ['16:9','9:16','1:1'].includes(options.format) ? options.format : '9:16';
      SPEC.scenes = [];
      EDIT.items = {};
      EDIT.scenes = {};
      EDIT.base = {};
      SELECTED = null;
      CHAT.length = 0;
      projectComments = [];
      projectTemplate = options.template || 'blank';
      window.AIVA_SOURCE_PATH = null;
      window.AIVA_SOURCE_NAME = null;
      if (typeof TODOS !== 'undefined') TODOS = [];
      Object.keys(CROP_IMGS).forEach(key => delete CROP_IMGS[key]);
      setMusic({ clear: true });
      MUSIC.on = false;
      if (typeof setMusicOn === 'function') setMusicOn(false);
      SFX.length = 0;
      if (typeof renderSfxList === 'function') renderSfxList();
      buildScenes();
      syncSpec();
      if (Number.isFinite(Number(options.duration))) DUR = Math.max(1, Math.min(120, Number(options.duration)));
      setTime(0);
      if ($id('prompt')) $id('prompt').value = '';
      if ($id('chat')) $id('chat').innerHTML = '';
      if ($id('homeScreen')) $id('homeScreen').classList.remove('open');
      updateProjectTitle();
      renderProjectSidebar();
      renderCommentMarkers();
      sysNote(projectTemplate === 'blank'
        ? 'Blank project ready. Describe the video you want to create.'
        : 'New ' + projectTemplate + ' project ready. Describe the content; the agent will use this starter structure and keep every scene editable.');
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
      if (projectId && projectId !== id) await persistNow();
      const data = await A.project.load(id);
      applyProjectData(data);
      projectId = data.id;
      projectName = data.name || data.spec.title || 'Untitled project';
      renderStoredChat();
      renderCommentMarkers();
      updateProjectTitle();
      if ($id('homeScreen')) $id('homeScreen').classList.remove('open');
      renderProjectSidebar();
      status('Opened · ' + projectName);
      if (data.spec && (data.spec.media || data.spec.scenes?.some(scene => scene.media)) && !MEDIA.video) {
        agentStatus('Project reopened. Re-select the source video to reconnect its media file.');
      }
    } catch (error) {
      status('Open failed · ' + error.message);
    }
  }

  function installProjectGallery() {
    installProjectSidebar();
  }

  async function openProjectGallery() {
    document.body.classList.remove('sidebar-hidden');
    await renderProjectSidebar();
    persistUiState();
  }

  async function saveProject() {
    if (!projectId) {
      await openNewProjectWizard();
      return;
    }
    await persistNow();
    renderProjectSidebar();
  }

  async function importProjectFile() {
    try {
      const result = await A.project.importFile();
      if (result && result.imported && result.project) {
        await openProject(result.project.id);
        status('Imported · ' + result.project.name);
      }
      renderProjectSidebar();
    } catch (error) {
      status('Import failed · ' + error.message);
    }
  }


  function showShareMenu() {
    let menu = $id('sharePopover');
    if (menu) { menu.remove(); return; }
    menu = document.createElement('div');
    menu.id = 'sharePopover';
    menu.className = 'share-popover';
    menu.innerHTML =
      '<div class="share-title">Share project</div>' +
      '<button id="shareAivp"><strong>Editable project</strong><small>Save one .aivp file with project data and skills.</small></button>' +
      '<button id="shareHtml"><strong>Standalone HTML</strong><small>Offline video player for any modern browser.</small></button>';
    document.body.appendChild(menu);
    $id('shareAivp').onclick = async () => {
      try {
        if (!projectId) await createNewProject((SPEC && SPEC.title) || 'Untitled project');
        await persistNow();
        const result = await A.project.exportBundle(currentProjectData());
        menu.remove();
        if (result && result.saved) status('Project bundle saved · ' + result.path);
      } catch (error) { status('Share failed · ' + error.message); }
    };
    $id('shareHtml').onclick = async () => {
      try {
        if (!projectId) await createNewProject((SPEC && SPEC.title) || 'Untitled project');
        await persistNow();
        const result = await A.project.exportHtml(currentProjectData());
        menu.remove();
        if (result && result.saved) status('Standalone HTML saved · ' + result.path);
      } catch (error) { status('HTML export failed · ' + error.message); }
    };
    const close = event => {
      if (!menu.contains(event.target) && event.target !== $id('btnShare')) {
        menu.remove();
        document.removeEventListener('pointerdown',close,true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown',close,true),0);
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
    window.apiKey = () => providerReady ? 'secure-provider-configured' : '';
    window.apiBase = () => activeProvider ? activeProvider.base_url.replace(/\/+$/, '') : 'https://api.deepseek.com';
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
    mute.id = 'btnMute'; mute.className = 'tiny iconBtn'; mute.title = 'Mute / unmute'; mute.setAttribute('aria-label','Mute / unmute'); mute.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M17 9a5 5 0 0 1 0 6"/></svg>';
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
    present.id = 'btnPresent'; present.className = 'tiny iconBtn'; present.title = 'Fullscreen presentation'; present.setAttribute('aria-label','Fullscreen presentation');
    present.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
    bar.appendChild(mute); bar.appendChild(volume); bar.appendChild(speed); bar.appendChild(present);
    mute.onclick = () => {
      muted = !muted;
      const v = Number(volume.value);
      if (audioEl) audioEl.volume = muted ? 0 : v;
      if (MEDIA && MEDIA.video) MEDIA.video.volume = muted ? 0 : v;
      if (typeof sfxBus !== 'undefined' && sfxBus && sfxBus.gain) sfxBus.gain.value = muted ? 0 : v;
      mute.innerHTML = muted
        ? '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4z"/><path d="m17 9 5 6m0-6-5 6"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M17 9a5 5 0 0 1 0 6"/></svg>';
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

  let activeExportId = null;
  function installVideoExport() {
    const previousExport = window.exportVideo;
    window.exportVideo = async function () {
      if (!ffmpegAvailable) {
        status('FFmpeg is not available in this installation. MP4 export is disabled.');
        return;
      }
      if (!SPEC.scenes || !SPEC.scenes.length) {
        status('Nothing to export yet · Ask the agent to build a video first.');
        return;
      }
      if (window.__EXPORTING) return;
      const fps = Math.max(12, Math.min(60, Number(SPEC.fps) || 30));
      const duration = Math.max(1, Math.min(120, Number(DUR) || 15));
      const frameCount = Math.ceil(fps * duration);
      if (frameCount > 7200) {
        status('Export duration exceeds the 120-second limit.');
        return;
      }
      const originalTime = Number(time) || 0;
      const resumePlayback = !!playing;
      const buttons = ['btnExport','btnPoster','btnPlay','btnStart','btnSave','btnLoad','btnReset','btnNewProject','btnProjects'];
      const setLocked = locked => buttons.forEach(id => {
        const el = $id(id);
        if (el) el.disabled = locked;
      });
      let unlisten = null;
      window.__EXPORTING = true;
      window.EXPORT_CANCEL = false;
      pause();
      setLocked(true);
      if ($id('btnStop')) $id('btnStop').textContent = 'Cancel export';
      try {
        const musicData = MUSIC && MUSIC.on !== false && MUSIC.dataUrl ? MUSIC.dataUrl : null;
        const session = await A.export.begin({
          fps:fps,duration:duration,ext:'jpg',
          audioDataUrl:musicData,
          audioVolume:MUSIC && MUSIC.volume != null ? MUSIC.volume : 0.8
        });
        activeExportId = session.id;
        unlisten = A.export.onProgress(progress => {
          if (progress.phase === 'encoding') {
            status('Encoding MP4 · ' + Math.round((progress.value || 0) * 100) + '%');
          } else if (progress.phase === 'done') {
            status('Finalizing MP4…');
          } else {
            status('Rendering frames · ' + Math.round((progress.value || 0) * 100) + '%');
          }
        });
        for (let index = 0; index < frameCount; index++) {
          if (window.EXPORT_CANCEL) throw new Error('Export cancelled.');
          const frameTime = index / fps;
          setTime(frameTime);
          renderFrame(frameTime);
          const dataUrl = stage.toDataURL('image/jpeg',0.9);
          await A.export.writeFrame(session.id,index,dataUrl);
          if (index % 4 === 0) {
            status('Rendering frames · ' + Math.round(((index + 1) / frameCount) * 100) + '%');
            await new Promise(resolve => setTimeout(resolve,0));
          }
        }
        if (window.EXPORT_CANCEL) throw new Error('Export cancelled.');
        const result = await A.export.finish(session.id);
        activeExportId = null;
        if (result && result.saved) {
          status('Saved · ' + result.path + ' · ' + (result.bytes / 1048576).toFixed(1) + ' MB');
        } else {
          status('Export cancelled.');
        }
      } catch (error) {
        if (activeExportId) {
          await A.export.cancel(activeExportId).catch(() => {});
          activeExportId = null;
        }
        status((error && error.message) || 'MP4 export failed.');
      } finally {
        if (unlisten) unlisten();
        activeExportId = null;
        window.__EXPORTING = false;
        window.EXPORT_CANCEL = false;
        setLocked(false);
        if ($id('btnStop')) $id('btnStop').textContent = 'Stop';
        setTime(Math.min(originalTime,DUR));
        if (resumePlayback) play();
      }
    };
    if ($id('btnExport')) $id('btnExport').onclick = window.exportVideo;
    if ($id('btnStop')) {
      const originalStop = $id('btnStop').onclick;
      $id('btnStop').onclick = function () {
        if (window.__EXPORTING) {
          window.EXPORT_CANCEL = true;
          if (activeExportId) A.export.cancel(activeExportId).catch(() => {});
          status('Cancelling export…');
          return;
        }
        if (typeof originalStop === 'function') originalStop.apply(this,arguments);
      };
    }
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
      '<button class="settings-nav" data-settings-tab="brand">Brand Kit</button>' +
      '<button class="settings-nav" data-settings-tab="music">Music &amp; SFX</button>' +
      '<button class="settings-nav" data-settings-tab="motion">Motion Library</button>' +
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
      integrations:'Integrations',brand:'Brand Kit',music:'Music & SFX',motion:'Motion Library',advanced:'Advanced',about:'About'
    };
    $id('settingsTitle').textContent = labels[tab] || 'Settings';
    settingsStatus('');
    if (tab === 'appearance') renderAppearance();
    else if (tab === 'providers') renderProviders();
    else if (tab === 'tools') renderTools();
    else if (tab === 'integrations') renderIntegrations();
    else if (tab === 'brand') renderBrandKit();
    else if (tab === 'music') renderMusicSettings();
    else if (tab === 'motion') renderMotionLibrary();
    else if (tab === 'advanced') renderAdvanced();
    else renderAbout();
  }

  function renderAppearance() {
    const value = settingsData.appearance || {};
    const rows =
      settingRow('Theme','Light, dark or follow the Windows setting.',
        '<select id="settingTheme"><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option><option value="custom">Custom</option></select>') +
      settingRow('Accent colour','Selection and focus colour.',
        '<input id="settingAccent" type="color" value="' + escapeHtml(value.accent || '#C65A2E') + '">') +
      settingRow('Window background','Custom workspace backdrop colour.',
        '<input id="settingBg" type="color" value="' + escapeHtml(value.bg || '#F7F6F3') + '">') +
      settingRow('Panel surface','Chat and card background.',
        '<input id="settingPaper" type="color" value="' + escapeHtml(value.paper || '#FFFFFF') + '">') +
      settingRow('Main text','Primary interface text colour.',
        '<input id="settingInk" type="color" value="' + escapeHtml(value.ink || '#171614') + '">') +

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
        bg:$id('settingBg').value,paper:$id('settingPaper').value,ink:$id('settingInk').value,
        fontScale:Number($id('settingFont').value),density:$id('settingDensity').value,
        reduceMotion:$id('settingMotion').checked,windowMaterial:$id('settingMaterial').value
      };
      try {
        settingsData.appearance = await A.settings.saveAppearance(next);
        applyAppearance(settingsData.appearance);
        settingsStatus('Saved',true);
      } catch (error) { settingsStatus(error.message,false); }
    };
    ['settingTheme','settingAccent','settingBg','settingPaper','settingInk','settingFont','settingDensity','settingMotion','settingMaterial'].forEach(id =>
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
    const captions = info.captions || {};
    const tts = info.tts || {};
    const cards = [
      settingCard('Auto captions & speech recognition',
        'Whisper-compatible API. The key is encrypted on this Windows account. Test the endpoint before enabling the agent tool.',
        '<div class="integration-grid">' +
        settingRow('Enable captions','Allow the agent to transcribe video and add timed subtitles.',
          '<input id="intCaptionsOn" type="checkbox"' + (captions.enabled?' checked':'') + '>') +
        settingRow('API base URL','Example: https://api.openai.com/v1',
          '<input id="intCaptionsUrl" class="wide-input" value="' + escapeHtml(captions.base_url || 'https://api.openai.com/v1') + '">') +
        settingRow('API key',captions.keyConfigured?'Key saved securely · enter a new value to replace it.':'Not configured.',
          '<input id="intCaptionsKey" class="wide-input" type="password" autocomplete="new-password" placeholder="' + (captions.keyConfigured?'Saved securely':'Paste API key') + '">') +
        settingRow('Transcription model','Default: whisper-1. Some providers offer gpt-4o-mini-transcribe.',
          '<input id="intCaptionsModel" class="wide-input" value="' + escapeHtml(captions.model || 'whisper-1') + '">') +
        settingRow('Language','Use auto or an ISO-639-1 language code.',
          '<input id="intCaptionsLanguage" class="wide-input" value="' + escapeHtml(captions.language || 'auto') + '">') +
        '<div class="integration-actions"><button id="testCaptions">Test API connection</button><span id="captionsStatus" class="integration-status">' + (captions.tested ? 'Connected · endpoint tested' : captions.keyConfigured ? 'Key saved · test required' : 'Not connected') + '</span></div></div>') +
      settingCard('AI voiceover · text to speech',
        'OpenAI-compatible /audio/speech endpoint. Generated audio is stored with the project and added to its soundtrack.',
        '<div class="integration-grid">' +
        settingRow('Enable voiceover','Allow the agent to generate spoken narration.',
          '<input id="intTtsOn" type="checkbox"' + (tts.enabled?' checked':'') + '>') +
        settingRow('API base URL','Example: https://api.openai.com/v1',
          '<input id="intTtsUrl" class="wide-input" value="' + escapeHtml(tts.base_url || 'https://api.openai.com/v1') + '">') +
        settingRow('API key',tts.keyConfigured?'Key saved securely · enter a new value to replace it.':'Not configured.',
          '<input id="intTtsKey" class="wide-input" type="password" autocomplete="new-password" placeholder="' + (tts.keyConfigured?'Saved securely':'Paste API key') + '">') +
        settingRow('Speech model','Default: tts-1 or a compatible speech model.',
          '<input id="intTtsModel" class="wide-input" value="' + escapeHtml(tts.model || 'tts-1') + '">') +
        settingRow('Voice','Provider voice ID, for example alloy.',
          '<input id="intTtsVoice" class="wide-input" value="' + escapeHtml(tts.voice || 'alloy') + '">') +
        '<div class="integration-actions"><button id="testTts">Test API connection</button><span id="ttsStatus" class="integration-status">' + (tts.tested ? 'Connected · endpoint tested' : tts.keyConfigured ? 'Key saved · test required' : 'Not connected') + '</span></div></div>') +
      settingCard('Native video export & optional tools',
        'FFmpeg is bundled with the Windows build. Motion library is local and does not require an API key.',
        settingRow('FFmpeg H.264 / AAC export','Native frame-exact export. Hardware encoder is detected automatically when supported.',
          '<input type="checkbox" checked disabled title="Bundled FFmpeg is enabled by default">') +
        settingRow('Motion code library','Reusable canvas-code presets and agent-authored motion graphics.',
          '<input id="intMotionLibrary" type="checkbox"' + (info.motionLibrary !== false?' checked':'') + '>') +
        '<div class="setting-actions"><button id="saveIntegrations" class="primary">Save integration switches</button></div>');
    $id('settingsContent').innerHTML = cards;

    async function test(kind) {
      const isCaptions = kind === 'captions';
      const prefix = isCaptions ? 'intCaptions' : 'intTts';
      const statusId = isCaptions ? 'captionsStatus' : 'ttsStatus';
      const button = $id(isCaptions ? 'testCaptions' : 'testTts');
      button.disabled = true;
      $id(statusId).textContent = 'Testing API…';
      try {
        const result = await A.settings.testIntegration(kind, {
          base_url:$id(prefix+'Url').value.trim(),
          apiKey:$id(prefix+'Key').value.trim(),
          model:$id(prefix+'Model').value.trim(),
          voice:isCaptions?'':$id('intTtsVoice').value.trim(),
          language:isCaptions?$id('intCaptionsLanguage').value.trim():'auto'
        });
        settingsData.integrations[kind] = result.config;
        $id(prefix+'Key').value = '';
        $id(statusId).textContent = 'Connected · ' + (result.models.length ? result.models.length + ' models' : 'API authenticated');
        $id(statusId).classList.add('ok');
        settingsStatus((isCaptions?'Captions':'TTS')+' API connection verified',true);
      } catch (error) {
        $id(statusId).textContent = error.message || 'Connection failed';
        $id(statusId).classList.remove('ok');
        settingsStatus(error.message,false);
      } finally { button.disabled = false; }
    }
    $id('testCaptions').onclick = () => test('captions');
    $id('testTts').onclick = () => test('tts');
    $id('saveIntegrations').onclick = async () => {
      try {
        settingsData.integrations = await A.settings.saveIntegrations({
          ffmpeg:true,
          captions:{
            enabled:$id('intCaptionsOn').checked,
            base_url:$id('intCaptionsUrl').value.trim(),
            model:$id('intCaptionsModel').value.trim(),
            language:$id('intCaptionsLanguage').value.trim(),
            apiKey:$id('intCaptionsKey').value.trim()
          },
          tts:{
            enabled:$id('intTtsOn').checked,
            base_url:$id('intTtsUrl').value.trim(),
            model:$id('intTtsModel').value.trim(),
            voice:$id('intTtsVoice').value.trim(),
            apiKey:$id('intTtsKey').value.trim()
          },
          motionLibrary:$id('intMotionLibrary').checked
        });
        settingsStatus('Integration switches saved · tools are gated by successful API tests',true);
        settingsData.tools = await A.settings.get().then(value=>value.tools);
        toolStates = settingsData.tools.state || {};
      } catch (error) { settingsStatus(error.message,false); }
    };
  }

  function renderBrandKit() {
    const brand=settingsData.brandKit || {};
    $id('settingsContent').innerHTML =
      settingCard('Brand identity','These colours and fonts are added to the agent context for every scene. The logo can be drawn as a persistent overlay.',
        settingRow('Brand / company name','Shown to the agent as project brand context.','<input id="brandName" class="wide-input" value="' + escapeHtml(brand.name||'') + '" placeholder="Your brand">') +
        settingRow('Primary colour','Headlines and key UI surfaces.','<input id="brandPrimary" type="color" value="' + escapeHtml(brand.primary||'#171614') + '">') +
        settingRow('Secondary colour','Background and supporting surfaces.','<input id="brandSecondary" type="color" value="' + escapeHtml(brand.secondary||'#F7F6F3') + '">') +
        settingRow('Accent colour','Calls to action and emphasis.','<input id="brandAccent" type="color" value="' + escapeHtml(brand.accent||'#C65A2E') + '">') +
        settingRow('Heading font','Font family name (must be installed or imported).','<input id="brandHeading" class="wide-input" value="' + escapeHtml(brand.headingFont||'Inter') + '">') +
        settingRow('Body font','Font family name (must be installed or imported).','<input id="brandBody" class="wide-input" value="' + escapeHtml(brand.bodyFont||'Inter') + '">') +
        settingRow('Logo','Optional transparent PNG, JPEG or SVG file.','<input id="brandLogo" type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml">') +
        settingRow('Logo position','Choose where the logo appears in the output.','<select id="brandLogoPosition"><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select>') +
        settingRow('Show logo in all scenes','Persistent branding overlay.','<input id="brandUseLogo" type="checkbox"' + (brand.useLogo!==false?' checked':'') + '>') +
        '<div class="setting-actions"><button id="brandSave" class="primary">Save Brand Kit</button></div>');
    $id('brandLogoPosition').value=brand.logoPosition||'bottom-right';
    $id('brandSave').onclick=async()=>{
      try{
        let logoDataUrl='';
        const file=$id('brandLogo').files && $id('brandLogo').files[0];
        if(file)logoDataUrl=await new Promise((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error||new Error('Could not read logo file.'));reader.readAsDataURL(file);
        });
        settingsData.brandKit=await A.settings.saveBrandKit({
          name:$id('brandName').value,primary:$id('brandPrimary').value,secondary:$id('brandSecondary').value,
          accent:$id('brandAccent').value,headingFont:$id('brandHeading').value,bodyFont:$id('brandBody').value,
          logoDataUrl,logoPosition:$id('brandLogoPosition').value,useLogo:$id('brandUseLogo').checked
        });
        window.AIVA_BRAND_KIT=settingsData.brandKit;
        if(typeof window.applyAivaBrandKit==='function')window.applyAivaBrandKit(settingsData.brandKit);
        settingsStatus('Brand Kit saved · new agent scenes will follow this identity',true);
      }catch(error){settingsStatus(error.message,false);}
    };
  }

  function renderMotionLibrary() {
    const presets=[
      ['Minimal title reveal','Soft fade and upward motion for a clean title.'],
      ['Kinetic typography','Word-by-word scale, stagger and settle.'],
      ['Product spotlight','Radial focus, orbiting accents and controlled highlights.'],
      ['Data / infographic','Animated bars, counters and callout lines.'],
      ['Logo sting','Short geometric reveal for a supplied brand mark.'],
      ['Depth / parallax','Layered motion with scale and perspective-like canvas transforms.']
    ];
    $id('settingsContent').innerHTML =
      settingCard('Code-based motion system','The agent builds directly with the existing JavaScript canvas code elements. These are editable starting points, not locked templates.',
        '<div class="motion-presets">' + presets.map((item,index)=>
          '<button class="motion-preset" data-motion-preset="'+index+'"><strong>'+escapeHtml(item[0])+'</strong><small>'+escapeHtml(item[1])+'</small></button>'
        ).join('') + '</div>') +
      settingCard('Starter templates','Choose a structure, then ask the agent to rewrite every scene.',
        '<div class="motion-presets"><button class="motion-preset" data-template="youtube-intro"><strong>YouTube intro</strong><small>Hook · channel identity · CTA</small></button>' +
        '<button class="motion-preset" data-template="instagram-story"><strong>Instagram Story</strong><small>Vertical hook · story · CTA</small></button>' +
        '<button class="motion-preset" data-template="product-demo"><strong>Product demo</strong><small>Problem · product · proof · action</small></button></div>') +
      settingCard('Advanced motion support','Canvas code may generate procedural 2D / pseudo-3D motion using JavaScript. Lottie JSON and full WebGL / Three.js scene import are not enabled in this build yet.',
        '<p class="settings-note">Use code elements for reusable HTML/CSS/JS-inspired motion designs. A Lottie or Three.js import requires a dedicated renderer integration, not just an API key.</p>');
    document.querySelectorAll('[data-motion-preset]').forEach(button=>{
      button.onclick=()=>{
        const item=presets[Number(button.dataset.motionPreset)];
        if($id('prompt'))$id('prompt').value='Create an editable motion-graphics sequence using the '+item[0]+' direction. '+item[1]+' Use native code elements and keep every part selectable.';
        if(view==='settings')status('Motion direction copied to the Studio composer.');
      };
    });
    document.querySelectorAll('[data-template]').forEach(button=>{
      button.onclick=()=>{
        const template=button.dataset.template;
        const instruction=template==='youtube-intro'?'Create a short YouTube intro: hook, logo / channel identity, then a concise CTA.':
          template==='instagram-story'?'Create a vertical Instagram Story: strong first-frame hook, clear story progression and a legible CTA.':
          'Create a product demo: problem, product reveal, key benefits, proof and final CTA.';
        if($id('prompt'))$id('prompt').value=instruction+' Make every scene fully editable and follow the active Brand Kit.';
        settingsStatus('Template brief is ready in the Studio composer.',true);
      };
    });
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
    injectStudioChrome();
    installProjectSidebar();
    installProjectGallery();
    installSelectionContext();
    installComposerUI();
    installProjectHistoryUI();
    installCommentLayer();
    installSecureAgent();
    installMediaAgentTools();
    installToolPolicy();
    installPlayerControls();
    installPosterExport();
    installVideoExport();
    if ($id('btnSave')) $id('btnSave').onclick = saveProject;
    if ($id('btnLoad')) $id('btnLoad').onclick = openProjectGallery;
    try {
      const pair = await Promise.all([A.app.info(),A.settings.get(),A.ui.get()]);
      ffmpegAvailable = !!pair[0].ffmpegAvailable;
      toolStates = pair[1].tools && pair[1].tools.state || {};
      settingsData = pair[1];
      applyAppearance(pair[1].appearance);
      window.AIVA_BRAND_KIT = pair[1].brandKit || {};
      applyAivaBrandKit(window.AIVA_BRAND_KIT);
      document.body.classList.toggle('sidebar-hidden',!!pair[2].sidebarHidden);
      document.body.classList.toggle('agent-hidden',!!pair[2].agentHidden);
      await loadProviderConfig();
      if ($id('btnExport')) $id('btnExport').title = ffmpegAvailable ? 'Export MP4 · FFmpeg' : 'Export video';
      if ($id('btnSave')) $id('btnSave').title = 'Save project';
      if ($id('btnClearChat')) $id('btnClearChat').addEventListener('click',scheduleSave);
      status('Ready · Describe → watch → refine.');
      if ($id('chat') && !$id('chat').children.length) {
        agentStatus(providerReady ? 'Choose a project or create a new one.' : 'Choose a project, then add an AI provider in Settings.');
      }
      const projects = await A.project.list();
      await renderProjectSidebar();
      if (!projects.length && !projectId) openNewProjectWizard();
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
    const target = event.target;
    const typing = target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' || target.isContentEditable
    );
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); persistNow();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault(); openNewProjectWizard();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault(); openProjectGallery();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && !typing) {
      event.preventDefault();
      document.body.classList.toggle('agent-hidden');
      persistUiState();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !typing) {
      event.preventDefault();
      document.body.classList.remove('sidebar-hidden');
      $id('projectSearch')?.focus();
      persistUiState();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      if (view !== 'settings') A.app.openSettings();
    }
  });

  if (view === 'settings') initSettings();
  else {
    injectStudioChrome();
    installProjectSidebar();
    installProjectGallery();
    initStudio();
  }
})();
