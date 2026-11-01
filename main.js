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

function projectFile(id) {
  return path.join(PROJECTS(), safeProjectId(id) + '.json');
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
  const entries = await fsp.readdir(PROJECTS(), { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^prj_[\w-]+\.json$/.test(entry.name)) continue;
    const project = readJson(path.join(PROJECTS(), entry.name), null);
    if (project && project.id) {
      projects.push({
        id: project.id,
        name: project.name || 'Untitled project',
        updatedAt: project.updatedAt || 0,
        createdAt: project.createdAt || 0,
        thumbnail: project.thumbnail || null
      });
    }
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
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

ipcMain.handle('projects:list', () => projectList());
ipcMain.handle('projects:create', async (_event, name) => {
  const project = makeProject(name);
  await writeJsonAtomic(projectFile(project.id), project);
  return project;
});
ipcMain.handle('projects:load', async (_event, id) => {
  const project = readJson(projectFile(id), null);
  if (!project) throw new Error('Project not found.');
  return project;
});
ipcMain.handle('projects:save', async (_event, input) => {
  const project = validateProject(input);
  await writeJsonAtomic(projectFile(project.id), project);
  return { saved: true, updatedAt: project.updatedAt };
});
ipcMain.handle('projects:rename', async (_event, id, name) => {
  const project = readJson(projectFile(id), null);
  if (!project) throw new Error('Project not found.');
  project.name = String(name || 'Untitled project').trim().slice(0, 100) || 'Untitled project';
  project.updatedAt = Date.now();
  await writeJsonAtomic(projectFile(id), project);
  return { name: project.name };
});
ipcMain.handle('projects:delete', async (_event, id) => {
  await fsp.rm(projectFile(id), { force: true });
  return true;
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
  await writeJsonAtomic(projectFile(project.id),project);
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

ipcMain.handle('settings:get', () => ({
  appearance: readConfig('theme', { mode: 'light', accent: '#111111', fontScale: 100, density: 'comfortable', reduceMotion: false, windowMaterial: 'mica' }),
  tools: readConfig('tools', { state: { get_project: 'on', replace_spec: 'on', verify_video: 'on', add_text: 'on', set_background: 'on', set_format: 'lazy', remove_element: 'lazy', critique: 'lazy' }, options: {} }),
  integrations: readConfig('integrations', { ffmpeg: true, captions: false, tts: false, image: false, music: false, webSearch: false }),
  music: readConfig('music', { bpm: 120, volume: 0.7, fadeIn: 0.5, fadeOut: 0.5, autoSfx: true, musicOffByDefault: true })
}));

ipcMain.handle('settings:save-appearance', async (_event, value) => {
  const allowed = ['light', 'dark', 'system', 'custom'];
  const mode = allowed.includes(value.mode) ? value.mode : 'light';
  const appearance = {
    mode,
    accent: /^#[0-9a-fA-F]{6}$/.test(value.accent) ? value.accent : '#111111',
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
  const result = {
    ffmpeg: value.ffmpeg !== false,
    captions: Boolean(value.captions),
    tts: Boolean(value.tts),
    image: Boolean(value.image),
    music: Boolean(value.music),
    webSearch: Boolean(value.webSearch)
  };
  await writeConfig('integrations', result);
  return result;
});
ipcMain.handle('settings:save-music', async (_event, value) => {
  const result = {
    bpm: Math.max(40, Math.min(240, Number(value.bpm) || 120)),
    volume: Math.max(0, Math.min(1, Number(value.volume) || 0.7)),
    fadeIn: Math.max(0, Math.min(10, Number(value.fadeIn) || 0)),
    fadeOut: Math.max(0, Math.min(10, Number(value.fadeOut) || 0)),
    autoSfx: Boolean(value.autoSfx),
    musicOffByDefault: Boolean(value.musicOffByDefault)
  };
  await writeConfig('music', result);
  return result;
});

ipcMain.handle('export:image', async (_event, dataUrl, defaultName) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Invalid PNG image payload.');
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error('Image is empty or too large.');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: String(defaultName || 'frame.png'),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fsp.writeFile(result.filePath, buffer);
  const stat = await fsp.stat(result.filePath);
  if (!stat.size) throw new Error('The image was not written to disk.');
  return { saved: true, path: result.filePath, bytes: stat.size };
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
