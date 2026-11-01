'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, nativeTheme, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const APP_NAME = 'AI Video Agent';
const ROOT = __dirname;
const DATA = () => app.getPath('userData');
const CONFIG = () => path.join(DATA(), 'config');
const PROJECTS = () => path.join(DATA(), 'projects');
const JOBS = new Map();
let mainWindow = null;
let settingsWindow = null;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}

function configFile(name) {
  return path.join(CONFIG(), name + '.json');
}

function readConfig(name, fallback) {
  return readJson(configFile(name), fallback);
}

async function writeConfig(name, value) {
  return writeJsonAtomic(configFile(name), value);
}

function readSecrets() {
  const file = path.join(CONFIG(), 'secrets.bin');
  try {
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  } catch {
    return {};
  }
}

async function writeSecrets(secrets) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure key storage is unavailable. Check your Windows user profile and DPAPI configuration.');
  }
  await fsp.mkdir(CONFIG(), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
  const file = path.join(CONFIG(), 'secrets.bin');
  const temp = file + '.' + randomUUID() + '.tmp';
  await fsp.writeFile(temp, encrypted);
  await fsp.rename(temp, file);
}

function cleanProvider(input) {
  const id = String(input.id || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const baseUrl = String(input.base_url || '').trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('Enter a valid provider Base URL.'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Provider URLs must use HTTP or HTTPS.');
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('HTTP is allowed only for localhost providers. Use HTTPS for remote providers.');
  }
  return {
    id,
    name: String(input.name || parsed.hostname).trim().slice(0, 80) || parsed.hostname,
    base_url: baseUrl,
    models: Array.isArray(input.models) ? input.models.map(String).slice(0, 300) : [],
    enabled_models: Array.isArray(input.enabled_models) ? input.enabled_models.map(String).slice(0, 300) : [],
    headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
    createdAt: Number(input.createdAt) || Date.now()
  };
}

function getFfmpegPath() {
  try {
    const resolved = require('ffmpeg-static');
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {}
  return null;
}

function makeWindowOptions(kind) {
  const isWindows = process.platform === 'win32';
  const releaseParts = os.release().split('.').map(Number);
  const isWin11 = isWindows && releaseParts[0] >= 10 && (releaseParts[2] || 0) >= 22621;
  const settings = kind === 'settings';
  const base = {
    width: settings ? 720 : 1440,
    height: settings ? 640 : 900,
    minWidth: settings ? 600 : 960,
    minHeight: settings ? 520 : 640,
    title: settings ? 'Settings · ' + APP_NAME : APP_NAME,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: isWin11 ? '#00000000' : '#F7F7F5',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  };
  if (isWin11) {
    base.backgroundMaterial = settings ? 'acrylic' : 'mica';
    base.transparent = true;
  } else if (process.platform === 'darwin') {
    base.vibrancy = 'under-window';
    base.visualEffectState = 'active';
  }
  return base;
}

function loadAppWindow(win, view) {
  win.loadFile(path.join(ROOT, 'index.html'), { query: view ? { view } : {} });
}

function createMainWindow() {
  mainWindow = new BrowserWindow(makeWindowOptions('main'));
  loadAppWindow(mainWindow, 'studio');
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    ...makeWindowOptions('settings'),
    parent: mainWindow || undefined,
    modal: false
  });
  loadAppWindow(settingsWindow, 'settings');
  settingsWindow.once('ready-to-show', () => settingsWindow && settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New project', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-project') },
        { label: 'Open project gallery', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:home') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettingsWindow },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Light theme', click: () => mainWindow?.webContents.send('menu:theme', 'light') },
        { label: 'Dark theme', click: () => mainWindow?.webContents.send('menu:theme', 'dark') },
        { label: 'System theme', click: () => mainWindow?.webContents.send('menu:theme', 'system') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function safeProjectId(id) {
  const value = String(id || '');
  if (!/^prj_[a-zA-Z0-9_-]{4,80}$/.test(value)) throw new Error('Invalid project identifier.');
  return value;
}

function workspaceRoot() {
  const saved = readConfig('workspace', { root: null });
  if (saved && typeof saved.root === 'string' && path.isAbsolute(saved.root)) return saved.root;
  return path.join(app.getPath('documents'), 'AI Video Agent Projects');
}

function projectIndex() {
  return readConfig('project-index', {});
}

function projectDirectory(id) {
  const projectId = safeProjectId(id);
  const indexed = projectIndex()[projectId];
  if (typeof indexed === 'string' && path.isAbsolute(indexed)) return indexed;
  return path.join(PROJECTS(), projectId);
}

function projectFile(id) {
  const projectId = safeProjectId(id);
  const indexed = projectIndex()[projectId];
  if (typeof indexed === 'string' && path.isAbsolute(indexed)) {
    return path.join(indexed, 'project.json');
  }
  const legacy = path.join(PROJECTS(), projectId + '.json');
  if (fs.existsSync(legacy)) return legacy;
  return path.join(PROJECTS(), projectId, 'project.json');
}

async function writeProjectIndex(id, directory) {
  const index = projectIndex();
  index[safeProjectId(id)] = directory;
  await writeConfig('project-index', index);
}

async function saveNewProject(project) {
  const directory = path.join(workspaceRoot(), safeProjectId(project.id));
  await fsp.mkdir(directory, { recursive: true });
  await writeProjectIndex(project.id, directory);
  await writeJsonAtomic(path.join(directory, 'project.json'), project);
  return project;
}

async function ensureProjectStorage(project) {
  const file = projectFile(project.id);
  if (!fs.existsSync(file)) {
    const directory = path.join(workspaceRoot(), safeProjectId(project.id));
    await fsp.mkdir(directory, { recursive: true });
    await writeProjectIndex(project.id, directory);
    return path.join(directory, 'project.json');
  }
  return file;
}

function makeProject(name) {
  const id = 'prj_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 6);
  return {
    id,
    name: String(name || 'Untitled project').trim().slice(0, 100) || 'Untitled project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    format: { width: 1920, height: 1080, fps: 30 },
    duration: 15,
    playhead: 0,
    background: '#111111',
    items: [],
    chat: [],
    showBeats: false,
    playbackSpeed: 1
  };
}

async function projectList() {
  await fsp.mkdir(PROJECTS(), { recursive: true });
  await fsp.mkdir(workspaceRoot(), { recursive: true });
  const found = new Map();
  const index = projectIndex();

  for (const [id, directory] of Object.entries(index)) {
    if (!/^prj_[a-zA-Z0-9_-]{4,80}$/.test(id) || typeof directory !== 'string' || !path.isAbsolute(directory)) continue;
    const project = readJson(path.join(directory, 'project.json'), null);
    if (project && project.id === id) {
      found.set(id, project);
    }
  }

  // Read older releases that stored project JSON files directly under userData/projects.
  const entries = await fsp.readdir(PROJECTS(), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^prj_[\w-]+\.json$/.test(entry.name)) continue;
    const project = readJson(path.join(PROJECTS(), entry.name), null);
    if (project && project.id && !found.has(project.id)) found.set(project.id, project);
  }

  return Array.from(found.values()).map(project => ({
    id: project.id,
    name: project.name || 'Untitled project',
    updatedAt: project.updatedAt || 0,
    createdAt: project.createdAt || 0,
    lastOpenedAt: project.lastOpenedAt || 0,
    location: projectDirectory(project.id),
    thumbnail: project.thumbnail || null,
    format: project.spec?.format || null,
    duration: project.duration || null
  })).sort((a, b) => (b.updatedAt || b.lastOpenedAt) - (a.updatedAt || a.lastOpenedAt));
}

function validateProject(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid project data.');
  const id = safeProjectId(input.id);
  const format = input.format || {};
  const width = Math.max(320, Math.min(3840, Number(format.width) || 1920));
  const height = Math.max(320, Math.min(3840, Number(format.height) || 1080));
  const fps = Math.max(12, Math.min(60, Number(format.fps) || 30));
  return {
    ...input,
    id,
    name: String(input.name || 'Untitled project').slice(0, 100),
    format: { width, height, fps },
    duration: Math.max(1, Math.min(120, Number(input.duration) || 15)),
    playhead: Math.max(0, Math.min(120, Number(input.playhead) || 0)),
    background: /^#[0-9a-fA-F]{6}$/.test(input.background) ? input.background : '#111111',
    items: input.items && typeof input.items === 'object' ? input.items : [],
    edit: input.edit && typeof input.edit === 'object' ? input.edit : undefined,
    chat: Array.isArray(input.chat) ? input.chat.slice(-300) : [],
    updatedAt: Date.now()
  };
}

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
  userData: DATA(),
  ffmpegAvailable: Boolean(getFfmpegPath()),
  materialSupported: process.platform === 'win32' && (Number(os.release().split('.')[2]) || 0) >= 22621
}));

ipcMain.handle('window:settings', () => { openSettingsWindow(); return true; });
ipcMain.handle('window:reveal-data', async () => { await shell.openPath(DATA()); return DATA(); });

ipcMain.handle('projects:get-root', () => workspaceRoot());
ipcMain.handle('projects:get-workspace-info', () => {
  const saved = readConfig('workspace', { root: null });
  return { root: workspaceRoot(), configured: !!(saved && saved.root) };
});
ipcMain.handle('projects:choose-root', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where AI Video Agent projects are saved',
    defaultPath: workspaceRoot(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const root = result.filePaths[0];
  await fsp.mkdir(root, { recursive: true });
  await writeConfig('workspace', { root, updatedAt: Date.now() });
  return { canceled: false, root };
});
ipcMain.handle('projects:list', () => projectList());
ipcMain.handle('projects:create', async (_event, name) => {
  const project = makeProject(name);
  await saveNewProject(project);
  return { ...project, location: projectDirectory(project.id) };
});
ipcMain.handle('projects:load', async (_event, id) => {
  const file = projectFile(id);
  const project = readJson(file, null);
  if (!project) throw new Error('Project not found.');
  project.lastOpenedAt = Date.now();
  await writeJsonAtomic(file, project);
  return project;
});
ipcMain.handle('projects:save', async (_event, input) => {
  const project = validateProject(input);
  const file = await ensureProjectStorage(project);
  await writeJsonAtomic(file, project);
  return { saved: true, updatedAt: project.updatedAt, location: projectDirectory(project.id) };
});
ipcMain.handle('projects:rename', async (_event, id, name) => {
  const project = readJson(projectFile(id), null);
  if (!project) throw new Error('Project not found.');
  project.name = String(name || 'Untitled project').trim().slice(0, 100) || 'Untitled project';
  project.updatedAt = Date.now();
  await writeJsonAtomic(projectFile(id), project);
  return { name: project.name };
});
ipcMain.handle('projects:duplicate', async (_event, id) => {
  const source = readJson(projectFile(id), null);
  if (!source) throw new Error('Project not found.');
  const copy = {
    ...source,
    id: makeProject(source.name + ' copy').id,
    name: String(source.name || 'Untitled project').slice(0, 92) + ' copy',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
    playhead: 0
  };
  await saveNewProject(copy);
  return { id: copy.id, name: copy.name };
});
ipcMain.handle('projects:delete', async (_event, id) => {
  const projectId = safeProjectId(id);
  const index = projectIndex();
  const file = projectFile(projectId);
  const indexedDirectory = index[projectId];
  if (indexedDirectory && path.isAbsolute(indexedDirectory)) {
    await fsp.rm(indexedDirectory, { recursive: true, force: true });
    delete index[projectId];
    await writeConfig('project-index', index);
  } else {
    await fsp.rm(file, { force: true });
  }
  return true;
});
ipcMain.handle('projects:reveal', async (_event, id) => {
  const directory = projectDirectory(id);
  await fsp.mkdir(directory, { recursive: true });
  await shell.openPath(directory);
  return directory;
});
ipcMain.handle('ui:get', () => readConfig('ui', { sidebarHidden: false, agentHidden: false }));
ipcMain.handle('ui:save', async (_event, input) => {
  const current = readConfig('ui', {});
  const next = {
    ...current,
    sidebarHidden: typeof input.sidebarHidden === 'boolean' ? input.sidebarHidden : !!current.sidebarHidden,
    agentHidden: typeof input.agentHidden === 'boolean' ? input.agentHidden : !!current.agentHidden
  };
  await writeConfig('ui', next);
  return next;
});

function importedProject(input) {
  if (!input || typeof input !== 'object') throw new Error('The selected file does not contain a project.');
  const source = input.project && typeof input.project === 'object' ? input.project : input;
  const spec = source.spec;
  if (!spec || typeof spec !== 'object') throw new Error('The project file is missing its video spec.');
  const name = String(source.name || spec.title || 'Imported project').slice(0,100);
  const formatName = String(spec.format || '9:16');
  const dimensions = {
    '9:16': { width:1080, height:1920 },
    '16:9': { width:1920, height:1080 },
    '1:1': { width:1080, height:1080 }
  };
  const sceneDuration = Array.isArray(spec.scenes)
    ? spec.scenes.reduce((sum, scene) => sum + Math.max(0.1, Number(scene.dur) || 3), 0)
    : 15;
  const data = {
    ...source,
    id: makeProject(name).id,
    name,
    format: source.format && typeof source.format === 'object' ? source.format : (dimensions[formatName] || dimensions['9:16']),
    duration: Number(source.duration) || Math.min(120, Math.max(1, sceneDuration)),
    playhead: 0,
    items: source.items && typeof source.items === 'object' ? source.items :
      ((source.edit && source.edit.items) || {}),
    edit: source.edit && typeof source.edit === 'object' ? source.edit : {
      items: source.items || {},
      scenes: source.scenes || {},
      base: source.base || {}
    }
  };
  return validateProject(data);
}

ipcMain.handle('share:bundle', async (_event, input) => {
  const project = validateProject(input);
  const baseName = String(project.name || 'AI-Video-Agent')
    .replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').slice(0,80) || 'AI-Video-Agent';
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: baseName + '.aivp',
    filters: [{ name:'AI Video Agent project', extensions:['aivp'] }]
  });
  if (result.canceled || !result.filePath) return { canceled:true };
  const output = result.filePath.toLowerCase().endsWith('.aivp') ? result.filePath : result.filePath + '.aivp';
  const partial = output + '.partial';
  const archiver = require('archiver');
  try {
    await new Promise((resolve,reject) => {
      const stream = fs.createWriteStream(partial);
      const archive = archiver('zip',{ zlib:{ level:9 } });
      stream.once('close',resolve);
      stream.once('error',reject);
      archive.once('error',reject);
      archive.pipe(stream);
      archive.append(JSON.stringify({
        format:'aivp',
        version:1,
        name:project.name,
        createdAt:Date.now(),
        appVersion:app.getVersion()
      },null,2),{name:'manifest.json'});
      archive.append(JSON.stringify(project),{name:'project.json'});
      archive.append(
        'AI Video Agent editable project bundle.\nOpen this file from the project gallery to import it.',
        {name:'README.txt'}
      );
      archive.finalize().catch(reject);
    });
    await fsp.rename(partial,output);
    const stat=await fsp.stat(output);
    return {saved:true,path:output,bytes:stat.size,format:'aivp'};
  } catch(error) {
    await fsp.rm(partial,{force:true});
    throw error;
  }
});

ipcMain.handle('share:html', async (_event, input) => {
  const project = validateProject(input);
  const baseName = String(project.name || 'AI-Video-Agent')
    .replace(/[<>:"/\\|?*]+/g,'-').replace(/\s+/g,'-').slice(0,80) || 'AI-Video-Agent';
  const result = await dialog.showSaveDialog(mainWindow,{
    defaultPath:baseName+'.html',
    filters:[{name:'Standalone HTML video',extensions:['html']}]
  });
  if(result.canceled||!result.filePath)return {canceled:true};
  const output=result.filePath.toLowerCase().endsWith('.html')?result.filePath:result.filePath+'.html';
  const playerSource=await fsp.readFile(path.join(ROOT,'engine.player.js'),'utf8');
  const safeProject=JSON.stringify(project)
    .replace(/</g,'\\u003c')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029');
  const safeTitle=String(project.name||'AI Video Agent').replace(/[&<>"]/g,'');
  const boot=[
    'const project='+safeProject+';',
    'const canvas=document.getElementById("stage");',
    'let player;',
    'const clock=document.getElementById("clock");',
    'const scrub=document.getElementById("scrub");',
    'const playButton=document.getElementById("play");',
    'player=window.AIVideoPlayer.createPlayer(canvas,project,{onTime:function(t,d){',
    'clock.textContent=t.toFixed(2)+"s / "+d.toFixed(2)+"s";',
    'scrub.max=String(d);scrub.value=String(t);',
    'playButton.textContent=player.playing?"Pause":"Play";',
    '}});',
    'scrub.max=String(player.duration);scrub.value=String(player.time);',
    'playButton.addEventListener("click",function(){if(player.playing)player.pause();else player.play();playButton.textContent=player.playing?"Pause":"Play";});',
    'scrub.addEventListener("input",function(){player.seek(Number(scrub.value));});',
    'document.getElementById("speed").addEventListener("change",function(e){player.setSpeed(Number(e.target.value));});',
    'document.getElementById("volume").addEventListener("input",function(e){player.setVolume(Number(e.target.value));});',
    'document.getElementById("fullscreen").addEventListener("click",function(){const box=document.getElementById("player");if(!document.fullscreenElement)box.requestFullscreen?.();else document.exitFullscreen?.();});',
    'window.addEventListener("beforeunload",function(){player.destroy();});'
  ].join('\n');
  const safePlayer=playerSource.replace(/<\/script/gi,'<\\/script');
  const html=[
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>'+safeTitle+'</title>',
    '<style>',
    '*{box-sizing:border-box}body{margin:0;background:#111;color:#f7f7f5;font:14px/1.4 system-ui,Segoe UI,sans-serif;min-height:100vh;display:grid;place-items:center}',
    '#player{width:min(100vw,1200px);height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;gap:14px}',
    'canvas{max-width:100%;max-height:calc(100vh - 100px);width:auto;height:auto;object-fit:contain;background:#000;box-shadow:0 14px 50px #0008}',
    '#controls{width:min(100%,900px);display:flex;align-items:center;gap:10px}button,select{background:#282828;border:1px solid #484848;color:#fff;border-radius:7px;padding:7px 11px}input[type=range]{accent-color:#f7f7f5;min-width:70px;flex:1}#clock{font:12px ui-monospace,monospace;white-space:nowrap;color:#bbb}',
    '</style></head><body>',
    '<main id="player"><canvas id="stage"></canvas><div id="controls">',
    '<button id="play">Play</button><input id="scrub" type="range" min="0" max="15" step=".01" value="0"><span id="clock">0.00s</span>',
    '<select id="speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value=".75">0.75×</option><option selected value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>',
    '<input id="volume" type="range" min="0" max="1" step=".01" value=".8" title="Volume"><button id="fullscreen">Fullscreen</button>',
    '</div></main>',
    '<script>'+safePlayer+'</script>',
    '<script>'+boot+'</script>',
    '</body></html>'
  ].join('\n');
  await fsp.writeFile(output,html,'utf8');
  const stat=await fsp.stat(output);
  if(!stat.size)throw new Error('The standalone HTML export is empty.');
  return {saved:true,path:output,bytes:stat.size,format:'html'};
});

ipcMain.handle('projects:import', async () => {
  const result=await dialog.showOpenDialog(mainWindow,{
    properties:['openFile'],
    filters:[
      {name:'AI Video Agent projects',extensions:['aivp','json']},
      {name:'All files',extensions:['*']}
    ]
  });
  if(result.canceled||!result.filePaths.length)return {canceled:true};
  const sourcePath=result.filePaths[0];
  const stat=await fsp.stat(sourcePath);
  if(stat.size>250*1024*1024)throw new Error('Project import exceeds the 250 MB limit.');
  const ext=path.extname(sourcePath).toLowerCase();
  let data;
  if(ext==='.aivp'){
    const temp=path.join(app.getPath('temp'),'aiva-import-'+randomUUID());
    try{
      await fsp.mkdir(temp,{recursive:true});
      await require('extract-zip')(sourcePath,{dir:temp});
      const manifestPath=path.join(temp,'manifest.json');
      const projectPath=path.join(temp,'project.json');
      if(!fs.existsSync(manifestPath)||!fs.existsSync(projectPath))throw new Error('Invalid .aivp bundle: manifest.json or project.json is missing.');
      const manifest=readJson(manifestPath,null);
      if(!manifest||manifest.format!=='aivp'||Number(manifest.version)!==1)throw new Error('This .aivp bundle version is not supported.');
      data=readJson(projectPath,null);
      if(!data)throw new Error('The project payload could not be read.');
    }finally{
      await fsp.rm(temp,{recursive:true,force:true});
    }
  }else if(ext==='.json'){
    data=readJson(sourcePath,null);
    if(!data)throw new Error('The selected JSON file could not be parsed.');
  }else{
    throw new Error('Choose an .aivp or .json project file.');
  }
  const project=importedProject(data);
  await saveNewProject(project);
  return {imported:true,project:{id:project.id,name:project.name,updatedAt:project.updatedAt}};
});

ipcMain.handle('providers:list', () => {
  const data = readConfig('providers', { active: null, providers: [] });
  const secrets = readSecrets();
  return {
    active: data.active,
    providers: (data.providers || []).map(p => ({
      ...p,
      keyConfigured: Boolean(secrets['provider:' + p.id]),
      keyHint: secrets['provider:' + p.id] ? '••••' + String(secrets['provider:' + p.id]).slice(-4) : ''
    }))
  };
});

ipcMain.handle('providers:save', async (_event, input) => {
  const provider = cleanProvider(input);
  const data = readConfig('providers', { active: null, providers: [] });
  const secrets = readSecrets();
  if (typeof input.api_key === 'string' && input.api_key.trim()) {
    secrets['provider:' + provider.id] = input.api_key.trim();
    await writeSecrets(secrets);
  }
  const exists = (data.providers || []).some(p => p.id === provider.id);
  data.providers = (data.providers || []).filter(p => p.id !== provider.id);
  data.providers.push(provider);
  if (!data.active || !exists && data.providers.length === 1) data.active = provider.id;
  await writeConfig('providers', data);
  return { saved: true, active: data.active };
});

ipcMain.handle('providers:set-active', async (_event, id) => {
  const data = readConfig('providers', { active: null, providers: [] });
  if (!(data.providers || []).some(p => p.id === id)) throw new Error('Provider not found.');
  data.active = id;
  await writeConfig('providers', data);
  return true;
});

ipcMain.handle('providers:delete', async (_event, id) => {
  const data = readConfig('providers', { active: null, providers: [] });
  data.providers = (data.providers || []).filter(p => p.id !== id);
  if (data.active === id) data.active = data.providers[0]?.id || null;
  const secrets = readSecrets();
  delete secrets['provider:' + id];
  await writeSecrets(secrets);
  await writeConfig('providers', data);
  return true;
});

ipcMain.handle('providers:test', async (_event, input) => {
  const provider = cleanProvider(input);
  const secrets = readSecrets();
  const key = String(input.api_key || secrets['provider:' + provider.id] || '');
  const headers = { Accept: 'application/json', ...provider.headers };
  if (key) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(provider.base_url + '/models', { headers, signal: AbortSignal.timeout(20000) });
  const bodyText = await response.text();
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + bodyText.slice(0, 200));
  let body;
  try { body = JSON.parse(bodyText); } catch { throw new Error('The provider returned invalid JSON from /models.'); }
  const models = Array.isArray(body.data) ? body.data.map(m => ({
    id: String(m.id),
    context_length: m.context_length || m.context_window || null
  })) : [];
  return { connected: true, models };
});

const AI_REQUESTS = new Map();
ipcMain.handle('ai:chat', async (_event, input) => {
  const data = readConfig('providers', { active: null, providers: [] });
  const provider = (data.providers || []).find(p => p.id === (input.providerId || data.active));
  if (!provider) throw new Error('No AI provider is configured. Open Settings → Providers.');
  const secrets = readSecrets();
  const key = secrets['provider:' + provider.id];
  if (!key) throw new Error('Add an API key in Settings → Providers.');
  const model = String(input.model || provider.enabled_models?.[0] || provider.models?.[0] || '');
  if (!model) throw new Error('Select an enabled model in Settings → Providers.');
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, ...provider.headers };
  const body = {
    model,
    messages: Array.isArray(input.messages) ? input.messages.slice(-80) : [],
    temperature: Number.isFinite(input.temperature) ? input.temperature : 0.6,
    max_tokens: Math.max(128, Math.min(8192, Number(input.max_tokens) || 2400)),
    stream: false
  };
  if (Array.isArray(input.tools) && input.tools.length) {
    body.tools = input.tools;
    body.tool_choice = input.tool_choice || 'auto';
  }
  if (input.thinking && typeof input.thinking === 'object') body.thinking = input.thinking;
  const requestId = String(input.requestId || randomUUID());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('AI request timed out after 120 seconds.')), 120000);
  AI_REQUESTS.set(requestId, controller);
  try {
    const response = await fetch(provider.base_url + '/chat/completions', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) throw new Error('AI API HTTP ' + response.status + ': ' + raw.slice(0, 600));
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error('The AI provider returned invalid JSON.'); }
    if (!result.choices?.[0]?.message) throw new Error('The provider response did not include a chat message.');
    return { ...result.choices[0].message, usage: result.usage || null };
  } finally {
    clearTimeout(timeout);
    AI_REQUESTS.delete(requestId);
  }
});
ipcMain.handle('ai:cancel', (_event, requestId) => {
  const controller = AI_REQUESTS.get(String(requestId || ''));
  if (controller) controller.abort(new Error('Cancelled by user.'));
  return Boolean(controller);
});

function getIntegrationsConfig() {
  const raw = readConfig('integrations', {
    ffmpeg: true,
    captions: { enabled: false, base_url: 'https://api.openai.com/v1', model: 'whisper-1', language: 'auto', tested: false },
    tts: { enabled: false, base_url: 'https://api.openai.com/v1', model: 'tts-1', voice: 'alloy', tested: false },
    image: false, music: false, webSearch: false, motionLibrary: true
  });
  const secrets = readSecrets();
  const captions = raw.captions && typeof raw.captions === 'object' ? raw.captions : {
    enabled: Boolean(raw.captions), base_url: 'https://api.openai.com/v1',
    model: 'whisper-1', language: 'auto', tested: false
  };
  const tts = raw.tts && typeof raw.tts === 'object' ? raw.tts : {
    enabled: Boolean(raw.tts), base_url: 'https://api.openai.com/v1',
    model: 'tts-1', voice: 'alloy', tested: false
  };
  return {
    ffmpeg: raw.ffmpeg !== false,
    captions: { ...captions, keyConfigured: Boolean(secrets['integration:captions']), enabled: Boolean(captions.enabled && captions.tested && secrets['integration:captions']) },
    tts: { ...tts, keyConfigured: Boolean(secrets['integration:tts']), enabled: Boolean(tts.enabled && tts.tested && secrets['integration:tts']) },
    image: Boolean(raw.image),
    music: Boolean(raw.music),
    webSearch: Boolean(raw.webSearch),
    motionLibrary: raw.motionLibrary !== false
  };
}

function normaliseIntegrationUrl(value, label) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); }
  catch { throw new Error(label + ' API base URL is invalid.'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(label + ' API URL must use HTTP or HTTPS.');
  if (parsed.protocol === 'http:' && !['localhost','127.0.0.1','::1'].includes(parsed.hostname)) {
    throw new Error(label + ' remote API must use HTTPS.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function testIntegrationEndpoint(kind, config, apiKey) {
  const endpoint = normaliseIntegrationUrl(config.base_url, kind === 'tts' ? 'TTS' : 'Captions') + '/models';
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(kind + ' API test failed · HTTP ' + response.status + ' · ' + body.slice(0, 240));
  let models = [];
  try {
    const parsed = JSON.parse(body);
    models = Array.isArray(parsed.data) ? parsed.data.map(item => item.id).filter(Boolean) : [];
  } catch {}
  return { connected: true, models: models.slice(0, 60) };
}

function runFfmpeg(binary, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      reject(new Error('FFmpeg operation timed out.'));
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-20000); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-30000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error('FFmpeg exited with code ' + code + ': ' + stderr.slice(-1600)));
    });
  });
}

function validateMediaFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Choose a local source video first.');
  const extension = path.extname(filePath).toLowerCase();
  if (!['.mp4','.mov','.mkv','.webm','.m4v','.avi','.mpeg','.mpg'].includes(extension)) {
    throw new Error('Unsupported source video format.');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('The selected source video no longer exists.');
  const stat = fs.statSync(filePath);
  if (stat.size > 2 * 1024 * 1024 * 1024) throw new Error('Source video exceeds the 2 GB processing limit.');
  return filePath;
}

async function makeTranscription(filePath, language = 'auto') {
  const integrations = getIntegrationsConfig();
  const config = integrations.captions;
  const key = readSecrets()['integration:captions'];
  if (!config.enabled || !config.tested || !key) throw new Error('Auto captions are not enabled. Configure and test the Captions API in Settings → Integrations.');
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('Bundled FFmpeg is required to extract audio for captions.');
  const source = validateMediaFile(filePath);
  const temp = path.join(app.getPath('temp'), 'aiva-transcribe-' + randomUUID());
  await fsp.mkdir(temp, { recursive: true });
  const wav = path.join(temp, 'audio.wav');
  try {
    await runFfmpeg(ffmpeg, ['-hide_banner','-y','-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav], 180000);
    const bytes = await fsp.readFile(wav);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type:'audio/wav' }), 'audio.wav');
    form.append('model', String(config.model || 'whisper-1'));
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (language && language !== 'auto') form.append('language', String(language).slice(0, 12));
    const endpoint = normaliseIntegrationUrl(config.base_url, 'Captions') + '/audio/transcriptions';
    const response = await fetch(endpoint, {
      method:'POST',
      headers:{ Authorization:'Bearer ' + key },
      body:form,
      signal:AbortSignal.timeout(300000)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error('Caption API HTTP ' + response.status + ' · ' + raw.slice(0, 600));
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error('Caption API did not return timestamped JSON.'); }
    const segments = Array.isArray(result.segments) ? result.segments
      : Array.isArray(result.words) ? result.words.map((word,index) => ({ id:index,start:word.start,end:word.end,text:word.word })) : [];
    if (!segments.length) throw new Error('The transcription API returned no time-coded segments. Use a compatible Whisper API that supports verbose_json timestamps.');
    return {
      text:String(result.text || ''),
      language:String(result.language || language || 'auto'),
      duration:Number(result.duration) || 0,
      segments:segments.map((segment,index) => ({
        id:segment.id == null ? index : segment.id,
        start:Math.max(0,Number(segment.start)||0),
        end:Math.max(0,Number(segment.end)||0),
        text:String(segment.text || '').trim()
      })).filter(segment => segment.end > segment.start && segment.text).slice(0,1500)
    };
  } finally {
    await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}

ipcMain.handle('settings:get', () => ({
  appearance: readConfig('theme', { mode: 'light', accent: '#C65A2E', bg:'#F7F6F3', paper:'#FFFFFF', ink:'#171614', fontScale: 100, density: 'comfortable', reduceMotion: false, windowMaterial: 'mica' }),
  tools: readConfig('tools', { state: { get_project: 'on', replace_spec: 'on', verify_video: 'on', add_text: 'on', set_background: 'on', set_format: 'lazy', remove_element: 'lazy', critique: 'lazy' }, options: {} }),
  integrations: getIntegrationsConfig(),
  brandKit: readConfig('brand', { name:'',primary:'#171614',secondary:'#F7F6F3',accent:'#C65A2E',headingFont:'Inter',bodyFont:'Inter',logoDataUrl:'',logoPosition:'bottom-right',useLogo:true }),
  music: readConfig('music', { bpm: 120, volume: 0.7, fadeIn: 0.5, fadeOut: 0.5, autoSfx: true, musicOffByDefault: true })
}));

ipcMain.handle('settings:save-appearance', async (_event, value) => {
  const allowed = ['light', 'dark', 'system', 'custom'];
  const validColor = (v,fallback) => /^#[0-9a-fA-F]{6}$/.test(String(v||'')) ? v : fallback;
  const mode = allowed.includes(value.mode) ? value.mode : 'light';
  const appearance = {
    mode,
    accent: validColor(value.accent, '#C65A2E'),
    bg: validColor(value.bg, '#F7F6F3'),
    paper: validColor(value.paper, '#FFFFFF'),
    ink: validColor(value.ink, '#171614'),
    fontScale: [100, 110, 125].includes(Number(value.fontScale)) ? Number(value.fontScale) : 100,
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    reduceMotion: Boolean(value.reduceMotion),
    windowMaterial: ['acrylic', 'mica', 'tabbed', 'auto', 'none'].includes(value.windowMaterial) ? value.windowMaterial : 'mica'
  };
  await writeConfig('theme', appearance);
  nativeTheme.themeSource = mode === 'system' ? 'system' : mode === 'dark' ? 'dark' : 'light';
  mainWindow?.webContents.send('theme:changed', appearance);
  settingsWindow?.webContents.send('theme:changed', appearance);
  return appearance;
});

ipcMain.handle('settings:save-tools', async (_event, value) => {
  const core = ['get_project', 'replace_spec', 'verify_video'];
  const state = { ...(value.state || {}) };
  for (const name of core) state[name] = 'on';
  const clean = {};
  for (const [name, status] of Object.entries(state)) clean[name] = ['on', 'lazy', 'off'].includes(status) ? status : 'off';
  const result = { state: clean, options: value.options || {} };
  await writeConfig('tools', result);
  return result;
});

ipcMain.handle('settings:save-integrations', async (_event, value) => {
  const old = getIntegrationsConfig();
  const raw = readConfig('integrations', {});
  const secrets = readSecrets();
  const result = {
    ffmpeg: value.ffmpeg !== false,
    captions: {
      enabled: Boolean(value.captions && value.captions.enabled && old.captions.tested && secrets['integration:captions']),
      base_url: normaliseIntegrationUrl(value.captions?.base_url || old.captions.base_url || 'https://api.openai.com/v1','Captions'),
      model: String(value.captions?.model || old.captions.model || 'whisper-1').slice(0,100),
      language: String(value.captions?.language || old.captions.language || 'auto').slice(0,12),
      tested:Boolean(old.captions.tested)
    },
    tts: {
      enabled: Boolean(value.tts && value.tts.enabled && old.tts.tested && secrets['integration:tts']),
      base_url: normaliseIntegrationUrl(value.tts?.base_url || old.tts.base_url || 'https://api.openai.com/v1','TTS'),
      model: String(value.tts?.model || old.tts.model || 'tts-1').slice(0,100),
      voice: String(value.tts?.voice || old.tts.voice || 'alloy').slice(0,80),
      tested:Boolean(old.tts.tested)
    },
    image:Boolean(value.image),
    music:Boolean(value.music),
    webSearch:Boolean(value.webSearch),
    motionLibrary:value.motionLibrary !== false
  };
  if (value.captions && typeof value.captions.apiKey === 'string' && value.captions.apiKey.trim()) {
    secrets['integration:captions'] = value.captions.apiKey.trim();
  }
  if (value.tts && typeof value.tts.apiKey === 'string' && value.tts.apiKey.trim()) {
    secrets['integration:tts'] = value.tts.apiKey.trim();
  }
  await writeSecrets(secrets);
  await writeConfig('integrations', result);
  return getIntegrationsConfig();
});

ipcMain.handle('integrations:test', async (_event, kind, input) => {
  if (!['captions','tts'].includes(kind)) throw new Error('Unknown integration.');
  const current = getIntegrationsConfig();
  const oldSecret = readSecrets();
  const apiKey = String(input.apiKey || oldSecret['integration:' + kind] || '').trim();
  if (!apiKey) throw new Error('Enter an API key before testing this integration.');
  const config = {
    ...current[kind],
    ...input,
    base_url: normaliseIntegrationUrl(input.base_url || current[kind].base_url, kind)
  };
  const test = await testIntegrationEndpoint(kind, config, apiKey);
  const secrets = readSecrets();
  secrets['integration:' + kind] = apiKey;
  await writeSecrets(secrets);
  const integrations = readConfig('integrations', {});
  integrations[kind] = {
    enabled:false,
    base_url:config.base_url,
    model:String(config.model || current[kind].model).slice(0,100),
    voice:String(config.voice || current[kind].voice || 'alloy').slice(0,80),
    language:String(config.language || 'auto').slice(0,12),
    tested:true,
    testedAt:Date.now(),
    modelCount:test.models.length
  };
  await writeConfig('integrations',integrations);
  return { connected:true,models:test.models,config:getIntegrationsConfig()[kind] };
});

ipcMain.handle('brand:save', async (_event, input) => {
  const color = (value,fallback) => /^#[0-9a-fA-F]{6}$/.test(String(value||'')) ? value : fallback;
  const brand = {
    name:String(input.name||'').slice(0,80),
    primary:color(input.primary,'#171614'),
    secondary:color(input.secondary,'#F7F6F3'),
    accent:color(input.accent,'#C65A2E'),
    headingFont:String(input.headingFont||'Inter').slice(0,80),
    bodyFont:String(input.bodyFont||'Inter').slice(0,80),
    logoPosition:['top-left','top-right','bottom-left','bottom-right'].includes(input.logoPosition) ? input.logoPosition : 'bottom-right',
    useLogo:input.useLogo !== false
  };
  if (typeof input.logoDataUrl === 'string' && input.logoDataUrl.startsWith('data:image/')) {
    if (input.logoDataUrl.length > 8 * 1024 * 1024) throw new Error('Brand logo exceeds the 6 MB limit.');
    const match=input.logoDataUrl.match(/^data:image\/(png|jpeg|jpg|svg\+xml);base64,/i);
    if(!match)throw new Error('Brand logo must be PNG, JPEG or SVG.');
    const ext=match[1].toLowerCase().includes('svg')?'svg':match[1].toLowerCase()==='png'?'png':'jpg';
    const bytes=Buffer.from(input.logoDataUrl.slice(input.logoDataUrl.indexOf(',')+1),'base64');
    if(!bytes.length)throw new Error('Brand logo file is empty.');
    const folder=path.join(CONFIG(),'brand');
    await fsp.mkdir(folder,{recursive:true});
    const file=path.join(folder,'logo.'+ext);
    await fsp.writeFile(file,bytes);
    brand.logoDataUrl='data:image/'+(ext==='jpg'?'jpeg':ext==='svg'?'svg+xml':ext)+';base64,'+bytes.toString('base64');
    brand.logoPath=file;
  } else {
    const previous=readConfig('brand',{});
    brand.logoDataUrl=previous.logoDataUrl||'';
    brand.logoPath=previous.logoPath||'';
  }
  await writeConfig('brand',brand);
  return brand;
});

ipcMain.handle('brand:get', () => readConfig('brand', {
  name:'',primary:'#171614',secondary:'#F7F6F3',accent:'#C65A2E',
  headingFont:'Inter',bodyFont:'Inter',logoDataUrl:'',logoPosition:'bottom-right',useLogo:true
}));

ipcMain.handle('media:detect-silence', async (_event, input) => {
  const ffmpeg=getFfmpegPath();
  if(!ffmpeg)throw new Error('Bundled FFmpeg is required for silence detection.');
  const file=validateMediaFile(input.filePath);
  const threshold=Math.max(-60,Math.min(-15,Number(input.thresholdDb)||-35));
  const minimum=Math.max(0.15,Math.min(3,Number(input.minimumSeconds)||0.35));
  const duration=Math.max(0,Number(input.duration)||0);
  const result=await runFfmpeg(ffmpeg,['-hide_banner','-i',file,'-af','silencedetect=noise='+threshold+'dB:d='+minimum,'-f','null','-'],180000);
  const text=result.stderr;
  const starts=[...text.matchAll(/silence_start:\s*([\d.]+)/g)].map(m=>Number(m[1]));
  const ends=[...text.matchAll(/silence_end:\s*([\d.]+)/g)].map(m=>Number(m[1]));
  const total=duration||Number((text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)||[]).slice(1).reduce((a,v,i)=>a+Number(v)*[3600,60,1][i],0))||0;
  const silences=[];
  starts.forEach((start,index)=>{
    const end=ends[index]===undefined?total:ends[index];
    if(end>start)silences.push({start,end});
  });
  const keep=[];
  let cursor=0;
  const pad=Math.max(0,Math.min(0.3,Number(input.paddingSeconds)||0.08));
  for(const silence of silences){
    const a=Math.max(cursor,Math.min(total,silence.start+pad));
    const b=Math.max(a,Math.min(total,silence.end-pad));
    if(a-cursor>0.12)keep.push({start:cursor,end:a});
    cursor=Math.max(cursor,b);
  }
  if(total-cursor>0.12)keep.push({start:cursor,end:total});
  return {duration:total,thresholdDb:threshold,minimumSeconds:minimum,silences,keepRanges:keep,removedSeconds:+silences.reduce((sum,item)=>sum+Math.max(0,item.end-item.start),0).toFixed(2)};
});

ipcMain.handle('media:transcribe', async (_event, input) => {
  return makeTranscription(input.filePath,input.language||'auto');
});

ipcMain.handle('tts:generate', async (_event, input) => {
  const integrations=getIntegrationsConfig();
  const config=integrations.tts;
  const key=readSecrets()['integration:tts'];
  if(!config.enabled||!config.tested||!key)throw new Error('Text-to-speech is not enabled. Configure and test it in Settings → Integrations.');
  const text=String(input.text||'').trim();
  if(!text||text.length>8000)throw new Error('Voiceover text must contain 1–8000 characters.');
  const endpoint=normaliseIntegrationUrl(config.base_url,'TTS')+'/audio/speech';
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:config.model||'tts-1',voice:config.voice||'alloy',input:text,response_format:'mp3'}),
    signal:AbortSignal.timeout(180000)
  });
  if(!response.ok)throw new Error('TTS API HTTP '+response.status+' · '+(await response.text()).slice(0,500));
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length||bytes.length>40*1024*1024)throw new Error('Voiceover result is empty or too large.');
  let savedPath=null;
  if(input.projectId){
    const directory=projectDirectory(input.projectId);
    await fsp.mkdir(directory,{recursive:true});
    savedPath=path.join(directory,'voiceover-'+Date.now()+'.mp3');
    await fsp.writeFile(savedPath,bytes);
  }
  return {file:savedPath,bytes:bytes.length,mime:'audio/mpeg',dataUrl:'data:audio/mpeg;base64,'+bytes.toString('base64')};
});

ipcMain.handle('projects:versions:create', async (_event,id,label,payload) => {
  const projectId=safeProjectId(id);
  const directory=projectDirectory(projectId);
  await fsp.mkdir(path.join(directory,'versions'),{recursive:true});
  const project=validateProject(payload);
  const versionId='ver_'+Date.now()+'_'+randomUUID().slice(0,8);
  const versionFile=path.join(directory,'versions',versionId+'.json');
  await writeJsonAtomic(versionFile,project);
  const historyFile=path.join(directory,'versions','index.json');
  const history=readJson(historyFile,[]);
  history.unshift({id:versionId,label:String(label||'Version').slice(0,100),createdAt:Date.now()});
  await writeJsonAtomic(historyFile,history.slice(0,100));
  return {id:versionId,label:String(label||'Version'),createdAt:Date.now()};
});
ipcMain.handle('projects:versions:list', async (_event,id) => {
  const directory=projectDirectory(id);
  return readJson(path.join(directory,'versions','index.json'),[]);
});
ipcMain.handle('projects:versions:restore', async (_event,id,versionId) => {
  const directory=projectDirectory(id);
  if(!/^ver_[\w-]+$/.test(String(versionId)))throw new Error('Invalid version id.');
  const snapshot=readJson(path.join(directory,'versions',versionId+'.json'),null);
  if(!snapshot)throw new Error('Project version not found.');
  return snapshot;
});

ipcMain.handle('projects:get-workspace-info', () => {
  const saved = readConfig('workspace', { root: null });
  return { root: workspaceRoot(), configured: !!(saved && saved.root) };
});
ipcMain.handle('projects:choose-root', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where AI Video Agent projects are saved',
    defaultPath: workspaceRoot(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const root = result.filePaths[0];
  await fsp.mkdir(root, { recursive: true });
  await writeConfig('workspace', { root, updatedAt: Date.now() });
  return { canceled: false, root };
});

ipcMain.handle('export:image', async (_event, dataUrl, defaultName) => {
  if (typeof dataUrl !== 'string') throw new Error('Invalid image payload.');
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,/i);
  if (!match) throw new Error('Only PNG and JPEG frame images can be saved.');
  const extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  const prefix = dataUrl.slice(0, dataUrl.indexOf(',') + 1);
  const buffer = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error('Image is empty or too large.');
  const suggested = String(defaultName || ('frame.' + extension)).replace(/[<>:"/\\|?*]+/g, '-');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggested,
    filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const selectedExtension = path.extname(result.filePath).toLowerCase();
  const finalPath = selectedExtension ? result.filePath : result.filePath + '.' + extension;
  await fsp.writeFile(finalPath, buffer);
  const stat = await fsp.stat(finalPath);
  if (!stat.size) throw new Error('The image was not written to disk.');
  return { saved: true, path: finalPath, bytes: stat.size };
});
ipcMain.handle('export:reveal-file', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
    throw new Error('Saved file could not be found.');
  }
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('ffmpeg:begin', async (_event, options) => {
  if (!getFfmpegPath()) throw new Error('FFmpeg is unavailable in this installation.');
  const fps = Math.max(12, Math.min(60, Number(options.fps) || 30));
  const duration = Math.max(1, Math.min(120, Number(options.duration) || 15));
  const count = Math.ceil(fps * duration);
  if (count > 7200) throw new Error('This export is too long for a single render job.');
  const ext = options.ext === 'jpg' ? 'jpg' : 'png';
  const id = randomUUID();
  const directory = path.join(app.getPath('temp'), 'aiva-export-' + id);
  await fsp.mkdir(directory, { recursive: true });
  let audioPath = null;
  if (typeof options.audioDataUrl === 'string' && options.audioDataUrl.startsWith('data:')) {
    const comma = options.audioDataUrl.indexOf(',');
    if (comma < 0 || !options.audioDataUrl.slice(0, comma).includes(';base64')) {
      await fsp.rm(directory, { recursive: true, force: true });
      throw new Error('The project music file is not a valid base64 data URL.');
    }
    const mime = options.audioDataUrl.slice(5, options.audioDataUrl.indexOf(';')).toLowerCase();
    const extensions = {
      'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav',
      'audio/ogg':'ogg','audio/webm':'webm','audio/mp4':'m4a','audio/aac':'aac',
      'audio/flac':'flac'
    };
    const audioExt = extensions[mime];
    if (!audioExt) {
      await fsp.rm(directory, { recursive: true, force: true });
      throw new Error('Unsupported music format for MP4 export: ' + mime);
    }
    const audioBuffer = Buffer.from(options.audioDataUrl.slice(comma + 1), 'base64');
    if (!audioBuffer.length || audioBuffer.length > 100 * 1024 * 1024) {
      await fsp.rm(directory, { recursive: true, force: true });
      throw new Error('Music file is empty or exceeds the 100 MB export limit.');
    }
    audioPath = path.join(directory, 'music.' + audioExt);
    await fsp.writeFile(audioPath, audioBuffer);
  }
  JOBS.set(id, {
    directory, fps, duration, count, ext, audioPath,
    audioVolume: Math.max(0, Math.min(1, Number(options.audioVolume) || 0.8)),
    written: 0, canceled: false, child: null
  });
  return { id, frameCount: count, hasAudio: Boolean(audioPath) };
});

ipcMain.handle('ffmpeg:write-frame', async (_event, id, index, dataUrl) => {
  const job = JOBS.get(id);
  if (!job || job.canceled) throw new Error('Export session is no longer active.');
  if (!Number.isInteger(index) || index < 0 || index >= job.count) throw new Error('Invalid export frame index.');
  const prefix = job.ext === 'jpg' ? 'data:image/jpeg;base64,' : 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) throw new Error('Invalid frame payload.');
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('Invalid or oversized frame.');
  const file = path.join(job.directory, 'frame-' + String(index).padStart(5, '0') + '.' + job.ext);
  await fsp.writeFile(file, buffer);
  job.written++;
  if (job.written % 10 === 0 || job.written === job.count) {
    mainWindow?.webContents.send('export:progress', { phase: 'frames', value: job.written / job.count });
  }
  return { written: job.written };
});

ipcMain.handle('ffmpeg:finish', async (_event, id) => {
  const job = JOBS.get(id);
  if (!job || job.canceled) throw new Error('Export session not found or cancelled.');
  if (job.written !== job.count) throw new Error('Frame sequence is incomplete: ' + job.written + ' / ' + job.count + '.');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'AI-Video-Agent.mp4',
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
  });
  if (result.canceled || !result.filePath) {
    await fsp.rm(job.directory, { recursive: true, force: true });
    JOBS.delete(id);
    return { canceled: true };
  }
  const output = result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : result.filePath + '.mp4';
  const partial = output.replace(/\.mp4$/i, '.partial.mp4');
  const frames = path.join(job.directory, 'frame-%05d.' + job.ext);
  const args = [
    '-hide_banner', '-y', '-framerate', String(job.fps),
    '-start_number', '0', '-i', frames
  ];
  if (job.audioPath) {
    args.push('-stream_loop', '-1', '-i', job.audioPath);
  }
  args.push('-t', String(job.duration), '-map', '0:v:0');
  if (job.audioPath) {
    args.push('-map', '1:a:0', '-filter:a', 'volume=' + job.audioVolume.toFixed(3), '-c:a', 'aac', '-b:a', '192k');
  }
  args.push(
    '-frames:v', String(job.count), '-c:v', 'libx264',
    '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', partial
  );
  const binary = getFfmpegPath();
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true });
      job.child = child;
      let stderr = '';
      child.stderr.on('data', chunk => {
        const chunkText = chunk.toString();
        stderr = (stderr + chunkText).slice(-5000);
        const match = chunkText.match(/frame=\s*(\d+)/);
        if (match) mainWindow?.webContents.send('export:progress', {
          phase: 'encoding', value: Math.min(0.99, Number(match[1]) / job.count)
        });
      });
      child.once('error', reject);
      child.once('close', code => {
        job.child = null;
        if (job.canceled) reject(new Error('Export cancelled.'));
        else if (code === 0) resolve();
        else reject(new Error('FFmpeg exited with code ' + code + ': ' + stderr.slice(-1200)));
      });
    });
    await fsp.rename(partial, output);
    const stat = await fsp.stat(output);
    mainWindow?.webContents.send('export:progress', { phase: 'done', value: 1 });
    return { saved: true, path: output, bytes: stat.size, engine: 'FFmpeg', audio: Boolean(job.audioPath) };
  } catch (error) {
    await fsp.rm(partial, { force: true });
    throw error;
  } finally {
    await fsp.rm(job.directory, { recursive: true, force: true });
    JOBS.delete(id);
  }
});

ipcMain.handle('ffmpeg:cancel', async (_event, id) => {
  const job = JOBS.get(id);
  if (job) {
    job.canceled = true;
    try { job.child?.kill('SIGTERM'); } catch {}
    await fsp.rm(job.directory, { recursive: true, force: true });
    JOBS.delete(id);
  }
  return true;
});

app.whenReady().then(async () => {
  await fsp.mkdir(CONFIG(), { recursive: true });
  await fsp.mkdir(PROJECTS(), { recursive: true });
  const providerConfig = readConfig('providers', null);
  if (!providerConfig || !Array.isArray(providerConfig.providers) || !providerConfig.providers.length) {
    await writeConfig('providers', {
      active: 'deepseek',
      providers: [{
        id: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
        enabled_models: ['deepseek-v4-flash', 'deepseek-chat'], headers: {}, createdAt: Date.now()
      }]
    });
  }
  const appearance = readConfig('theme', { mode: 'light' });
  nativeTheme.themeSource = appearance.mode === 'system' ? 'system' : appearance.mode === 'dark' ? 'dark' : 'light';
  createMainWindow();
  buildMenu();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', async () => {
  for (const [id, job] of JOBS) {
    job.canceled = true;
    await fsp.rm(job.directory, { recursive: true, force: true }).catch(() => {});
    JOBS.delete(id);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
