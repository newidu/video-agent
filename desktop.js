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
    const historyButton = ensureSvgButton('btnVersionHistory', 'Version history',
      '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>');
    const historyButton = ensureSvgButton('btnVersionHistory', 'Version history',
      '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>');
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
    header.insertBefore(historyButton, first);
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
    historyButton.onclick = openVersionHistory;
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
        const date = project.lastOpenedAt || project.updatedAt || project.createdAt;
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
      '<div class="wizard-field"><span>Starter structure</span><div class="wizard-formats wizard-templates">' +
      '<button data-template="blank" class="wizard-format selected"><strong>Blank</strong><small>Build from scratch</small></button>' +
      '<button data-template="youtube-intro" class="wizard-format"><strong>YouTube intro</strong><small>Hook · logo · CTA</small></button>' +
      '<button data-template="instagram-story" class="wizard-format"><strong>Instagram Story</strong><small>Vertical story</small></button>' +
      '<button data-template="product-demo" class="wizard-format"><strong>Product demo</strong><small>Problem · proof · CTA</small></button>' +
      '</div></div>' +
      '<div class="wizard-field"><span>Video format</span><div class="wizard-formats">'
      '<button data-format="16:9" class="wizard-format"><span class="format-shape wide"></span><strong>Landscape</strong><small>16:9 · YouTube</small></button>' +
      '<button data-format="9:16" class="wizard-format selected"><span class="format-shape vertical"></span><strong>Portrait</strong><small>9:16 · Shorts / Reels</small></button>' +
      '<button data-format="1:1" class="wizard-format"><span class="format-shape square"></span><strong>Square</strong><small>1:1 · Social</small></button></div></div>' +
      '<div class="new-project-actions"><button id="newProjectCancel" class="icon" title="Cancel">Cancel</button>' +
      '<button id="newProjectCreate" class="wizard-create" disabled><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Create project</span></button></div></section>';
    document.body.appendChild(modal);
    let workspace = await A.project.getWorkspaceInfo();
    let selectedFormat = '9:16';
    let selectedTemplate = 'blank';
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
    modal.querySelectorAll('[data-template]').forEach(button => {
      button.onclick = () => {
        selectedTemplate = button.dataset.template;
        modal.querySelectorAll('[data-template]').forEach(item => item.classList.toggle('selected', item === button));
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
        await createNewProject({ name, format: selectedFormat, template: selectedTemplate });
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

  function installMediaAgentTools() {
    if (window.__AIVA_MEDIA_TOOLS__) return;
    window.__AIVA_MEDIA_TOOLS__ = true;
    const presets = {
      'kinetic-title': {name:'Kinetic title',js:'const p = 0.5 + 0.5 * Math.sin(t * 2.2); ctx.save(); ctx.translate(w/2,h/2); ctx.globalAlpha = 0.65 + p*0.35; ctx.lineWidth = 3; ctx.strokeStyle = "#C65A2E"; ctx.beginPath(); ctx.arc(0,0,Math.min(w,h)*0.22 + p*18,0,Math.PI*2); ctx.stroke(); ctx.restore();'},
      'orbital-rings': {name:'Orbital rings',js:'ctx.save(); ctx.translate(w/2,h/2); for(let i=0;i<4;i++){ const r=Math.min(w,h)*(0.12+i*0.08); ctx.beginPath(); ctx.ellipse(0,0,r,r*0.42,t*0.35+i*0.7,0,Math.PI*2); ctx.lineWidth=3-i*0.4; ctx.strokeStyle=i%2?"#C65A2E":"#171614"; ctx.globalAlpha=0.2+i*0.12; ctx.stroke(); } ctx.restore();'},
      'particle-field': {name:'Particle field',js:'ctx.save(); for(let i=0;i<28;i++){ const x=(i*97%w), y=(i*173%h); const xx=(x+Math.sin(t*0.6+i)*28+w)%w, yy=(y+Math.cos(t*0.7+i)*24+h)%h; ctx.beginPath(); ctx.arc(xx,yy,2+(i%3),0,Math.PI*2); ctx.fillStyle=i%4?"#171614":"#C65A2E"; ctx.globalAlpha=0.35; ctx.fill(); } ctx.restore();'},
      waveform: {name:'Waveform',js:'ctx.save(); ctx.lineWidth=3; ctx.strokeStyle="#C65A2E"; ctx.globalAlpha=0.8; ctx.beginPath(); for(let x=0;x<=w;x+=8){ const y=h/2+Math.sin(x*0.035-t*2)*Math.sin(x*0.011+t)*h*0.12; if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y); } ctx.stroke(); ctx.restore();'},
      'product-spotlight': {name:'Product spotlight',js:'ctx.save(); const r=Math.min(w,h)*0.28; const g=ctx.createRadialGradient(w/2,h/2,2,w/2,h/2,r); g.addColorStop(0,"rgba(198,90,46,0.2)"); g.addColorStop(1,"rgba(198,90,46,0)"); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); ctx.strokeStyle="#C65A2E"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(w/2,h/2,r,0.1+t*0.35,Math.PI*1.6+t*0.35); ctx.stroke(); ctx.restore();'},
      'data-bars': {name:'Data bars',js:'ctx.save(); const vals=[0.45,0.8,0.62,0.95,0.55]; const gap=12, bw=(w-4*gap)/5; vals.forEach((v,i)=>{ const bh=(h*0.62)*v*(0.94+0.06*Math.sin(t*2+i)); const x=i*(bw+gap), y=h-bh; ctx.fillStyle=i===3?"#C65A2E":"#171614"; ctx.globalAlpha=0.78; ctx.fillRect(x,y,bw,bh); }); ctx.restore();'}
    };
    window.AIVA_MOTION_PRESETS = presets;
    const descriptions = {
      generate_captions:'Transcribe the uploaded video and add time-coded, editable subtitle elements.',
      remove_silence:'Detect silent ranges in the uploaded source video using FFmpeg and remove those gaps from its playback timeline.',
      smart_reframe:'Change aspect ratio and pan the source-video crop around a focal point so the subject stays inside the frame.',
      generate_voiceover:'Generate spoken narration from text with the configured TTS API and attach it to the project soundtrack.',
      auto_transitions:'Apply restrained animated entrances and transition sound cues to scene cuts.',
      get_brand_kit:'Read the active brand colours, fonts and logo settings.',
      list_motion_presets:'List reusable JavaScript canvas motion presets.',
      apply_motion_preset:'Add a reusable code-based motion graphic to a selected scene.',
      add_video_comment:'Add an anchored comment at the current playhead time and normalized canvas coordinates.'
    };
    Object.entries(descriptions).forEach(([name,description]) => { TOOL_HELP[name]=description; });

    TOOL_IMPL.get_brand_kit = () => {
      const kit=window.AIVA_BRAND_KIT || (settingsData && settingsData.brandKit) || {};
      return JSON.stringify({name:kit.name||'',primary:kit.primary||'#171614',secondary:kit.secondary||'#F7F6F3',accent:kit.accent||'#C65A2E',headingFont:kit.headingFont||'Inter',bodyFont:kit.bodyFont||'Inter',logoAvailable:!!kit.logoDataUrl,logoPosition:kit.logoPosition||'bottom-right',useLogo:kit.useLogo!==false});
    };
    TOOL_IMPL.list_motion_presets = () => JSON.stringify(Object.values(presets).map(p=>({name:p.name,description:p.description||'Editable JavaScript canvas composition'})));
    TOOL_IMPL.apply_motion_preset = args => {
      const id=String(args && args.preset || 'orbital-rings');
      const preset=presets[id];
      if(!preset)return 'Unknown motion preset. Use list_motion_presets first.';
      const sceneId=String(args && args.sceneId || (SPEC.scenes[0] && SPEC.scenes[0].id) || '');
      const scene=SPEC.scenes.find(item=>item.id===sceneId);
      if(!scene)return 'Build or select a scene first.';
      scene.elements=scene.elements||[];
      scene.elements.push({id:scene.id+'.motion'+(scene.elements.length+1),type:'code',label:preset.name+' · reusable motion',x:W/2,y:H/2,w:W,h:H,js:preset.js,anim:'none',delay:0});
      buildScenes();syncSpec();renderFrame(time);renderPanel();
      return 'Added '+preset.name+' as editable JavaScript canvas code in '+scene.name+'.';
    };
    TOOL_IMPL.auto_transitions = args => {
      const mode=String(args && args.style || 'fade');
      const allowed=['fade','rise','slideL','slideR'];
      const animation=allowed.includes(mode)?mode:'fade';
      const transition=String(args && args.transition || 'fade');
      const transitionTypes=['fade','wipe-left','wipe-right','wipe-up','wipe-down'];
      const transitionType=transitionTypes.includes(transition)?transition:'fade';
      const duration=Math.max(0.25,Math.min(1.5,Number(args && args.duration)||0.45));
      let count=0,sceneCount=0;
      (SPEC.scenes||[]).forEach((scene,sceneIndex)=>{
        if(sceneIndex>0){
          scene.transitionIn={type:transitionType,duration};
          sceneCount++;
        }
        (scene.elements||[]).forEach((element,index)=>{
          if(!element.anim || element.anim==='none'){
            element.anim=animation;element.delay=Math.min(0.12,index*0.035);
            element.dur=duration;count++;
          }
        });
      });
      try{if(window.SFX_API)window.SFX_API.auto({beat:false});}catch(error){}
      buildScenes();syncSpec();renderFrame(time);
      return 'Applied '+animation+' entrance motion to '+count+' elements, '+transitionType+' scene transitions to '+sceneCount+' scene cuts, and subtle cut sound cues. Existing custom element animations were preserved.';
    };
    TOOL_IMPL.smart_reframe = args => {
      const format=String(args && args.format || SPEC.format || '9:16');
      if(!['9:16','16:9','1:1'].includes(format))return 'Choose 9:16, 16:9 or 1:1.';
      const fx=Math.max(0,Math.min(1,Number(args && args.focusX == null ? 0.5 : args.focusX)));
      const fy=Math.max(0,Math.min(1,Number(args && args.focusY == null ? 0.5 : args.focusY)));
      window.TOOLBOX.setFormat(format);
      let clips=0;
      (SPEC.scenes||[]).forEach(scene=>{if(scene.media){scene.media.fit='cover';scene.media.focusX=fx;scene.media.focusY=fy;scene.media.reframeMode='focus';clips++;}});
      buildScenes();syncSpec();renderFrame(time);
      return JSON.stringify({format,focus:{x:fx,y:fy},clips,detail:'The selected focal point is centred in the new crop. focusX/focusY are normalized 0–1 coordinates; default is centre.'});
    };
    TOOL_IMPL.remove_silence = async args => {
      if(!window.AIVA_SOURCE_PATH)return 'No source-file path is available. Re-upload the source clip inside the desktop app, then retry.';
      const result=await A.media.detectSilence({filePath:window.AIVA_SOURCE_PATH,thresholdDb:Number(args && args.thresholdDb)||-35,minimumSeconds:Number(args && args.minimumSeconds)||0.35,paddingSeconds:Number(args && args.paddingSeconds)||0.08,duration:Number(MEDIA.video && MEDIA.video.duration)||0});
      const scene=SPEC.scenes.find(item=>item.media);
      if(!scene)return 'Upload a video clip first so the agent can attach the silence edit to its media scene.';
      if(!result.keepRanges || !result.keepRanges.length)return 'No usable speech segments were found. The source timeline was left unchanged.';
      scene.media.keepRanges=result.keepRanges;scene.media.sourceDuration=result.duration;
      scene.media.silenceCut={thresholdDb:result.thresholdDb,minimumSeconds:result.minimumSeconds};
      scene.dur=+result.keepRanges.reduce((sum,item)=>sum+item.end-item.start,0).toFixed(3);
      buildScenes();syncSpec();setTime(0);renderFrame(time);
      return JSON.stringify({removedSeconds:result.removedSeconds,originalDuration:result.duration,newDuration:scene.dur,removedRanges:result.silences.length,keptRanges:result.keepRanges.length,method:'FFmpeg silencedetect; source media is remapped during preview and export'});
    };
    TOOL_IMPL.generate_captions = async args => {
      if(!window.AIVA_SOURCE_PATH)return 'No source-file path is available. Re-upload the source clip inside the desktop app, then retry.';
      const result=await A.media.transcribe({filePath:window.AIVA_SOURCE_PATH,language:String(args && args.language || 'auto')});
      const scene=SPEC.scenes.find(item=>item.media)||SPEC.scenes[0];
      if(!scene)return 'Build a scene or upload a clip first.';
      const ranges=scene.media && scene.media.keepRanges;
      const sourceToLocal=sourceTime=>{
        if(!Array.isArray(ranges)||!ranges.length)return sourceTime;
        let total=0;
        for(const range of ranges){if(sourceTime>=range.start && sourceTime<=range.end)return total+(sourceTime-range.start);total+=Math.max(0,range.end-range.start);}
        return -1;
      };
      scene.elements=scene.elements||[];
      const width=FORMATS[SPEC.format]?FORMATS[SPEC.format][0]:1080;
      const height=FORMATS[SPEC.format]?FORMATS[SPEC.format][1]:1920;
      const brand=window.AIVA_BRAND_KIT||{};
      let added=0;
      result.segments.forEach((segment,index)=>{
        const start=sourceToLocal(segment.start),end=sourceToLocal(segment.end);
        if(start<0||end<=start||!segment.text)return;
        const text=segment.text.replace(/\s+/g,' ').trim();if(!text)return;
        scene.elements.push({id:scene.id+'.caption'+(scene.elements.length+1),type:'text',label:'Caption '+(index+1),text,
          x:width/2,y:height*0.84,size:Math.max(38,Math.min(58,width*0.045)),color:'#FFFFFF',outline:4,strokeColor:'#171614',
          family:brand.bodyFont||'Inter',weight:700,align:'center',anim:'fade',delay:start,dur:0.22,start,end,fit:true,margin:80});
        added++;
      });
      if(!added)return 'Transcription succeeded but no segments overlapped the current kept timeline.';
      buildScenes();syncSpec();renderFrame(time);
      return JSON.stringify({captionsAdded:added,language:result.language,duration:result.duration,style:'Editable timed text using the active Brand Kit body font'});
    };
    TOOL_IMPL.generate_voiceover = async args => {
      const text=String(args && args.text || '').trim();if(!text)return 'Provide narration text.';
      const result=await A.media.generateVoiceover({text,projectId,voice:args.voice});
      MUSIC.dataUrl=result.dataUrl;MUSIC.name='AI voiceover';MUSIC.on=true;
      MUSIC.volume=Math.max(0,Math.min(1,Number(args && args.volume)||0.85));MUSIC.dur=0;
      hookMusicAudio();applyMusic(true);if(typeof setMusicOn==='function')setMusicOn(true);
      scheduleSave();
      return JSON.stringify({voiceover:'generated',file:result.file,bytes:result.bytes,mime:result.mime,syncedToProjectPlayhead:true});
    };
    TOOL_IMPL.add_video_comment = args => {
      const comment={
        id:'c_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
        text:String(args && args.text || '').slice(0,1200),
        time:Math.max(0,Math.min(DUR,Number(args && args.time == null ? time : args.time))),
        x:Math.max(0,Math.min(1,Number(args && args.x == null ? 0.5 : args.x))),
        y:Math.max(0,Math.min(1,Number(args && args.y == null ? 0.5 : args.y))),
        createdAt:Date.now(),resolved:false
      };
      if(!comment.text)return 'A comment needs text.';
      projectComments.push(comment);renderCommentMarkers();scheduleSave();return JSON.stringify(comment);
    };
    const previousSchema=window.toolSchema;
    if(previousSchema && !window.__AIVA_SCHEMA_EXTENDED__){
      window.__AIVA_SCHEMA_EXTENDED__=true;
      window.toolSchema=function(){
        const schema=previousSchema.apply(this,arguments);
        const extras={
          generate_captions:{type:'object',properties:{language:{type:'string'}},required:[]},
          remove_silence:{type:'object',properties:{thresholdDb:{type:'number'},minimumSeconds:{type:'number'},paddingSeconds:{type:'number'}},required:[]},
          smart_reframe:{type:'object',properties:{format:{type:'string',enum:['9:16','16:9','1:1']},focusX:{type:'number'},focusY:{type:'number'}},required:['format']},
          generate_voiceover:{type:'object',properties:{text:{type:'string'},voice:{type:'string'},volume:{type:'number'}},required:['text']},
          auto_transitions:{type:'object',properties:{style:{type:'string',enum:['fade','rise','slideL','slideR']},transition:{type:'string',enum:['fade','wipe-left','wipe-right','wipe-up','wipe-down']},duration:{type:'number'}},required:[]},
          apply_motion_preset:{type:'object',properties:{preset:{type:'string',enum:Object.keys(presets)},sceneId:{type:'string'}},required:['preset']},
          add_video_comment:{type:'object',properties:{text:{type:'string'},time:{type:'number'},x:{type:'number'},y:{type:'number'}},required:['text']}
        };
        return schema.concat(Object.keys(extras).filter(name=>TOOL_IMPL[name]).map(name=>({type:'function',function:{name,description:TOOL_HELP[name]||name,parameters:extras[name]}})));
      };
    }
    const previousPrompt=window.systemPrompt;
    if(previousPrompt && !window.__AIVA_BRAND_PROMPT__){
      window.__AIVA_BRAND_PROMPT__=true;
      window.systemPrompt=function(){
        let prompt=previousPrompt.apply(this,arguments);
        const kit=window.AIVA_BRAND_KIT||{};
        if(kit.name||kit.primary||kit.logoDataUrl){
          prompt+='\n\nBRAND KIT (REQUIRED FOR ALL NEW SCENES):\nBrand: '+(kit.name||'unnamed')+
            '\nPrimary: '+(kit.primary||'#171614')+'\nSecondary: '+(kit.secondary||'#F7F6F3')+
            '\nAccent: '+(kit.accent||'#C65A2E')+'\nHeading font: '+(kit.headingFont||'Inter')+
            '\nBody font: '+(kit.bodyFont||'Inter')+'\nLogo available: '+(kit.logoDataUrl?'yes, persistent app overlay':'no')+
            '\nUse these exact colours and fonts consistently; do not invent a competing palette.';
        }
        if(projectTemplate && projectTemplate!=='blank'){
          const templateBrief={
            'youtube-intro':'Structure: 0–2s attention hook; 2–5s channel/logo reveal; 5–8s concise promise and CTA. Use a strong opening frame, editable kinetic typography and a clean logo hold.',
            'instagram-story':'Structure: 0–2s vertical hook; 2–7s one clear story beat; 7–11s proof or benefit; 11–15s CTA. Keep all important text inside mobile safe areas.',
            'product-demo':'Structure: problem; product reveal; 2–3 concrete features; proof/result; final CTA. Show real product details only when provided and avoid fabricated claims.'
          };
          prompt+='\n\nSTARTER TEMPLATE: '+projectTemplate+'. '+(templateBrief[projectTemplate]||'Use a short editable structure with a clear opening, main message and close.')+' These are editable scaffolds, not locked templates. Replace every scene as needed to match the user brief.';
        }
        if(settingsData && settingsData.integrations && settingsData.integrations.motionLibrary){
          prompt+='\n\nMOTION LIBRARY: Use apply_motion_preset when reusable code animation is helpful. Existing code elements run JavaScript on the native canvas; keep code deterministic, performant and editable. Do not claim unavailable Lottie or Three.js rendering.';
        }
        return prompt;
      };
    }
    const previousRun=window.runAgent;
    if(previousRun && !window.__AIVA_VERSION_WRAPPER__){
      window.__AIVA_VERSION_WRAPPER__=true;
      window.runAgent=async function(){
        const before=JSON.stringify(window.SPEC||{});
        const result=await previousRun.apply(this,arguments);
        if(projectId && !window.__EXPORTING){
          const after=JSON.stringify(window.SPEC||{});
          if(before!==after){
            try{await A.project.createVersion(projectId,String(arguments[0]||'AI iteration').slice(0,100),currentProjectData());}
            catch(error){console.warn('Could not create project version',error);}
            renderProjectSidebar();
          }
        }
        return result;
      };
    }
  }

  function applyAivaBrandKit(kit) {
    window.AIVA_BRAND_KIT = kit || {};
    if(!kit || !kit.logoDataUrl || kit.useLogo===false){
      brandImage=null;brandImageSource='';
      window.AIVA_DRAW_BRAND_LOGO=()=>{};
      try { if(typeof window.setTime==='function') window.setTime(time); } catch(error){}
      return;
    }
    if(brandImageSource===kit.logoDataUrl && brandImage){
      try { if(typeof window.setTime==='function') window.setTime(time); } catch(error){}
      return;
    }
    brandImageSource=kit.logoDataUrl;
    const img=new Image();
    img.onload=()=>{
      brandImage=img;
      try{if(typeof window.setTime==='function')window.setTime(time);else if(typeof window.renderFrame==='function')window.renderFrame(time);}catch(error){}
    };
    img.onerror=()=>{brandImage=null;console.warn('Brand logo could not be decoded.');};
    img.src=kit.logoDataUrl;
    window.AIVA_DRAW_BRAND_LOGO=()=>{
      const active=window.AIVA_BRAND_KIT||{};
      const canvas=$id('stage');
      if(!brandImage||!canvas||active.useLogo===false||!brandImage.complete||!brandImage.naturalWidth)return;
      const context=canvas.getContext('2d');
      const maxW=canvas.width*0.13,maxH=canvas.height*0.08;
      const scale=Math.min(maxW/brandImage.naturalWidth,maxH/brandImage.naturalHeight);
      const w=brandImage.naturalWidth*scale,h=brandImage.naturalHeight*scale;
      const pad=Math.min(canvas.width,canvas.height)*0.035;
      const position=active.logoPosition||'bottom-right';
      const x=position.includes('left')?pad:canvas.width-w-pad;
      const y=position.includes('top')?pad:canvas.height-h-pad;
      context.save();context.globalAlpha=0.94;context.drawImage(brandImage,x,y,w,h);context.restore();
    };
  }
  window.applyAivaBrandKit = applyAivaBrandKit;

  async function openVersionHistory() {
    if (!projectId) { status('Create or open a project first.'); return; }
    let modal=$id('versionHistoryModal');
    if(modal){modal.remove();return;}
    modal=document.createElement('div');
    modal.id='versionHistoryModal';
    modal.className='aiva-modal-backdrop';
    modal.innerHTML='<section class="aiva-modal"><header><div><strong>Version history</strong><small>Restore a previous AI iteration or create a checkpoint.</small></div><button id="closeVersionHistory" class="icon" title="Close">×</button></header><div class="version-actions"><button id="createVersionNow" class="primary">Create checkpoint</button></div><div id="versionList" class="version-list">Loading versions…</div></section>';
    document.body.appendChild(modal);
    $id('closeVersionHistory').onclick=()=>modal.remove();
    modal.addEventListener('pointerdown',event=>{if(event.target===modal)modal.remove();});
    $id('createVersionNow').onclick=async()=>{
      try{
        await persistNow();
        await A.project.createVersion(projectId,'Manual checkpoint',currentProjectData());
        await loadVersions();
        settingsStatus('Checkpoint saved',true);
      }catch(error){status('Version save failed · '+error.message);}
    };
    async function loadVersions(){
      const list=await A.project.listVersions(projectId);
      const host=$id('versionList');
      host.innerHTML='';
      if(!list.length){host.innerHTML='<div class="history-empty">No saved versions yet. Versions are created after successful agent edits.</div>';return;}
      list.forEach(version=>{
        const row=document.createElement('div');
        row.className='version-row';
        const details=document.createElement('div');
        details.innerHTML='<strong></strong><small></small>';
        details.querySelector('strong').textContent=version.label||'Version';
        details.querySelector('small').textContent=new Date(version.createdAt).toLocaleString();
        const restore=document.createElement('button');
        restore.type='button';restore.textContent='Restore';
        restore.onclick=async()=>{
          if(!window.confirm('Restore this version? The current project will first be saved as a checkpoint.'))return;
          try{
            await persistNow();
            await A.project.createVersion(projectId,'Before restore · '+(projectName||'Project'),currentProjectData());
            const snapshot=await A.project.restoreVersion(projectId,version.id);
            applyProjectData(snapshot);
            projectId=snapshot.id;projectName=snapshot.name||projectName;
            renderStoredChat();updateProjectTitle();renderCommentMarkers();renderProjectSidebar();
            status('Restored · '+version.label);
            modal.remove();
          }catch(error){status('Restore failed · '+error.message);}
        };
        row.append(details,restore);host.appendChild(row);
      });
    }
    try{await loadVersions();}catch(error){$id('versionList').textContent='Could not load history · '+error.message;}
  }

  function renderCommentMarkers() {
    const host=$id('commentMarkers');
    if(!host)return;
    host.innerHTML='';
    projectComments.forEach((comment,index)=>{
      const marker=document.createElement('button');
      marker.type='button';marker.className='video-comment-marker'+(comment.resolved?' resolved':'');
      marker.textContent=String(index+1);
      marker.title=(comment.text||'Comment')+' · '+Number(comment.time||0).toFixed(2)+'s';
      marker.style.left=(Math.max(0,Math.min(1,Number(comment.x)||0.5))*100)+'%';
      marker.style.top=(Math.max(0,Math.min(1,Number(comment.y)||0.5))*100)+'%';
      marker.onclick=event=>{
        event.stopPropagation();
        const resolve=window.confirm((comment.text||'Comment')+'\\n\\nTime: '+Number(comment.time||0).toFixed(2)+'s\\n\\nMark this comment as resolved?');
        if(resolve){comment.resolved=!comment.resolved;renderCommentMarkers();scheduleSave();}
      };
      host.appendChild(marker);
    });
  }

  function installCommentLayer() {
    const inner=$id('stageInner');
    const stage=$id('stage');
    const bar=document.querySelector('.transport');
    if(!inner||!stage||!bar||$id('btnCommentMode'))return;
    inner.style.position='relative';
    const markers=document.createElement('div');
    markers.id='commentMarkers';markers.className='comment-markers';
    inner.appendChild(markers);
    const commentButton=ensureSvgButton('btnCommentMode','Add comment to paused frame',
      '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-1 2v-5.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8M8 14h5"/>');
    const listButton=ensureSvgButton('btnCommentsList','Show video comments',
      '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 12h8M8 15h5"/>');
    bar.append(commentButton,listButton);
    commentButton.onclick=()=>{
      commentMode=!commentMode;
      commentButton.classList.toggle('active',commentMode);
      commentButton.title=commentMode?'Click a point on the paused video to add a comment':'Add comment to paused frame';
      if(commentMode){pause();status('Comment mode · click a point on the video.');}
      else status('');
    };
    listButton.onclick=()=>{
      let panel=$id('commentsPanel');
      if(panel){panel.remove();return;}
      panel=document.createElement('div');panel.id='commentsPanel';panel.className='comments-panel';
      panel.innerHTML='<header><strong>Video comments</strong><button id="closeComments" class="icon" title="Close">×</button></header><div id="commentsList"></div>';
      document.body.appendChild(panel);
      $id('closeComments').onclick=()=>panel.remove();
      const list=$id('commentsList');
      if(!projectComments.length)list.textContent='No comments yet. Pause the video, choose the comment icon and click on the frame.';
      projectComments.forEach(comment=>{
        const row=document.createElement('button');row.className='comment-list-row';
        const body=document.createElement('span');body.textContent=comment.text;
        const timeLabel=document.createElement('small');timeLabel.textContent=Number(comment.time||0).toFixed(2)+'s';
        row.append(body,timeLabel);
        row.onclick=()=>{pause();setTime(Number(comment.time)||0);panel.remove();};
        list.appendChild(row);
      });
    };
    stage.addEventListener('pointerdown',event=>{
      if(!commentMode)return;
      event.stopImmediatePropagation();
    },true);
    stage.addEventListener('click',event=>{
      if(!commentMode)return;
      event.preventDefault();event.stopImmediatePropagation();
      const rect=stage.getBoundingClientRect();
      const x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
      const y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
      openCommentComposer(x,y);
    },true);
    renderCommentMarkers();
  }

  function openCommentComposer(x,y) {
    let modal=$id('commentComposer');
    if(modal)modal.remove();
    modal=document.createElement('div');
    modal.id='commentComposer';modal.className='aiva-modal-backdrop';
    modal.innerHTML='<section class="aiva-modal comment-modal"><header><div><strong>Comment on this frame</strong><small>Paused at '+Number(time).toFixed(2)+' seconds.</small></div><button id="commentClose" class="icon" title="Close">×</button></header><textarea id="commentText" rows="4" placeholder="Describe what should change at this point…"></textarea><div class="version-actions"><button id="commentCancel">Cancel</button><button id="commentSave" class="primary">Add comment</button></div></section>';
    document.body.appendChild(modal);
    const close=()=>{modal.remove();commentMode=false;$id('btnCommentMode')?.classList.remove('active');};
    $id('commentClose').onclick=close;$id('commentCancel').onclick=close;
    $id('commentSave').onclick=()=>{
      const text=$id('commentText').value.trim();if(!text)return;
      projectComments.push({id:'c_'+Date.now(),text,time:Number(time)||0,x,y,createdAt:Date.now(),resolved:false});
      renderCommentMarkers();scheduleSave();close();status('Comment added to frame.');
    };
    $id('commentText').focus();
  }

  function installProjectHistoryUI() {
    // The runAgent wrapper in installMediaAgentTools stores an editable checkpoint after each successful AI edit.
    if ($id('btnVersionHistory')) $id('btnVersionHistory').onclick=openVersionHistory;
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
      refreshProperties();
    };
    const refreshProperties = () => {
      const panel=$id('editPane');
      const selected=typeof SELECTED!=='undefined' && !!SELECTED;
      if(panel) panel.classList.toggle('is-open',selected);
    };
    if ($id('stage')) {
      $id('stage').addEventListener('pointerup', () => requestAnimationFrame(() => { refreshSelection(); refreshProperties(); }));
      $id('stage').addEventListener('dblclick', () => requestAnimationFrame(() => { refreshSelection(); refreshProperties(); }));
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') requestAnimationFrame(() => { refreshSelection(); refreshProperties(); });
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
    const applyThemeMode = () => {
      const systemDark=value.mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = value.mode === 'dark' || systemDark ? 'dark' : 'light';
    };
    applyThemeMode();
    if(value.mode==='system' && !window.__AIVA_SYSTEM_THEME_LISTENER__ && window.matchMedia){
      const media=window.matchMedia('(prefers-color-scheme: dark)');
      const listener=()=>applyThemeMode();
      if(media.addEventListener)media.addEventListener('change',listener);
      else if(media.addListener)media.addListener(listener);
      window.__AIVA_SYSTEM_THEME_LISTENER__=listener;
    }
    root.dataset.motion = value.reduceMotion ? 'reduced' : 'normal';
    root.dataset.density = value.density === 'compact' ? 'compact' : 'comfortable';
    root.style.setProperty('--accent', value.accent || '#C65A2E');
    if (value.mode === 'custom') {
      const customTokens = {
        '--bg':value.bg||'#F7F6F3','--paper':value.paper||'#FFFFFF','--paper-2':value.paper2||'#F0EFEB',
        '--ink':value.ink||'#171614','--ink-2':value.ink2||'#45423E','--muted':value.muted||'#85817B',
        '--line':value.line||'#E5E2DC','--line-2':value.line2||'#D4D0C8',
        '--rail':value.rail||'#FBFAF8','--rail-ink':value.railInk||'#171614'
      };
      Object.entries(customTokens).forEach(([token,color])=>root.style.setProperty(token,color));
    } else {
      ['--bg','--paper','--paper-2','--ink','--ink-2','--muted','--line','--line-2','--rail','--rail-ink'].forEach(token=>root.style.removeProperty(token));
    }
    if(value.fontUi)root.style.setProperty('--font-ui',value.fontUi);
    if(value.fontMono)root.style.setProperty('--font-mono',value.fontMono);
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
    if (['get_project','replace_spec','verify_video'].indexOf(name) >= 0) return 'on';
    const integrations=settingsData && settingsData.integrations || {};
    const gated={generate_captions:'captions',generate_voiceover:'tts',remove_silence:'ffmpeg',list_motion_presets:'motionLibrary',apply_motion_preset:'motionLibrary'};
    const gate=gated[name];
    if(gate){
      const available = gate === 'ffmpeg'
        ? ffmpegAvailable && integrations.ffmpeg !== false
        : gate === 'captions'
          ? Boolean(integrations.captions && integrations.captions.enabled && integrations.captions.tested)
          : gate === 'tts'
            ? Boolean(integrations.tts && integrations.tts.enabled && integrations.tts.tested)
            : gate === 'motionLibrary'
              ? integrations.motionLibrary !== false
              : false;
      if (!available) return 'off';
    }
    if (toolStates[name]) return toolStates[name];
    return gate ? 'on' : 'lazy';
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
        const mediaScene=(SPEC.scenes||[]).find(scene=>scene.media);
        const session = await A.export.begin({
          fps:fps,duration:duration,ext:'jpg',
          audioDataUrl:musicData,
          audioVolume:MUSIC && MUSIC.volume != null ? MUSIC.volume : 0.8,
          sourceVideoPath:window.AIVA_SOURCE_PATH || null,
          keepRanges:mediaScene && mediaScene.media && mediaScene.media.keepRanges || null
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
        async function seekSourceVideoFrame(projectTime) {
          const scene=(window.SCENES||[]).find(item=>projectTime>=item.in && projectTime<item.out);
          const video=window.MEDIA && window.MEDIA.video;
          if(!scene || !scene.spec || !scene.spec.media || !video || !window.MEDIA.ready) {
            if(window.MEDIA && window.MEDIA.video && (!scene || !scene.spec || !scene.spec.media)) {
              try{window.MEDIA.video.pause();window.MEDIA.scene=null;}catch(error){}
            }
            setTime(projectTime);
            await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
            return;
          }
          const localTime=projectTime-scene.in;
          const sourceTime=typeof window.sourceTimeForMedia==='function'
            ? window.sourceTimeForMedia(scene.spec.media,localTime)
            : Math.max(0,localTime);
          try{video.pause();}catch(error){}
          if(Math.abs((video.currentTime||0)-sourceTime)>0.015) {
            await new Promise((resolve,reject)=>{
              let settled=false;
              const finish=error=>{
                if(settled)return;settled=true;
                clearTimeout(timer);video.removeEventListener('seeked',onSeeked);
                video.removeEventListener('error',onError);
                if(error)reject(error);else resolve();
              };
              const onSeeked=()=>finish();
              const onError=()=>finish(new Error('The source video could not decode a frame at '+sourceTime.toFixed(2)+'s.'));
              const timer=setTimeout(()=>finish(new Error('Timed out while decoding source video frame '+sourceTime.toFixed(2)+'s.')),2500);
              video.addEventListener('seeked',onSeeked,{once:true});
              video.addEventListener('error',onError,{once:true});
              try{video.currentTime=sourceTime;}catch(error){finish(error);}
            });
          }
          window.MEDIA.scene=scene.id;
          setTime(projectTime);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }
        for (let index = 0; index < frameCount; index++) {
          if (window.EXPORT_CANCEL) throw new Error('Export cancelled.');
          const frameTime = index / fps;
          await seekSourceVideoFrame(frameTime);
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
        window.EXPORT_MODE = false;
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
      settingRow('Secondary surface','Toolbar, hover and secondary card surface.',
        '<input id="settingPaper2" type="color" value="' + escapeHtml(value.paper2 || '#F0EFEB') + '">') +
      settingRow('Secondary text','Labels and supporting text.',
        '<input id="settingInk2" type="color" value="' + escapeHtml(value.ink2 || '#45423E') + '">') +
      settingRow('Muted text','Hints, timestamps and secondary labels.',
        '<input id="settingMuted" type="color" value="' + escapeHtml(value.muted || '#85817B') + '">') +
      settingRow('Borders','Dividers and subtle outlines.',
        '<input id="settingLine" type="color" value="' + escapeHtml(value.line || '#E5E2DC') + '">') +
      settingRow('Strong borders','Active outlines and controls.',
        '<input id="settingLine2" type="color" value="' + escapeHtml(value.line2 || '#D4D0C8') + '">') +
      settingRow('Sidebar surface','Project navigation surface.',
        '<input id="settingRail" type="color" value="' + escapeHtml(value.rail || '#FBFAF8') + '">') +
      settingRow('Sidebar text','Project navigation text.',
        '<input id="settingRailInk" type="color" value="' + escapeHtml(value.railInk || '#171614') + '">') +
      settingRow('UI font family','Use a font installed on this Windows PC.',
        '<input id="settingFontUi" class="wide-input" value="' + escapeHtml(value.fontUi || 'Inter, Segoe UI, system-ui, sans-serif') + '">') +
      settingRow('Monospace font','Timecodes and technical values.',
        '<input id="settingFontMono" class="wide-input" value="' + escapeHtml(value.fontMono || 'Geist Mono, Consolas, monospace') + '">') +
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
      settingCard('Theme sharing','Export a reusable theme JSON or import one shared by another person.',
        '<div class="setting-actions"><button id="exportTheme">Export theme JSON</button><button id="importTheme">Import theme JSON</button></div>') +
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
        paper2:$id('settingPaper2').value,ink2:$id('settingInk2').value,muted:$id('settingMuted').value,
        line:$id('settingLine').value,line2:$id('settingLine2').value,rail:$id('settingRail').value,
        railInk:$id('settingRailInk').value,fontUi:$id('settingFontUi').value,fontMono:$id('settingFontMono').value,
        fontScale:Number($id('settingFont').value),density:$id('settingDensity').value,
        reduceMotion:$id('settingMotion').checked,windowMaterial:$id('settingMaterial').value
      };
      try {
        settingsData.appearance = await A.settings.saveAppearance(next);
        applyAppearance(settingsData.appearance);
        settingsStatus('Saved',true);
      } catch (error) { settingsStatus(error.message,false); }
    };
    ['settingTheme','settingAccent','settingBg','settingPaper','settingInk','settingPaper2','settingInk2','settingMuted','settingLine','settingLine2','settingRail','settingRailInk','settingFontUi','settingFontMono','settingFont','settingDensity','settingMotion','settingMaterial'].forEach(id =>
      $id(id).addEventListener('change',save));
    $id('exportTheme').onclick=async()=>{
      try{
        const result=await A.theme.exportFile();
        if(result && result.saved)settingsStatus('Theme exported · '+result.path,true);
      }catch(error){settingsStatus(error.message,false);}
    };
    $id('importTheme').onclick=async()=>{
      try{
        const result=await A.theme.importFile();
        if(result && result.imported){
          settingsData.appearance=result.appearance;
          applyAppearance(result.appearance);
          renderAppearance();
          settingsStatus('Theme imported · all appearance tokens updated',true);
        }
      }catch(error){settingsStatus(error.message,false);}
    };
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
    const integrations = settingsData.integrations || {};
    const gates = {
      generate_captions:'captions',
      generate_voiceover:'tts',
      remove_silence:'ffmpeg',
      list_motion_presets:'motionLibrary',
      apply_motion_preset:'motionLibrary'
    };
    const rows = names.map(name => {
      const gate = gates[name];
      const unavailable = !!gate && !(gate === 'ffmpeg'
        ? ffmpegAvailable && integrations.ffmpeg !== false
        : gate === 'captions'
          ? Boolean(integrations.captions && integrations.captions.enabled && integrations.captions.tested)
          : gate === 'tts'
            ? Boolean(integrations.tts && integrations.tts.enabled && integrations.tts.tested)
            : gate === 'motionLibrary'
              ? integrations.motionLibrary !== false
              : false);
      const value = core.indexOf(name) >= 0 ? 'on' : unavailable ? 'off' : (state[name] || (gate ? 'on' : 'lazy'));
      const description = (TOOL_HELP[name] || '').split(/(?<=\.)\s/)[0].slice(0,100);
      return '<div class="settings-list-row"><div><strong>' + escapeHtml(name) + '</strong><small>' +
        escapeHtml(description) + (unavailable ? ' · Enable and test its integration first.' : '') + '</small></div><select data-tool="' + escapeHtml(name) + '"' +
        (core.indexOf(name) >= 0 || unavailable ? ' disabled':'') + '><option value="on">On</option><option value="lazy">Lazy</option><option value="off">Off</option></select></div>';
    }).join('');
    $id('settingsContent').innerHTML = settingCard('Agent tool access',
      'On tools are always available. Lazy tools are discovered using find_tools. Off tools are removed from the schema and blocked when called.',
      '<div class="setting-actions"><button id="toolsAll">All on</button><button id="toolsLazy">All lazy</button><button id="toolsNone">All off</button><button id="toolsCore">Core only</button></div>' +
      '<div class="settings-list" id="toolsList">' + rows + '</div><div class="setting-actions"><button id="toolsSave" class="primary">Save tool settings</button></div>');
    document.querySelectorAll('[data-tool]').forEach(select => {
      if (!select.disabled) select.value = state[select.dataset.tool] || (gates[select.dataset.tool] ? 'on' : 'lazy');
      else select.value = 'off';
    });
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
        settingRow('Enable FFmpeg export','Use the bundled native encoder for MP4 export and silence processing.',
          '<input id="intFfmpegOn" type="checkbox"' + (info.ffmpeg !== false && ffmpegAvailable ? ' checked' : '') + (ffmpegAvailable ? '' : ' disabled title="Bundled FFmpeg binary is unavailable"') + '>') +
        settingRow('Motion code library','Reusable canvas-code presets and agent-authored motion graphics.',
          '<input id="intMotionLibrary" type="checkbox"' + (info.motionLibrary !== false?' checked':'') + '>') +
        '<div class="setting-actions"><button id="saveIntegrations" class="primary">Save integration switches</button></div>')];
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
          ffmpeg:$id('intFfmpegOn').checked,
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
        settingRow('Install a font','Load a TTF, OTF or WOFF file into this project, then enter its family name above.','<button id="brandImportFont" type="button">Import font file</button>') +
        settingRow('Logo','Optional transparent PNG, JPEG or SVG file.','<input id="brandLogo" type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml">') +
        settingRow('Logo position','Choose where the logo appears in the output.','<select id="brandLogoPosition"><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select>') +
        settingRow('Show logo in all scenes','Persistent branding overlay.','<input id="brandUseLogo" type="checkbox"' + (brand.useLogo!==false?' checked':'') + '>') +
        '<div class="setting-actions"><button id="brandSave" class="primary">Save Brand Kit</button></div>');
    $id('brandLogoPosition').value=brand.logoPosition||'bottom-right';
    $id('brandImportFont').onclick=()=>{
      if($id('fontIn'))$id('fontIn').click();
      settingsStatus('Choose a local font file. After it is imported, enter its family name in the heading/body field.',true);
    };
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
