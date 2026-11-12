'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('miniharness', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  loadChats: () => ipcRenderer.invoke('chats:load'),
  saveChats: (chats) => ipcRenderer.invoke('chats:save', chats),

  sendChat: (payload) => ipcRenderer.send('chat:send', payload),
  onChatDelta: (callback) => subscribe('chat:delta', callback),
  onChatStatus: (callback) => subscribe('chat:status', callback),
  onChatDone: (callback) => subscribe('chat:done', callback),
  onChatError: (callback) => subscribe('chat:error', callback),

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  version: () => ipcRenderer.invoke('app:version'),
  platform: process.platform,
});
