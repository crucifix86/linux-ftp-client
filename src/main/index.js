const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { Client } = require('ssh2');
const { ConnectionManager } = require('./connectionManager');
const { ProfileManager } = require('./profileManager');
const { BookmarksManager } = require('./bookmarksManager');
const { SSHKeyManager } = require('./sshKeyManager');
const { createAppMenu } = require('./menu');

let mainWindow;
let connectionManager;
let profileManager;
let bookmarksManager;
let sshKeyManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  const menu = createAppMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(() => {
  connectionManager = new ConnectionManager();
  profileManager = new ProfileManager();
  bookmarksManager = new BookmarksManager();
  sshKeyManager = new SSHKeyManager();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('connect-ftp', async (event, config) => {
  try {
    const connection = await connectionManager.connect(config);
    return { success: true, connectionId: connection.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect', async (event, connectionId) => {
  try {
    await connectionManager.disconnect(connectionId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-directory', async (event, connectionId, path) => {
  try {
    const files = await connectionManager.listDirectory(connectionId, path);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-file', async (event, connectionId, remotePath, localPath) => {
  try {
    await connectionManager.downloadFile(connectionId, remotePath, localPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('upload-file', async (event, connectionId, localPath, remotePath) => {
  try {
    console.log('Main process: Upload request received', { connectionId, localPath, remotePath });
    await connectionManager.uploadFile(connectionId, localPath, remotePath);
    return { success: true };
  } catch (error) {
    console.error('Main process: Upload error', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('upload-file-with-progress', async (event, connectionId, localPath, remotePath, transferId) => {
  try {
    await connectionManager.uploadFile(connectionId, localPath, remotePath, (progress) => {
      event.sender.send('transfer-progress', transferId, progress);
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-file-with-progress', async (event, connectionId, remotePath, localPath, transferId) => {
  try {
    await connectionManager.downloadFile(connectionId, remotePath, localPath, (progress) => {
      event.sender.send('transfer-progress', transferId, progress);
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('save-profile', async (event, profile) => {
  try {
    const id = profileManager.saveProfile(profile);
    return { success: true, id };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-profiles', async () => {
  try {
    const profiles = profileManager.getProfiles();
    return { success: true, profiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-profile', async (event, id) => {
  try {
    const profile = profileManager.getProfile(id);
    return { success: true, profile };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-profile', async (event, id) => {
  try {
    profileManager.deleteProfile(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-recent-profiles', async () => {
  try {
    const profiles = profileManager.getRecentProfiles();
    return { success: true, profiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-ssh-connection', async (event, config) => {
  const conn = new Client();
  
  return new Promise((resolve) => {
    let authMethods = [];
    
    conn.on('ready', () => {
      console.log('SSH test: Connection successful!');
      conn.end();
      resolve({ success: true, message: 'Connection successful!' });
    });
    
    conn.on('error', (err) => {
      console.error('SSH test error:', err);
      resolve({ success: false, error: err.message, authMethods });
    });
    
    conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
      console.log('SSH test: Keyboard-interactive auth requested');
      if (config.password && prompts.length > 0) {
        finish([config.password]);
      } else {
        finish([]);
      }
    });
    
    // Log available auth methods
    conn.on('continue', () => {
      console.log('SSH test: continue event');
    });
    
    const connectConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      tryKeyboard: true,
      debug: (msg) => console.log('SSH2 test debug:', msg),
      readyTimeout: 10000
    };
    
    console.log('SSH test: Attempting connection to', config.host, 'as', config.username);
    conn.connect(connectConfig);
  });
});

let terminalClient = null;
let terminalStream = null;

ipcMain.handle('create-terminal', async (event, config) => {
  try {
    // Close existing terminal if any
    if (terminalClient) {
      terminalClient.end();
      terminalClient = null;
      terminalStream = null;
    }
    
    const sshClient = new Client();
    terminalClient = sshClient;
    
    return new Promise((resolve) => {
      sshClient.on('ready', () => {
        sshClient.shell((err, stream) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          
          terminalStream = stream;
          
          stream.on('data', (data) => {
            event.sender.send('terminal-data', data.toString());
          });
          
          stream.on('close', () => {
            event.sender.send('terminal-closed');
            terminalStream = null;
          });
          
          resolve({ success: true });
        });
      });
      
      sshClient.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      
      const connectConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        tryKeyboard: true,
        algorithms: {
          kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
                'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256'],
          cipher: ['aes128-gcm', 'aes128-gcm@openssh.com', 'aes256-gcm', 'aes256-gcm@openssh.com'],
          serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
        }
      };
      
      // Add authentication
      if (config.authType === 'key' && config.privateKey) {
        const fs = require('fs');
        try {
          connectConfig.privateKey = fs.readFileSync(config.privateKey);
          if (config.passphrase) {
            connectConfig.passphrase = config.passphrase;
          }
        } catch (err) {
          console.error('Failed to read private key:', err);
          resolve({ success: false, error: `Failed to read private key: ${err.message}` });
          return;
        }
      } else if (config.password) {
        connectConfig.password = config.password;
      }
      
      // Handle keyboard-interactive
      sshClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        if (config.password && prompts.length > 0) {
          finish([config.password]);
        } else {
          finish([]);
        }
      });
      
      sshClient.connect(connectConfig);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('terminal-input', (event, data) => {
  if (terminalStream) {
    terminalStream.write(data);
  }
});

ipcMain.on('terminal-resize', (event, cols, rows) => {
  if (terminalStream && terminalStream.setWindow) {
    terminalStream.setWindow(rows, cols, 480, 640);
  }
});

ipcMain.handle('close-terminal', async () => {
  try {
    if (terminalClient) {
      terminalClient.end();
      terminalClient = null;
      terminalStream = null;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-file', async (event, connectionId, oldPath, newPath) => {
  try {
    await connectionManager.renameFile(connectionId, oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (event, connectionId, filePath) => {
  try {
    await connectionManager.deleteFile(connectionId, filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-file-stats', async (event, connectionId, filePath) => {
  try {
    const stats = await connectionManager.getFileStats(connectionId, filePath);
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chmod', async (event, connectionId, filePath, mode) => {
  try {
    await connectionManager.chmod(connectionId, filePath, mode);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-directory', async (event, connectionId, remotePath) => {
  try {
    await connectionManager.createDirectory(connectionId, remotePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('preview-file', async (event, connectionId, remotePath) => {
  try {
    const tempDir = require('os').tmpdir();
    const tempPath = require('path').join(tempDir, 'ftp-preview-' + Date.now() + require('path').extname(remotePath));
    
    await connectionManager.downloadFile(connectionId, remotePath, tempPath);
    
    const fs = require('fs');
    const fileData = fs.readFileSync(tempPath);
    
    // Clean up temp file
    fs.unlinkSync(tempPath);
    
    return { 
      success: true, 
      data: fileData.toString('base64'),
      mimeType: getMimeType(remotePath)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function getMimeType(filename) {
  const ext = require('path').extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.xml': 'text/xml',
    '.md': 'text/markdown',
    '.py': 'text/x-python',
    '.sh': 'text/x-shellscript',
    '.log': 'text/plain',
    '.conf': 'text/plain',
    '.ini': 'text/plain',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Bookmark handlers
ipcMain.handle('get-local-bookmarks', async () => {
  try {
    const bookmarks = bookmarksManager.getLocalBookmarks();
    return { success: true, bookmarks };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-remote-bookmarks', async () => {
  try {
    const bookmarks = bookmarksManager.getRemoteBookmarks();
    return { success: true, bookmarks };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-local-bookmark', async (event, bookmark) => {
  try {
    const newBookmark = bookmarksManager.addLocalBookmark(bookmark);
    return { success: true, bookmark: newBookmark };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-remote-bookmark', async (event, bookmark) => {
  try {
    const newBookmark = bookmarksManager.addRemoteBookmark(bookmark);
    return { success: true, bookmark: newBookmark };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-bookmark', async (event, id, isRemote) => {
  try {
    if (isRemote) {
      bookmarksManager.deleteRemoteBookmark(id);
    } else {
      bookmarksManager.deleteLocalBookmark(id);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-bookmark', async (event, id, newName, isRemote) => {
  try {
    const bookmark = bookmarksManager.renameBookmark(id, newName, isRemote);
    return { success: true, bookmark };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// SSH Key handlers
ipcMain.handle('generate-ssh-key', async (event, options) => {
  try {
    const keyInfo = await sshKeyManager.generateKey(options);
    return { success: true, key: keyInfo };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-ssh-keys', async () => {
  try {
    const keys = await sshKeyManager.listKeys();
    return { success: true, keys };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-ssh-key', async (event, keyId) => {
  try {
    await sshKeyManager.deleteKey(keyId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ssh-public-key', async (event, keyId) => {
  try {
    const publicKey = await sshKeyManager.getPublicKey(keyId);
    return { success: true, publicKey };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Compression handlers
ipcMain.handle('compress-file', async (event, filePath) => {
  const zlib = require('zlib');
  const fs = require('fs');
  const os = require('os');
  const { promisify } = require('util');
  const stat = promisify(fs.stat);
  
  try {
    const stats = await stat(filePath);
    const originalSize = stats.size;
    const fileName = path.basename(filePath);
    const compressedName = `${fileName}.gz`;
    const tempPath = path.join(os.tmpdir(), `ftp-compress-${Date.now()}-${compressedName}`);
    
    return new Promise((resolve) => {
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(tempPath);
      const gzip = zlib.createGzip({ level: 9 }); // Maximum compression
      
      readStream.pipe(gzip).pipe(writeStream);
      
      writeStream.on('finish', async () => {
        const compressedStats = await stat(tempPath);
        const compressedSize = compressedStats.size;
        const compressionRatio = compressedSize / originalSize;
        
        resolve({
          success: true,
          originalSize,
          compressedSize,
          compressionRatio,
          compressedPath: tempPath,
          compressedName
        });
      });
      
      readStream.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
      
      gzip.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('compress-folder', async (event, folderPath) => {
  const archiver = require('archiver');
  const fs = require('fs');
  const os = require('os');
  
  try {
    const folderName = path.basename(folderPath);
    const compressedName = `${folderName}.tar.gz`;
    const tempPath = path.join(os.tmpdir(), `ftp-compress-${Date.now()}-${compressedName}`);
    
    return new Promise((resolve) => {
      const output = fs.createWriteStream(tempPath);
      const archive = archiver('tar', {
        gzip: true,
        gzipOptions: { level: 9 }
      });
      
      let originalSize = 0;
      
      archive.on('entry', (entry) => {
        if (entry.stats && entry.stats.size) {
          originalSize += entry.stats.size;
        }
      });
      
      output.on('close', () => {
        const compressedSize = archive.pointer();
        const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;
        
        resolve({
          success: true,
          originalSize,
          compressedSize,
          compressionRatio,
          compressedPath: tempPath,
          compressedName
        });
      });
      
      archive.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
      
      archive.pipe(output);
      archive.directory(folderPath, false);
      archive.finalize();
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Speed limit handlers
ipcMain.handle('set-speed-limit', (event, connectionId, type, bytesPerSecond) => {
  connectionManager.setSpeedLimit(connectionId, type, bytesPerSecond);
  return { success: true };
});

ipcMain.handle('set-global-speed-limit', (event, type, bytesPerSecond) => {
  connectionManager.setGlobalSpeedLimit(type, bytesPerSecond);
  return { success: true };
});

ipcMain.handle('get-speed-limits', (event, connectionId) => {
  return connectionManager.getSpeedLimits(connectionId);
});