class ActivityLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 entries
    this.currentFilter = 'all';
    this.loadLogs();
  }

  loadLogs() {
    const savedLogs = localStorage.getItem('activityLogs');
    if (savedLogs) {
      try {
        this.logs = JSON.parse(savedLogs);
      } catch (error) {
        console.error('Failed to load activity logs:', error);
        this.logs = [];
      }
    }
  }

  saveLogs() {
    try {
      localStorage.setItem('activityLogs', JSON.stringify(this.logs));
    } catch (error) {
      console.error('Failed to save activity logs:', error);
      // If localStorage is full, remove old entries
      if (this.logs.length > 100) {
        this.logs = this.logs.slice(-100);
        localStorage.setItem('activityLogs', JSON.stringify(this.logs));
      }
    }
  }

  addLog(type, message, details = {}) {
    const logEntry = {
      id: Date.now() + Math.random(), // Unique ID
      timestamp: new Date().toISOString(),
      type: type, // 'upload', 'download', 'error', 'info', 'success'
      message: message,
      details: details
    };

    this.logs.push(logEntry);

    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    this.saveLogs();
    this.updateDisplay();
    this.updateBadge();

    return logEntry;
  }

  clearLogs() {
    this.logs = [];
    this.saveLogs();
    this.updateDisplay();
    this.updateBadge();
  }

  exportLogs() {
    const logText = this.logs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      const details = Object.entries(log.details)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      return `[${timestamp}] ${log.type.toUpperCase()}: ${log.message}${details ? ' (' + details + ')' : ''}`;
    }).join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ftp-activity-log-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.updateDisplay();
  }

  getFilteredLogs() {
    if (this.currentFilter === 'all') {
      return this.logs;
    }

    return this.logs.filter(log => {
      switch (this.currentFilter) {
        case 'success':
          return log.type === 'success';
        case 'error':
          return log.type === 'error';
        case 'upload':
          return log.type === 'upload';
        case 'download':
          return log.type === 'download';
        default:
          return true;
      }
    });
  }

  updateDisplay() {
    const logContainer = document.getElementById('activity-log');
    if (!logContainer) return;

    const filteredLogs = this.getFilteredLogs();
    
    if (filteredLogs.length === 0) {
      logContainer.innerHTML = '<div class="empty-log">No activity logs</div>';
      return;
    }

    // Display logs in reverse order (newest first)
    logContainer.innerHTML = filteredLogs
      .slice()
      .reverse()
      .map(log => this.createLogElement(log))
      .join('');
  }

  createLogElement(log) {
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    const statusClass = log.type === 'error' ? 'error' : log.type === 'success' ? 'success' : '';
    const typeClass = log.type === 'upload' ? 'upload' : log.type === 'download' ? 'download' : '';
    
    let detailsHtml = '';
    if (log.details && Object.keys(log.details).length > 0) {
      const detailsText = Object.entries(log.details)
        .map(([key, value]) => {
          if (key === 'size' && typeof value === 'number') {
            return `<span>${key}: ${this.formatSize(value)}</span>`;
          } else if (key === 'speed' && typeof value === 'number') {
            return `<span>${key}: ${this.formatSpeed(value)}</span>`;
          } else if (key === 'duration' && typeof value === 'number') {
            return `<span>${key}: ${this.formatDuration(value)}</span>`;
          }
          return `<span>${key}: ${value}</span>`;
        })
        .join('');
      detailsHtml = `<div class="log-details">${detailsText}</div>`;
    }

    return `
      <div class="log-entry ${statusClass}">
        <span class="log-timestamp">${timestamp}</span>
        <span class="log-type ${typeClass}">[${log.type.toUpperCase()}]</span>
        <span class="log-message">${this.escapeHtml(log.message)}</span>
        ${detailsHtml}
      </div>
    `;
  }

  updateBadge() {
    const badge = document.getElementById('log-count-badge');
    if (badge) {
      const count = this.logs.length;
      badge.textContent = count > 999 ? '999+' : count.toString();
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) return bytesPerSecond + ' B/s';
    if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
    return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MB/s';
  }

  formatDuration(milliseconds) {
    if (milliseconds < 1000) return milliseconds + 'ms';
    const seconds = milliseconds / 1000;
    if (seconds < 60) return seconds.toFixed(1) + 's';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

module.exports = { ActivityLogger };