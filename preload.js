'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('aiva', Object.freeze({
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
    delete: id => invoke('projects:delete', id)
  },
  providers: {
    list: () => invoke('providers:list'),
    save: provider => invoke('providers:save', provider),
    setActive: id => invoke('providers:set-active', id),
    remove: id => invoke('providers:delete', id),
    test: provider => invoke('providers:test', provider)
  },
  ai: {
    chat: payload => invoke('ai:chat', payload)
  },
  settings: {
    get: () => invoke('settings:get'),
    saveAppearance: value => invoke('settings:save-appearance', value),
    saveTools: value => invoke('settings:save-tools', value),
    saveIntegrations: value => invoke('settings:save-integrations', value),
    saveMusic: value => invoke('settings:save-music', value)
  },
  export: {
    image: (dataUrl, name) => invoke('export:image', dataUrl, name),
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
  }
}));
