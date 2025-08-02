const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  connectFTP: (config) => ipcRenderer.invoke('connect-ftp', config),
  disconnect: (connectionId) => ipcRenderer.invoke('disconnect', connectionId),
  listDirectory: (connectionId, path) => ipcRenderer.invoke('list-directory', connectionId, path),
  downloadFile: (connectionId, remotePath, localPath) => ipcRenderer.invoke('download-file', connectionId, remotePath, localPath),
  uploadFile: (connectionId, localPath, remotePath) => ipcRenderer.invoke('upload-file', connectionId, localPath, remotePath),
  createTerminal: (config) => ipcRenderer.invoke('create-terminal', config),
  
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onUploadProgress: (callback) => ipcRenderer.on('upload-progress', callback),
  onTerminalData: (callback) => ipcRenderer.on('terminal-data', callback),
  sendTerminalData: (data) => ipcRenderer.send('terminal-input', data),
  
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  getProfile: (id) => ipcRenderer.invoke('get-profile', id),
  deleteProfile: (id) => ipcRenderer.invoke('delete-profile', id),
  getRecentProfiles: () => ipcRenderer.invoke('get-recent-profiles')
});