'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('yah', {
  openContent: (payload) => ipcRenderer.invoke('content:open', payload),
  updateContent: (payload) => ipcRenderer.send('content:update', payload),
  onContentInit: (callback) => subscribe('content:init', callback),
  onContentUpdate: (callback) => subscribe('content:update', callback),

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  dragStart: (point) => ipcRenderer.send('window:drag-start', point),
  dragMove: (point) => ipcRenderer.send('window:drag-move', point),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  version: () => ipcRenderer.invoke('app:version'),
  platform: process.platform,
});
