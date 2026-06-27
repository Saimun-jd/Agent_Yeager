const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getLocalIP: () => ipcRenderer.invoke('get-local-ip')
});
