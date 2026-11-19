const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mareoWidget', {
  resize: (w, h) => ipcRenderer.send('mw:resize', { w, h }),
  dragStart: (sx, sy) => ipcRenderer.send('mw:drag-start', { sx, sy }),
  drag: (sx, sy) => ipcRenderer.send('mw:drag', { sx, sy }),
  dragEnd: () => ipcRenderer.send('mw:drag-end'),
  quit: () => ipcRenderer.send('mw:quit'),
});
