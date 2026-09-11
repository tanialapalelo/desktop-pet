// preload.js
// Runs in an isolated context before each renderer loads. Exposes a small,
// explicit API on window.api, renderers never get direct access to
// ipcRenderer, Node, or the filesystem.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pet: {
    hover: (isHover) => ipcRenderer.send('pet:hover', isHover),
    click: () => ipcRenderer.send('pet:click'),
    onInit: (cb) => ipcRenderer.on('pet:init', (event, data) => cb(data)),
    onCommand: (cb) => ipcRenderer.on('pet:command', (event, cmd) => cb(cmd))
  },
  summon: {
    click: () => ipcRenderer.send('summon:click'),
    drag: (payload) => ipcRenderer.send('summon:drag', payload),
    onInit: (cb) => ipcRenderer.on('summon:init', (event, data) => cb(data))
  },
  chat: {
    send: (text) => ipcRenderer.invoke('chat:send', text),
    close: () => ipcRenderer.send('chat:close'),
    onInit: (cb) => ipcRenderer.on('chat:init', (event, data) => cb(data))
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial) => ipcRenderer.invoke('settings:set', partial),
    setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
    clearApiKey: () => ipcRenderer.invoke('settings:clearApiKey'),
    hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
    close: () => ipcRenderer.send('settings:close')
  },
  pause: {
    set: (mode) => ipcRenderer.invoke('pause:set', mode),
    get: () => ipcRenderer.invoke('pause:get')
  }
});
