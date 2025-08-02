const { v4: uuidv4 } = require('uuid');

class TabManager {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this.tabCounter = 0;
  }

  createTab(title = 'New Connection') {
    const tabId = uuidv4();
    const tab = {
      id: tabId,
      title,
      connection: null,
      connectionConfig: null,
      localPath: '/',
      remotePath: '/',
      localFiles: [],
      remoteFiles: [],
      selectedLocalFile: null,
      selectedRemoteFile: null,
      terminal: null,
      terminalContainer: null,
      localSearchTerm: '',
      remoteSearchTerm: ''
    };
    
    this.tabs.set(tabId, tab);
    this.renderTab(tab);
    this.switchToTab(tabId);
    
    return tabId;
  }

  renderTab(tab) {
    const tabsContainer = document.getElementById('tabs-container');
    
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = tab.id;
    
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    };
    
    tabEl.appendChild(titleEl);
    tabEl.appendChild(closeBtn);
    
    tabEl.onclick = () => this.switchToTab(tab.id);
    
    tabsContainer.appendChild(tabEl);
  }

  switchToTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    // Save current tab state
    if (this.activeTabId && this.activeTabId !== tabId) {
      this.saveTabState(this.activeTabId);
    }
    
    // Update active tab
    this.activeTabId = tabId;
    
    // Update UI
    document.querySelectorAll('.tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === tabId);
    });
    
    // Restore tab state
    this.restoreTabState(tabId);
  }

  saveTabState(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    // Save current paths
    tab.localPath = document.getElementById('local-path').value;
    tab.remotePath = document.getElementById('remote-path').value;
    
    // Save search terms
    tab.localSearchTerm = document.getElementById('local-search').value;
    tab.remoteSearchTerm = document.getElementById('remote-search').value;
    
    // Save terminal state
    const terminalContainer = document.getElementById('terminal-container');
    if (terminalContainer.style.display !== 'none') {
      tab.terminalVisible = true;
    }
  }

  restoreTabState(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    // Update global variables
    window.currentConnection = tab.connection;
    window.currentConnectionConfig = tab.connectionConfig;
    window.selectedLocalFile = tab.selectedLocalFile;
    window.selectedRemoteFile = tab.selectedRemoteFile;
    window.allLocalFiles = tab.localFiles;
    window.allRemoteFiles = tab.remoteFiles;
    
    // Update paths
    document.getElementById('local-path').value = tab.localPath;
    document.getElementById('remote-path').value = tab.remotePath;
    
    // Update search
    document.getElementById('local-search').value = tab.localSearchTerm;
    document.getElementById('remote-search').value = tab.remoteSearchTerm;
    
    // Update connection status
    if (tab.connection) {
      document.getElementById('connection-status').textContent = `Connected to ${tab.connectionConfig.host}`;
      this.enableControls(true);
    } else {
      document.getElementById('connection-status').textContent = 'Not connected';
      this.enableControls(false);
    }
    
    // Reload file lists
    if (window.loadLocalDirectory) {
      window.loadLocalDirectory(tab.localPath);
    }
    
    if (tab.connection && window.loadRemoteDirectory) {
      window.loadRemoteDirectory(tab.remotePath);
    } else {
      document.getElementById('remote-file-list').innerHTML = '';
    }
    
    // Update terminal visibility
    const terminalContainer = document.getElementById('terminal-container');
    if (tab.terminalVisible && tab.connection) {
      terminalContainer.style.display = 'flex';
    } else {
      terminalContainer.style.display = 'none';
    }
  }

  updateTabTitle(tabId, title) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    tab.title = title;
    
    const tabEl = document.querySelector(`[data-tab-id="${tabId}"] .tab-title`);
    if (tabEl) {
      tabEl.textContent = title;
    }
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    // Disconnect if connected
    if (tab.connection) {
      window.ipcRenderer.invoke('disconnect', tab.connection);
    }
    
    // Remove tab element
    const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      tabEl.remove();
    }
    
    // Remove from map
    this.tabs.delete(tabId);
    
    // If this was the active tab, switch to another
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchToTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        // Create a new tab if no tabs remain
        this.createTab();
      }
    }
  }

  getCurrentTab() {
    return this.tabs.get(this.activeTabId);
  }

  updateCurrentTab(updates) {
    const tab = this.getCurrentTab();
    if (!tab) return;
    
    Object.assign(tab, updates);
  }

  enableControls(enabled) {
    document.getElementById('btn-disconnect').disabled = !enabled;
    document.getElementById('remote-path').disabled = !enabled;
    document.getElementById('btn-upload').disabled = !enabled || !window.selectedLocalFile;
    document.getElementById('btn-download').disabled = !enabled || !window.selectedRemoteFile;
    document.getElementById('remote-search').disabled = !enabled;
    document.getElementById('clear-remote-search').disabled = !enabled;
  }

  getAllTabs() {
    return Array.from(this.tabs.values());
  }
}

module.exports = { TabManager };