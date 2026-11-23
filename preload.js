const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (payload) => ipcRenderer.invoke('store:save', payload),
  collapse: (collapsed) => ipcRenderer.invoke('win:collapse', collapsed),
  hide: () => ipcRenderer.invoke('win:hide'),
  quit: () => ipcRenderer.invoke('win:quit'),
  exportJSON: () => ipcRenderer.invoke('store:export'),
  importJSON: () => ipcRenderer.invoke('store:import'),
  setAutostart: (enabled) => ipcRenderer.invoke('app:autostart', enabled),
  revealData: () => ipcRenderer.invoke('app:reveal-data'),
  onReload: (cb) => ipcRenderer.on('store:reloaded', (_e, data) => cb(data))
});
