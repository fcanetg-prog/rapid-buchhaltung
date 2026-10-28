'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data, opts) => ipcRenderer.invoke('data:save', data, opts),
  importFile: () => ipcRenderer.invoke('data:import'),
  exportFile: (data) => ipcRenderer.invoke('data:export', data),
  openFolder: () => ipcRenderer.invoke('data:openFolder'),
  chooseFolder: () => ipcRenderer.invoke('data:chooseFolder'),
  info: () => ipcRenderer.invoke('app:info'),
  update: () => ipcRenderer.invoke('app:update'),
  openText: (titel, endungen) => ipcRenderer.invoke('file:openText', titel, endungen),
  savePdf: (html, opts) => ipcRenderer.invoke('pdf:save', html, opts),
  confirm: (text) => ipcRenderer.sendSync('dlg:confirm', String(text)),
  onChanged: (fn) => ipcRenderer.on('data:changed', () => fn()),
});
