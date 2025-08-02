const { ipcRenderer } = require('electron');
const path = require('path');

class TransferQueue {
  constructor() {
    this.queue = [];
    this.activeTransfers = new Map();
    this.maxConcurrent = 3;
    this.isPaused = false;
    this.queueId = 0;
  }

  addTransfer(transfer) {
    const id = ++this.queueId;
    const queueItem = {
      id,
      type: transfer.type, // 'upload' or 'download'
      localPath: transfer.localPath,
      remotePath: transfer.remotePath,
      fileName: path.basename(transfer.type === 'upload' ? transfer.localPath : transfer.remotePath),
      size: transfer.size || 0,
      connectionId: transfer.connectionId,
      status: 'queued',
      progress: 0,
      speed: 0,
      startTime: null,
      error: null,
      isPaused: false
    };
    
    this.queue.push(queueItem);
    this.updateQueueDisplay();
    this.processQueue();
    
    return id;
  }

  async processQueue() {
    if (this.isPaused) return;
    
    // Check if we can start more transfers
    const activeCount = Array.from(this.activeTransfers.values()).filter(t => t.status === 'active').length;
    if (activeCount >= this.maxConcurrent) return;
    
    // Find next queued transfer
    const nextTransfer = this.queue.find(t => t.status === 'queued' && !t.isPaused);
    if (!nextTransfer) return;
    
    // Start the transfer
    nextTransfer.status = 'active';
    nextTransfer.startTime = Date.now();
    this.activeTransfers.set(nextTransfer.id, nextTransfer);
    
    try {
      await this.executeTransfer(nextTransfer);
      
      // Notify about completion
      if (typeof window !== 'undefined' && window.loadRemoteDirectory) {
        window.loadRemoteDirectory(window.document.getElementById('remote-path').value);
      }
    } catch (error) {
      nextTransfer.status = 'error';
      nextTransfer.error = error.message;
    }
    
    this.activeTransfers.delete(nextTransfer.id);
    this.updateQueueDisplay();
    
    // Process next item
    setTimeout(() => this.processQueue(), 100);
  }

  async executeTransfer(transfer) {
    const progressCallback = (progress) => {
      transfer.progress = progress.percent || 0;
      transfer.speed = progress.speed || 0;
      this.updateTransferProgress(transfer.id);
    };
    
    try {
      if (transfer.type === 'upload') {
        const result = await ipcRenderer.invoke('upload-file-with-progress', 
          transfer.connectionId, 
          transfer.localPath, 
          transfer.remotePath,
          transfer.id
        );
        
        if (result.success) {
          transfer.status = 'completed';
          transfer.progress = 100;
          
          // Log successful upload
          if (window.activityLogger) {
            const duration = Date.now() - transfer.startTime;
            window.activityLogger.addLog('upload', `Uploaded ${transfer.fileName}`, {
              file: transfer.fileName,
              size: transfer.size,
              duration: duration,
              speed: transfer.speed || 0,
              path: transfer.remotePath
            });
          }
          
          // Clean up compressed temporary file if needed
          if (transfer.deleteAfterUpload && transfer.localPath) {
            try {
              await fs.unlink(transfer.localPath);
              console.log(`Cleaned up temporary compressed file: ${transfer.localPath}`);
            } catch (error) {
              console.warn(`Failed to clean up temporary file: ${error.message}`);
            }
          }
        } else {
          throw new Error(result.error);
        }
      } else {
        const result = await ipcRenderer.invoke('download-file-with-progress',
          transfer.connectionId,
          transfer.remotePath,
          transfer.localPath,
          transfer.id
        );
        
        if (result.success) {
          transfer.status = 'completed';
          transfer.progress = 100;
          
          // Log successful download
          if (window.activityLogger) {
            const duration = Date.now() - transfer.startTime;
            window.activityLogger.addLog('download', `Downloaded ${transfer.fileName}`, {
              file: transfer.fileName,
              size: transfer.size,
              duration: duration,
              speed: transfer.speed || 0,
              path: transfer.localPath
            });
          }
        } else {
          throw new Error(result.error);
        }
      }
    } catch (error) {
      transfer.status = 'error';
      transfer.error = error.message;
      
      // Log transfer error
      if (window.activityLogger) {
        window.activityLogger.addLog('error', `Transfer failed: ${transfer.fileName}`, {
          file: transfer.fileName,
          error: error.message,
          type: transfer.type,
          path: transfer.type === 'upload' ? transfer.remotePath : transfer.localPath
        });
      }
      
      throw error;
    }
  }

  pauseTransfer(id) {
    const transfer = this.queue.find(t => t.id === id);
    if (transfer && transfer.status === 'active') {
      transfer.isPaused = true;
      transfer.status = 'paused';
      ipcRenderer.send('pause-transfer', id);
      this.updateQueueDisplay();
    }
  }

  resumeTransfer(id) {
    const transfer = this.queue.find(t => t.id === id);
    if (transfer && transfer.status === 'paused') {
      transfer.isPaused = false;
      transfer.status = 'queued';
      this.updateQueueDisplay();
      this.processQueue();
    }
  }

  cancelTransfer(id) {
    const transfer = this.queue.find(t => t.id === id);
    if (transfer) {
      if (transfer.status === 'active') {
        ipcRenderer.send('cancel-transfer', id);
      }
      transfer.status = 'cancelled';
      this.activeTransfers.delete(id);
      this.updateQueueDisplay();
      this.processQueue();
    }
  }

  pauseAll() {
    this.isPaused = true;
    this.queue.forEach(transfer => {
      if (transfer.status === 'active') {
        this.pauseTransfer(transfer.id);
      }
    });
  }

  resumeAll() {
    this.isPaused = false;
    this.queue.forEach(transfer => {
      if (transfer.status === 'paused') {
        this.resumeTransfer(transfer.id);
      }
    });
  }

  clearCompleted() {
    this.queue = this.queue.filter(t => 
      t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'error'
    );
    this.updateQueueDisplay();
  }

  updateTransferProgress(id) {
    const queueItem = document.querySelector(`[data-transfer-id="${id}"]`);
    if (!queueItem) return;
    
    const transfer = this.queue.find(t => t.id === id);
    if (!transfer) return;
    
    const progressBar = queueItem.querySelector('.queue-item-progress-bar');
    const infoEl = queueItem.querySelector('.queue-item-info');
    
    if (progressBar) {
      progressBar.style.width = `${transfer.progress}%`;
    }
    
    if (infoEl) {
      const speedText = transfer.speed ? ` - ${this.formatSpeed(transfer.speed)}` : '';
      infoEl.textContent = `${transfer.type === 'upload' ? 'Uploading' : 'Downloading'} - ${transfer.progress}%${speedText}`;
    }
  }

  updateQueueDisplay() {
    const queueList = document.getElementById('queue-list');
    const queueBtn = document.getElementById('btn-show-queue');
    
    if (!queueList) return;
    
    // Update badge count
    if (window.updateQueueBadge) {
      window.updateQueueBadge();
    }
    
    // Update queue button
    const activeCount = this.queue.filter(t => 
      ['active', 'queued', 'paused'].includes(t.status)
    ).length;
    
    if (activeCount > 0) {
      queueBtn.style.display = 'block';
      queueBtn.textContent = `Queue (${activeCount})`;
    } else if (this.queue.length > 0) {
      queueBtn.style.display = 'block';
      queueBtn.textContent = `Queue (${this.queue.length})`;
    } else {
      queueBtn.style.display = 'none';
    }
    
    // Update queue list
    queueList.innerHTML = '';
    
    this.queue.forEach(transfer => {
      const item = this.createQueueItemElement(transfer);
      queueList.appendChild(item);
    });
  }

  createQueueItemElement(transfer) {
    const item = document.createElement('div');
    item.className = `queue-item ${transfer.status}`;
    item.dataset.transferId = transfer.id;
    
    const header = document.createElement('div');
    header.className = 'queue-item-header';
    
    const name = document.createElement('div');
    name.className = 'queue-item-name';
    name.textContent = transfer.fileName;
    name.title = transfer.fileName;
    
    // Add compression indicator if applicable
    if (transfer.isCompressed) {
      const compressionBadge = document.createElement('span');
      compressionBadge.style.marginLeft = '8px';
      compressionBadge.style.fontSize = '12px';
      compressionBadge.style.color = '#4caf50';
      compressionBadge.textContent = `[${Math.round(transfer.compressionRatio * 100)}%]`;
      compressionBadge.title = `Compressed to ${Math.round(transfer.compressionRatio * 100)}% of original size`;
      name.appendChild(compressionBadge);
    }
    
    const controls = document.createElement('div');
    controls.className = 'queue-item-controls';
    
    if (transfer.status === 'active') {
      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'queue-item-btn';
      pauseBtn.textContent = '⏸';
      pauseBtn.title = 'Pause';
      pauseBtn.onclick = () => this.pauseTransfer(transfer.id);
      controls.appendChild(pauseBtn);
    } else if (transfer.status === 'paused') {
      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'queue-item-btn';
      resumeBtn.textContent = '▶';
      resumeBtn.title = 'Resume';
      resumeBtn.onclick = () => this.resumeTransfer(transfer.id);
      controls.appendChild(resumeBtn);
    }
    
    if (['active', 'queued', 'paused'].includes(transfer.status)) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'queue-item-btn';
      cancelBtn.textContent = '✕';
      cancelBtn.title = 'Cancel';
      cancelBtn.onclick = () => this.cancelTransfer(transfer.id);
      controls.appendChild(cancelBtn);
    }
    
    header.appendChild(name);
    header.appendChild(controls);
    
    const info = document.createElement('div');
    info.className = 'queue-item-info';
    
    let statusText = '';
    switch (transfer.status) {
      case 'queued':
        statusText = 'Waiting in queue';
        break;
      case 'active':
        statusText = `${transfer.type === 'upload' ? 'Uploading' : 'Downloading'} - ${transfer.progress}%`;
        break;
      case 'paused':
        statusText = `Paused - ${transfer.progress}%`;
        break;
      case 'completed':
        statusText = 'Completed';
        break;
      case 'error':
        statusText = `Error: ${transfer.error}`;
        break;
      case 'cancelled':
        statusText = 'Cancelled';
        break;
    }
    
    info.textContent = statusText;
    
    const progressContainer = document.createElement('div');
    progressContainer.className = 'queue-item-progress';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'queue-item-progress-bar';
    progressBar.style.width = `${transfer.progress}%`;
    
    progressContainer.appendChild(progressBar);
    
    item.appendChild(header);
    item.appendChild(info);
    item.appendChild(progressContainer);
    
    return item;
  }

  formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
}

module.exports = { TransferQueue };