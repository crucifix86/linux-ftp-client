const { Client: FTPClient } = require('basic-ftp');
const { Client: SSHClient } = require('ssh2');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { SpeedLimitManager } = require('./speedLimiter');

class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.speedLimitManager = new SpeedLimitManager();
  }

  async connect(config) {
    const connectionId = uuidv4();
    
    if (config.protocol === 'ftp' || config.protocol === 'ftps') {
      const client = new FTPClient();
      client.ftp.verbose = true;
      
      try {
        await client.access({
          host: config.host,
          port: config.port || 21,
          user: config.username,
          password: config.password,
          secure: config.protocol === 'ftps'
        });
        
        this.connections.set(connectionId, {
          id: connectionId,
          type: 'ftp',
          client,
          config
        });
        
        return { id: connectionId };
      } catch (error) {
        throw new Error(`FTP connection failed: ${error.message}`);
      }
    } else if (config.protocol === 'sftp') {
      const sshClient = new SSHClient();
      
      return new Promise((resolve, reject) => {
        let hasConnected = false;
        
        sshClient.on('ready', () => {
          hasConnected = true;
          console.log('SSH connection established');
          sshClient.sftp((err, sftp) => {
            if (err) {
              reject(new Error(`SFTP session failed: ${err.message}`));
              return;
            }
            
            this.connections.set(connectionId, {
              id: connectionId,
              type: 'sftp',
              client: sshClient,
              sftp,
              config
            });
            
            resolve({ id: connectionId });
          });
        });
        
        // Add debug event
        sshClient.on('debug', (info) => {
          console.log('SSH2 Debug:', info);
        });
        
        sshClient.on('error', (err) => {
          console.error('SSH Error:', err);
          if (!hasConnected) {
            reject(new Error(`SSH connection failed: ${err.message}`));
          }
        });
        
        sshClient.on('close', () => {
          if (!hasConnected) {
            reject(new Error('SSH connection closed before authentication'));
          }
        });
        
        const connectConfig = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          tryKeyboard: true,
          readyTimeout: 30000,
          debug: console.log,
          algorithms: {
            serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519'],
            kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256'],
            cipher: ['aes128-gcm', 'aes256-gcm', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
            hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
          }
        };
        
        if (config.password) {
          connectConfig.password = config.password;
          console.log('Using password authentication');
        } else if (config.privateKeyPath) {
          const fs = require('fs');
          try {
            connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
            if (config.passphrase) {
              connectConfig.passphrase = config.passphrase;
            }
          } catch (err) {
            reject(new Error(`Failed to read private key: ${err.message}`));
            return;
          }
        }
        
        // Handle keyboard-interactive authentication
        sshClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
          // Auto-respond with password for common password prompts
          if (config.password && prompts.length > 0) {
            finish([config.password]);
          } else {
            finish([]);
          }
        });
        
        sshClient.connect(connectConfig);
      });
    } else {
      throw new Error(`Unsupported protocol: ${config.protocol}`);
    }
  }

  async disconnect(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'ftp') {
      connection.client.close();
    } else if (connection.type === 'sftp') {
      connection.client.end();
    }
    
    this.connections.delete(connectionId);
  }

  async listDirectory(connectionId, remotePath = '/') {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'ftp') {
      const list = await connection.client.list(remotePath);
      return list.map(item => ({
        name: item.name,
        type: item.type === 2 ? 'directory' : 'file',
        size: item.size,
        modifiedAt: item.modifiedAt,
        permissions: item.permissions
      }));
    } else if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        connection.sftp.readdir(remotePath, (err, list) => {
          if (err) {
            reject(err);
            return;
          }
          
          resolve(list.map(item => ({
            name: item.filename,
            type: item.attrs.isDirectory() ? 'directory' : 'file',
            size: item.attrs.size,
            modifiedAt: new Date(item.attrs.mtime * 1000),
            permissions: item.attrs.mode
          })));
        });
      });
    }
  }

  async downloadFile(connectionId, remotePath, localPath, progressCallback) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    console.log(`Downloading file from ${remotePath} to ${localPath}`);
    
    if (connection.type === 'ftp') {
      await connection.client.downloadTo(localPath, remotePath);
    } else if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        // Get file size first for progress calculation
        connection.sftp.stat(remotePath, (err, stats) => {
          if (err) {
            reject(new Error(`Failed to get file info: ${err.message}`));
            return;
          }
          
          const fileSize = stats.size;
          let lastTime = Date.now();
          let lastTransferred = 0;
          let startTime = Date.now();
          let totalTransferred = 0;
          
          // Get speed limit for this connection
          const speedLimit = this.speedLimitManager.getEffectiveLimit(connectionId, 'download');
          const chunkSize = speedLimit === Infinity ? 65536 : Math.min(65536, speedLimit / 10); // Adjust chunk size based on speed limit
          
          // Add options for better error handling and progress
          const options = {
            chunkSize: chunkSize,
            step: (total_transferred, chunk, total) => {
              totalTransferred = total_transferred;
              const percent = Math.round((total_transferred / total) * 100);
              console.log(`Download progress: ${percent}%`);
              
              // Speed limiting logic
              if (speedLimit !== Infinity) {
                const elapsed = (Date.now() - startTime) / 1000;
                const expectedBytes = elapsed * speedLimit;
                
                if (totalTransferred > expectedBytes) {
                  // We're going too fast, calculate delay
                  const excessBytes = totalTransferred - expectedBytes;
                  const delay = (excessBytes / speedLimit) * 1000;
                  
                  // Pause the transfer briefly
                  return new Promise(resolve => setTimeout(resolve, delay));
                }
              }
              
              if (progressCallback) {
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000; // seconds
                const bytesDiff = total_transferred - lastTransferred;
                const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                
                progressCallback({
                  percent,
                  transferred: total_transferred,
                  total: fileSize,
                  speed,
                  speedLimit: speedLimit === Infinity ? null : speedLimit
                });
                
                lastTime = now;
                lastTransferred = total_transferred;
              }
            }
          };
          
          connection.sftp.fastGet(remotePath, localPath, options, (err) => {
            if (err) {
              console.error('SFTP download error:', err);
              reject(new Error(`Download failed: ${err.message}`));
            } else {
              console.log('Download completed successfully');
              
              // Preserve timestamps if enabled
              if (connection.config.preserveTimestamps) {
                try {
                  const fs = require('fs');
                  // Use the remote file's timestamps
                  fs.utimesSync(localPath, new Date(stats.atime * 1000), new Date(stats.mtime * 1000));
                  console.log('Timestamps preserved');
                } catch (tsError) {
                  console.error('Failed to preserve timestamps:', tsError);
                }
              }
              
              resolve();
            }
          });
        });
      });
    }
  }

  async uploadFile(connectionId, localPath, remotePath, progressCallback) {
    console.log('ConnectionManager: uploadFile called', { connectionId, connections: this.connections.size });
    const connection = this.connections.get(connectionId);
    if (!connection) {
      console.error('Connection not found. Available connections:', Array.from(this.connections.keys()));
      throw new Error('Connection not found');
    }
    
    console.log(`Uploading file from ${localPath} to ${remotePath}`);
    
    // Check if local file exists
    const fs = require('fs');
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }
    
    const fileStats = fs.statSync(localPath);
    const fileSize = fileStats.size;
    
    if (connection.type === 'ftp') {
      await connection.client.uploadFrom(localPath, remotePath);
    } else if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        let lastTime = Date.now();
        let lastTransferred = 0;
        let startTime = Date.now();
        let totalTransferred = 0;
        
        // Get speed limit for this connection
        const speedLimit = this.speedLimitManager.getEffectiveLimit(connectionId, 'upload');
        const chunkSize = speedLimit === Infinity ? 65536 : Math.min(65536, speedLimit / 10); // Adjust chunk size based on speed limit
        
        // Add options for better error handling and progress
        const options = {
          chunkSize: chunkSize,
          step: (total_transferred, chunk, total) => {
            totalTransferred = total_transferred;
            const percent = Math.round((total_transferred / total) * 100);
            console.log(`Upload progress: ${percent}%`);
            
            // Speed limiting logic
            if (speedLimit !== Infinity) {
              const elapsed = (Date.now() - startTime) / 1000;
              const expectedBytes = elapsed * speedLimit;
              
              if (totalTransferred > expectedBytes) {
                // We're going too fast, calculate delay
                const excessBytes = totalTransferred - expectedBytes;
                const delay = (excessBytes / speedLimit) * 1000;
                
                // Pause the transfer briefly
                return new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            
            if (progressCallback) {
              const now = Date.now();
              const timeDiff = (now - lastTime) / 1000; // seconds
              const bytesDiff = total_transferred - lastTransferred;
              const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
              
              progressCallback({
                percent,
                transferred: total_transferred,
                total: fileSize,
                speed,
                speedLimit: speedLimit === Infinity ? null : speedLimit
              });
              
              lastTime = now;
              lastTransferred = total_transferred;
            }
          }
        };
        
        // Set a timeout for the upload
        const uploadTimeout = setTimeout(() => {
          reject(new Error('Upload timeout - operation took too long'));
        }, 30000); // 30 second timeout
        
        connection.sftp.fastPut(localPath, remotePath, options, (err) => {
          clearTimeout(uploadTimeout);
          
          if (err) {
            console.error('SFTP upload error:', err);
            console.error('Error code:', err.code);
            console.error('Local path:', localPath);
            console.error('Remote path:', remotePath);
            
            // Check if it's a permission error
            if (err.code === 3 || err.message.includes('Permission denied')) {
              reject(new Error(`Permission denied: Cannot write to ${remotePath}`));
            } else if (err.code === 2 || err.message.includes('No such file')) {
              reject(new Error(`Remote directory does not exist: ${require('path').dirname(remotePath)}`));
            } else {
              reject(new Error(`Upload failed: ${err.message} (code: ${err.code})`));
            }
          } else {
            console.log('Upload completed successfully');
            
            // Preserve timestamps if enabled
            if (connection.config.preserveTimestamps) {
              // Set the remote file's timestamps to match local file
              connection.sftp.utimes(remotePath, fileStats.atime.getTime() / 1000, fileStats.mtime.getTime() / 1000, (tsErr) => {
                if (tsErr) {
                  console.error('Failed to preserve timestamps:', tsErr);
                } else {
                  console.log('Timestamps preserved on remote file');
                }
                resolve();
              });
            } else {
              resolve();
            }
          }
        });
      });
    }
  }

  createTerminal(config) {
    // For SFTP connections, we'll create an SSH shell session
    if (config && config.protocol === 'sftp') {
      const connectionId = [...this.connections.entries()]
        .find(([id, conn]) => conn.config.host === config.host && conn.config.username === config.username)?.[0];
      
      if (connectionId) {
        const connection = this.connections.get(connectionId);
        if (connection && connection.type === 'sftp') {
          return new Promise((resolve, reject) => {
            connection.client.shell((err, stream) => {
              if (err) {
                reject(err);
                return;
              }
              
              resolve({
                stream,
                write: (data) => stream.write(data),
                onData: (callback) => stream.on('data', callback),
                onClose: (callback) => stream.on('close', callback),
                resize: (cols, rows) => stream.setWindow(rows, cols, 480, 640)
              });
            });
          });
        }
      }
    }
    
    return Promise.reject(new Error('Terminal only available for SFTP connections'));
  }
  
  async renameFile(connectionId, oldPath, newPath) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        connection.sftp.rename(oldPath, newPath, (err) => {
          if (err) {
            reject(new Error(`Rename failed: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      throw new Error('Rename not supported for FTP connections');
    }
  }
  
  async deleteFile(connectionId, filePath) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        connection.sftp.unlink(filePath, (err) => {
          if (err) {
            reject(new Error(`Delete failed: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    } else if (connection.type === 'ftp') {
      await connection.client.remove(filePath);
    }
  }
  
  async getFileStats(connectionId, filePath) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        connection.sftp.stat(filePath, (err, stats) => {
          if (err) {
            reject(new Error(`Failed to get file stats: ${err.message}`));
          } else {
            resolve(stats);
          }
        });
      });
    } else {
      throw new Error('File stats not available for FTP connections');
    }
  }
  
  async chmod(connectionId, filePath, mode) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        const modeInt = parseInt(mode, 8);
        connection.sftp.chmod(filePath, modeInt, (err) => {
          if (err) {
            reject(new Error(`Failed to change permissions: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      throw new Error('Chmod not supported for FTP connections');
    }
  }
  
  async createDirectory(connectionId, remotePath) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    if (connection.type === 'sftp') {
      return new Promise((resolve, reject) => {
        // Create directory recursively
        const pathParts = remotePath.split('/').filter(p => p);
        let currentPath = remotePath.startsWith('/') ? '/' : '';
        
        const createNext = (index) => {
          if (index >= pathParts.length) {
            resolve();
            return;
          }
          
          currentPath = path.join(currentPath, pathParts[index]);
          
          // Check if directory exists
          connection.sftp.stat(currentPath, (err, stats) => {
            if (!err && stats.isDirectory()) {
              // Directory exists, continue with next
              createNext(index + 1);
            } else {
              // Create directory
              connection.sftp.mkdir(currentPath, (mkdirErr) => {
                if (mkdirErr && mkdirErr.code !== 4) { // 4 = file already exists
                  reject(new Error(`Failed to create directory ${currentPath}: ${mkdirErr.message}`));
                } else {
                  createNext(index + 1);
                }
              });
            }
          });
        };
        
        createNext(0);
      });
    } else if (connection.type === 'ftp') {
      await connection.client.ensureDir(remotePath);
    }
  }
  
  setSpeedLimit(connectionId, type, bytesPerSecond) {
    this.speedLimitManager.setLimit(connectionId, type, bytesPerSecond);
  }
  
  setGlobalSpeedLimit(type, bytesPerSecond) {
    this.speedLimitManager.setGlobalLimit(type, bytesPerSecond);
  }
  
  getSpeedLimits(connectionId) {
    return {
      upload: this.speedLimitManager.getLimit(connectionId, 'upload'),
      download: this.speedLimitManager.getLimit(connectionId, 'download'),
      globalUpload: (this.speedLimitManager.globalLimits && this.speedLimitManager.globalLimits.upload) || Infinity,
      globalDownload: (this.speedLimitManager.globalLimits && this.speedLimitManager.globalLimits.download) || Infinity
    };
  }
}

module.exports = { ConnectionManager };