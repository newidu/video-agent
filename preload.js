'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('aiva', Object.freeze({
  theme: {
    exportFile: () => invoke('theme:export'),
    importFile: () => invoke('theme:import')
  },
  app: {
    info: () => invoke('app:info'),
    openSettings: () => invoke('window:settings'),
    revealData: () => invoke('window:reveal-data')
  },
  project: {
    list: () => invoke('projects:list'),
    create: name => invoke('projects:create', name),
    load: id => invoke('projects:load', id),
    save: project => invoke('projects:save', project),
    rename: (id, name) => invoke('projects:rename', id, name),
    delete: id => invoke('projects:delete', id),
    duplicate: id => invoke('projects:duplicate', id),
    reveal: id => invoke('projects:reveal', id),
    getRoot: () => invoke('projects:get-root'),
    getWorkspaceInfo: () => invoke('projects:get-workspace-info'),
    createVersion: (id, label, payload) => invoke('projects:versions:create', id, label, payload),
    listVersions: id => invoke('projects:versions:list', id),
    restoreVersion: (id, versionId) => invoke('projects:versions:restore', id, versionId),
    chooseRoot: () => invoke('projects:choose-root'),
    importFile: () => invoke('projects:import'),
    exportBundle: project => invoke('share:bundle', project),
    exportHtml: project => invoke('share:html', project)
  },
  providers: {
    list: () => invoke('providers:list'),
    save: provider => invoke('providers:save', provider),
    setActive: id => invoke('providers:set-active', id),
    remove: id => invoke('providers:delete', id),
    test: provider => invoke('providers:test', provider)
  },
  ai: {
    chat: payload => invoke('ai:chat', payload),
    cancel: requestId => invoke('ai:cancel', requestId)
  },
  ui: {
    get: () => invoke('ui:get'),
    save: value => invoke('ui:save', value)
  },
  settings: {
    get: () => invoke('settings:get'),
    saveAppearance: value => invoke('settings:save-appearance', value),
    saveTools: value => invoke('settings:save-tools', value),
    saveIntegrations: value => invoke('settings:save-integrations', value),
    testIntegration: (kind, value) => invoke('integrations:test', kind, value),
    saveMusic: value => invoke('settings:save-music', value),
    saveBrandKit: value => invoke('brand:save', value),
    getBrandKit: () => invoke('brand:get')
  },
  motion: {
    list: () => invoke('motion:list'),
    get: id => invoke('motion:get', id),
    save: value => invoke('motion:save', value),
    saveLottie: value => invoke('motion:save-lottie', value),
    remove: id => invoke('motion:delete', id)
  },
  media: {
    getPathForFile: file => webUtils.getPathForFile(file),
    detectSilence: options => invoke('media:detect-silence', options),
    transcribe: options => invoke('media:transcribe', options),
    generateVoiceover: options => invoke('tts:generate', options)
  },
  export: {
    image: (dataUrl, name) => invoke('export:image', dataUrl, name),
    revealFile: filePath => invoke('export:reveal-file', filePath),
    begin: options => invoke('ffmpeg:begin', options),
    writeFrame: (id, index, dataUrl) => invoke('ffmpeg:write-frame', id, index, dataUrl),
    finish: id => invoke('ffmpeg:finish', id),
    cancel: id => invoke('ffmpeg:cancel', id),
    onProgress: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('export:progress', listener);
      return () => ipcRenderer.removeListener('export:progress', listener);
    }
  },
  onMenu: (eventName, callback) => {
    const allowed = ['menu:new-project', 'menu:home', 'menu:theme'];
    if (!allowed.includes(eventName)) return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(eventName, listener);
    return () => ipcRenderer.removeListener(eventName, listener);
  },
  onThemeChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  },
  onSettingsChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  onBrandChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('brand:changed', listener);
    return () => ipcRenderer.removeListener('brand:changed', listener);
  }
}));
