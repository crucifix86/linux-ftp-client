const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const fs = require('fs').promises;
const path = require('path');
const { ipcRenderer } = require('electron');
const { TransferQueue } = require('./transferQueue');
const { TabManager } = require('./tabManager');
const { ActivityLogger } = require('./activityLogger');
const { CodeEditor } = require('./editor');

let currentConnection = null;
let terminal = null;
let terminalFitAddon = null;
let terminalProcess = null;
let selectedLocalFile = null;
let selectedRemoteFile = null;
let currentConnectionConfig = null;
let allLocalFiles = [];
let allRemoteFiles = [];
let transferQueue = null;
let tabManager = null;
let activityLogger = null;
let codeEditor = null;
let currentFilters = {
  local: { types: ['all'], extensions: [], size: 'all' },
  remote: { types: ['all'], extensions: [], size: 'all' }
};
let sortOrders = {
  local: 'asc',
  remote: 'asc'
};
let currentFilterPanel = null;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupDragAndDrop();
  setupContextMenu();
  
  // Initialize theme
  const appearanceSettings = JSON.parse(localStorage.getItem('appearanceSettings') || '{}');
  applyTheme(appearanceSettings);
  
  // Initialize managers
  transferQueue = new TransferQueue();
  tabManager = new TabManager();
  activityLogger = new ActivityLogger();
  codeEditor = new CodeEditor();
  codeEditor.initialize();
  
  // Make functions available globally
  window.loadRemoteDirectory = loadRemoteDirectory;
  window.loadLocalDirectory = loadLocalDirectory;
  window.currentConnection = currentConnection;
  window.currentConnectionConfig = currentConnectionConfig;
  window.selectedLocalFile = selectedLocalFile;
  window.selectedRemoteFile = selectedRemoteFile;
  window.allLocalFiles = allLocalFiles;
  window.allRemoteFiles = allRemoteFiles;
  window.ipcRenderer = ipcRenderer;
  window.updateQueueBadge = updateQueueBadge;
  window.tabManager = tabManager;
  
  // Create initial tab
  tabManager.createTab();
  
  loadLocalDirectory('/');
});

function setupEventListeners() {
  document.getElementById('btn-new-connection').addEventListener('click', showConnectionDialog);
  document.getElementById('btn-saved-connections').addEventListener('click', showSavedConnections);
  document.getElementById('btn-bookmarks').addEventListener('click', showBookmarksDialog);
  document.getElementById('btn-ssh-keys').addEventListener('click', showSSHKeysDialog);
  document.getElementById('btn-settings').addEventListener('click', showSettingsDialog);
  document.getElementById('btn-sync-directory').addEventListener('click', showSyncDialog);
  document.getElementById('btn-disconnect').addEventListener('click', disconnect);
  document.getElementById('btn-cancel-connection').addEventListener('click', hideConnectionDialog);
  document.getElementById('btn-close-saved').addEventListener('click', hideSavedConnections);
  document.getElementById('connection-form').addEventListener('submit', handleConnectionSubmit);
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);
  document.getElementById('btn-upload').addEventListener('click', () => {
    console.log('Upload button clicked. Current connection:', currentConnection);
    console.log('Selected local file:', selectedLocalFile);
    uploadFile();
  });
  document.getElementById('btn-download').addEventListener('click', downloadFile);
  document.getElementById('btn-reconnect-terminal').addEventListener('click', reconnectTerminal);
  document.getElementById('btn-close-bottom-panel').addEventListener('click', hideBottomPanel);
  
  // Bottom panel tab switching
  document.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchBottomTab(tab.dataset.tab);
    });
  });
  document.getElementById('btn-close-preview').addEventListener('click', () => {
    document.getElementById('preview-dialog').style.display = 'none';
  });
  document.getElementById('btn-cancel-sync').addEventListener('click', () => {
    document.getElementById('sync-dialog').style.display = 'none';
  });
  document.getElementById('btn-sync-preview').addEventListener('click', previewSync);
  document.getElementById('btn-sync-execute').addEventListener('click', executeSync);
  document.getElementById('btn-close-bookmarks').addEventListener('click', () => {
    document.getElementById('bookmarks-dialog').style.display = 'none';
  });
  document.getElementById('btn-bookmark-local').addEventListener('click', bookmarkLocalPath);
  document.getElementById('btn-bookmark-remote').addEventListener('click', bookmarkRemotePath);
  document.getElementById('btn-close-ssh-keys').addEventListener('click', () => {
    document.getElementById('ssh-keys-dialog').style.display = 'none';
  });
  document.getElementById('generate-key-form').addEventListener('submit', handleGenerateSSHKey);
  
  // Settings dialog handlers
  document.getElementById('btn-apply-settings').addEventListener('click', applySettings);
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-dialog').style.display = 'none';
  });
  
  // Settings tab handlers
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Remove active class from all tabs and panels
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding panel
      e.target.classList.add('active');
      const tabName = e.target.getAttribute('data-tab');
      if (tabName === 'general') {
        document.getElementById('general-panel').classList.add('active');
      } else if (tabName === 'compression') {
        document.getElementById('compression-panel').classList.add('active');
      } else if (tabName === 'speed-limits') {
        document.getElementById('speed-limits-panel').classList.add('active');
      } else if (tabName === 'appearance') {
        document.getElementById('appearance-panel').classList.add('active');
      }
    });
  });
  document.getElementById('btn-close-shortcuts').addEventListener('click', () => {
    document.getElementById('shortcuts-dialog').style.display = 'none';
  });
  
  // Appearance settings handlers
  document.getElementById('theme-select').addEventListener('change', (e) => {
    const theme = e.target.value;
    document.getElementById('custom-theme-settings').style.display = 
      theme === 'custom' ? 'block' : 'none';
  });
  
  document.getElementById('font-size').addEventListener('input', (e) => {
    document.getElementById('font-size-value').textContent = e.target.value + 'px';
  });
  
  // Filter and sort controls
  document.getElementById('btn-local-filter').addEventListener('click', (e) => {
    showFilterMenu(e.target, 'local');
  });
  document.getElementById('btn-remote-filter').addEventListener('click', (e) => {
    showFilterMenu(e.target, 'remote');
  });
  document.getElementById('local-sort').addEventListener('change', () => sortFiles('local'));
  document.getElementById('remote-sort').addEventListener('change', () => sortFiles('remote'));
  document.getElementById('btn-local-sort-order').addEventListener('click', () => toggleSortOrder('local'));
  document.getElementById('btn-remote-sort-order').addEventListener('click', () => toggleSortOrder('remote'));
  
  // Filter menu controls
  document.getElementById('btn-apply-filter').addEventListener('click', applyFilter);
  document.getElementById('btn-reset-filter').addEventListener('click', resetFilter);
  
  // Close filter menu when clicking outside
  document.addEventListener('click', (e) => {
    const filterMenu = document.getElementById('filter-menu');
    if (!e.target.closest('.filter-btn') && !e.target.closest('#filter-menu')) {
      filterMenu.style.display = 'none';
    }
  });
  
  // Search functionality
  document.getElementById('local-search').addEventListener('input', (e) => {
    filterFiles('local', e.target.value);
  });
  
  document.getElementById('remote-search').addEventListener('input', (e) => {
    filterFiles('remote', e.target.value);
  });
  
  document.getElementById('clear-local-search').addEventListener('click', () => {
    document.getElementById('local-search').value = '';
    filterFiles('local', '');
  });
  
  document.getElementById('clear-remote-search').addEventListener('click', () => {
    document.getElementById('remote-search').value = '';
    filterFiles('remote', '');
  });
  
  // Queue controls
  document.getElementById('btn-show-queue').addEventListener('click', showQueue);
  document.getElementById('btn-pause-all').addEventListener('click', () => transferQueue.pauseAll());
  document.getElementById('btn-resume-all').addEventListener('click', () => transferQueue.resumeAll());
  document.getElementById('btn-clear-completed').addEventListener('click', () => transferQueue.clearCompleted());
  
  // Activity log controls
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    if (confirm('Clear all activity logs?')) {
      activityLogger.clearLogs();
    }
  });
  document.getElementById('btn-export-log').addEventListener('click', () => activityLogger.exportLogs());
  document.getElementById('log-filter').addEventListener('change', (e) => {
    activityLogger.setFilter(e.target.value);
  });
  
  // Tab controls
  document.getElementById('btn-new-tab').addEventListener('click', () => {
    tabManager.createTab();
  });
  
  // Listen for transfer progress updates
  ipcRenderer.on('transfer-progress', (event, transferId, progress) => {
    const transfer = transferQueue.queue.find(t => t.id === transferId);
    if (transfer) {
      transfer.progress = progress.percent || 0;
      transfer.speed = progress.speed || 0;
      transferQueue.updateTransferProgress(transferId);
    }
  });
  
  document.getElementById('auth-type').addEventListener('change', async (e) => {
    const authType = e.target.value;
    document.getElementById('password-group').style.display = authType === 'password' ? 'block' : 'none';
    document.getElementById('key-group').style.display = authType === 'key' ? 'block' : 'none';
    document.getElementById('passphrase-group').style.display = authType === 'key' ? 'block' : 'none';
    
    // If switching to key auth, populate available keys
    if (authType === 'key') {
      await populateAvailableSSHKeys();
    }
  });
  
  document.getElementById('quick-connect').addEventListener('change', async (e) => {
    const profileId = e.target.value;
    if (profileId) {
      await loadQuickConnectProfile(profileId);
    }
  });
  
  document.getElementById('local-path').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loadLocalDirectory(e.target.value);
    }
  });
  
  document.getElementById('remote-path').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && currentConnection) {
      loadRemoteDirectory(e.target.value);
    }
  });

  ipcRenderer.on('download-progress', (event, progress) => {
    updateTransferStatus(`Downloading: ${progress.percent}%`);
  });

  ipcRenderer.on('upload-progress', (event, progress) => {
    updateTransferStatus(`Uploading: ${progress.percent}%`);
  });

  ipcRenderer.on('terminal-data', (event, data) => {
    if (terminal) {
      terminal.write(data);
    }
  });
  
  ipcRenderer.on('terminal-closed', () => {
    if (terminal) {
      terminal.write('\r\n[Terminal session closed]\r\n');
    }
  });

  ipcRenderer.on('menu-new-connection', () => {
    showConnectionDialog();
  });
  
  ipcRenderer.on('menu-toggle-terminal', () => {
    toggleTerminal();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // F1: Show keyboard shortcuts
    if (e.key === 'F1') {
      e.preventDefault();
      document.getElementById('shortcuts-dialog').style.display = 'flex';
    }
    
    // Escape: Close modals
    if (e.key === 'Escape') {
      const previewDialog = document.getElementById('preview-dialog');
      const syncDialog = document.getElementById('sync-dialog');
      const bookmarksDialog = document.getElementById('bookmarks-dialog');
      const shortcutsDialog = document.getElementById('shortcuts-dialog');
      
      if (previewDialog.style.display === 'flex') {
        previewDialog.style.display = 'none';
        return;
      }
      
      if (syncDialog.style.display === 'flex') {
        syncDialog.style.display = 'none';
        return;
      }
      
      if (bookmarksDialog.style.display === 'flex') {
        bookmarksDialog.style.display = 'none';
        return;
      }
      
      if (shortcutsDialog.style.display === 'flex') {
        shortcutsDialog.style.display = 'none';
        return;
      }
    }
    
    // Ctrl/Cmd + T: New tab
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
      e.preventDefault();
      tabManager.createTab();
    }
    
    // Ctrl/Cmd + W: Close tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      tabManager.closeTab(tabManager.activeTabId);
    }
    
    // Ctrl/Cmd + Tab: Next tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const tabs = Array.from(tabManager.tabs.keys());
      const currentIndex = tabs.indexOf(tabManager.activeTabId);
      const nextIndex = (currentIndex + 1) % tabs.length;
      tabManager.switchToTab(tabs[nextIndex]);
    }
    
    // Ctrl/Cmd + Shift + Tab: Previous tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const tabs = Array.from(tabManager.tabs.keys());
      const currentIndex = tabs.indexOf(tabManager.activeTabId);
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      tabManager.switchToTab(tabs[prevIndex]);
    }
    
    // Ctrl/Cmd + 1-9: Switch to specific tab
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const tabIndex = parseInt(e.key) - 1;
      const tabs = Array.from(tabManager.tabs.keys());
      if (tabIndex < tabs.length) {
        tabManager.switchToTab(tabs[tabIndex]);
      }
    }
    
    // F5: Refresh current directories
    if (e.key === 'F5') {
      e.preventDefault();
      refreshCurrentDirectories();
    }
    
    // Delete: Delete selected file
    if (e.key === 'Delete') {
      e.preventDefault();
      deleteSelectedFile();
    }
    
    // Enter: Open/navigate selected item
    if (e.key === 'Enter') {
      e.preventDefault();
      openSelectedItem();
    }
    
    // Ctrl/Cmd + D: Toggle bookmarks
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      const bookmarksDialog = document.getElementById('bookmarks-dialog');
      if (bookmarksDialog.style.display === 'flex') {
        bookmarksDialog.style.display = 'none';
      } else {
        showBookmarksDialog();
      }
    }
    
    // Ctrl/Cmd + K: Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      // Focus on the search input of the active panel
      const activeElement = document.activeElement;
      if (activeElement && activeElement.closest('.local-panel')) {
        document.getElementById('local-search').focus();
      } else if (activeElement && activeElement.closest('.remote-panel')) {
        document.getElementById('remote-search').focus();
      } else {
        // Default to local search
        document.getElementById('local-search').focus();
      }
    }
    
    // Ctrl/Cmd + U: Upload selected file
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
      e.preventDefault();
      if (selectedLocalFile && currentConnection) {
        uploadFile();
      }
    }
    
    // Ctrl/Cmd + Shift + D: Download selected file
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (selectedRemoteFile && currentConnection) {
        downloadFile();
      }
    }
    
    // Ctrl/Cmd + Q: Show transfer queue
    if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
      e.preventDefault();
      const queueContainer = document.getElementById('queue-container');
      if (queueContainer.style.display === 'none') {
        showQueue();
      } else {
        hideQueue();
      }
    }
    
    // F2: Rename selected file
    if (e.key === 'F2') {
      e.preventDefault();
      renameSelectedFile();
    }
  });
}

async function showConnectionDialog() {
  // Load recent connections for quick connect
  await loadQuickConnectOptions();
  
  // Reset quick connect dropdown
  document.getElementById('quick-connect').value = '';
  
  // If key auth is selected, populate SSH keys
  if (document.getElementById('auth-type').value === 'key') {
    await populateAvailableSSHKeys();
  }
  
  document.getElementById('connection-dialog').style.display = 'flex';
}

function hideConnectionDialog() {
  document.getElementById('connection-dialog').style.display = 'none';
  document.getElementById('connection-form').reset();
}

async function handleConnectionSubmit(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const authType = formData.get('authType');
  const config = {
    protocol: formData.get('protocol'),
    host: formData.get('host'),
    port: parseInt(formData.get('port')) || undefined,
    username: formData.get('username')
  };
  
  if (authType === 'password') {
    config.password = formData.get('password');
    console.log('Using password authentication for user:', config.username);
  } else if (authType === 'key') {
    config.privateKeyPath = formData.get('privateKey');
    config.passphrase = formData.get('passphrase');
  }
  
  // Set default ports if not specified
  if (!config.port) {
    if (config.protocol === 'ftp') config.port = 21;
    else if (config.protocol === 'sftp') config.port = 22;
    else if (config.protocol === 'ftps') config.port = 21;
  }
  
  const profileName = formData.get('profileName');
  const savePassword = formData.get('savePassword') === 'on';
  
  if (profileName) {
    const profile = {
      name: profileName,
      ...config,
      authType,
      savePassword
    };
    await ipcRenderer.invoke('save-profile', profile);
  }
  
  updateStatus('Connecting...');
  
  // Add general settings to config
  const generalSettings = JSON.parse(localStorage.getItem('generalSettings') || '{}');
  config.preserveTimestamps = generalSettings.preserveTimestamps !== false;
  
  try {
    const result = await ipcRenderer.invoke('connect-ftp', config);
    
    if (result.success) {
      currentConnection = result.connectionId;
      currentConnectionConfig = config; // Store config for reconnection
      console.log('Connection established with ID:', currentConnection);
      
      // Log successful connection
      activityLogger.addLog('success', `Connected to ${config.host}`, {
        protocol: config.protocol,
        host: config.host,
        port: config.port || (config.protocol === 'sftp' ? 22 : 21),
        user: config.username
      });
      
      // Update tab with connection info
      tabManager.updateCurrentTab({
        connection: currentConnection,
        connectionConfig: config,
        title: config.host
      });
      tabManager.updateTabTitle(tabManager.activeTabId, config.host);
      
      updateConnectionStatus(`Connected to ${config.host}`);
      updateStatus('Ready'); // Clear the "Connecting..." status
      enableControls(true);
      hideConnectionDialog();
      await loadRemoteDirectory('/');
      
      if (config.protocol === 'sftp') {
        showTerminal();
        await initializeTerminal(config);
      }
    } else {
      showError(`Connection failed: ${result.error}`);
      updateStatus('Connection failed');
      activityLogger.addLog('error', `Connection failed to ${config.host}`, {
        error: result.error,
        host: config.host,
        protocol: config.protocol
      });
    }
  } catch (error) {
    showError(`Connection error: ${error.message}`);
    updateStatus('Connection error');
    activityLogger.addLog('error', `Connection error to ${config.host}`, {
      error: error.message,
      host: config.host,
      protocol: config.protocol
    });
  }
}

async function disconnect() {
  if (!currentConnection) return;
  
  try {
    await ipcRenderer.invoke('disconnect', currentConnection);
    currentConnection = null;
    
    // Update tab
    tabManager.updateCurrentTab({
      connection: null,
      connectionConfig: null,
      title: 'Not connected'
    });
    tabManager.updateTabTitle(tabManager.activeTabId, 'Not connected');
    
    updateConnectionStatus('Not connected');
    enableControls(false);
    clearRemoteFileList();
    hideTerminal();
  } catch (error) {
    showError(`Disconnect error: ${error.message}`);
  }
}

async function loadLocalDirectory(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    allLocalFiles = []; // Reset the files array
    
    // Add parent directory if not root
    if (dirPath !== '/') {
      allLocalFiles.push({
        name: '..',
        type: 'directory',
        size: 0,
        path: path.dirname(dirPath),
        modifiedAt: null
      });
    }
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stats = await fs.stat(filePath);
        const isDirectory = stats.isDirectory();
        
        allLocalFiles.push({
          name: file,
          path: filePath,
          type: isDirectory ? 'directory' : 'file',
          size: stats.size,
          modifiedAt: stats.mtime
        });
      } catch (err) {
        // Skip files we can't access
        if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
          console.error(`Error reading file ${filePath}:`, err);
        }
      }
    }
    
    document.getElementById('local-path').value = dirPath;
    
    // Clear search when loading new directory
    document.getElementById('local-search').value = '';
    
    // Display files with current filters and sorting
    displayFiles(allLocalFiles, 'local');
    
    // Update tab
    if (tabManager) {
      tabManager.updateCurrentTab({
        localPath: dirPath,
        localFiles: allLocalFiles
      });
    }
    
    // Setup drag functionality for newly loaded files
    setupLocalFileDragging();
  } catch (error) {
    showError(`Error loading local directory: ${error.message}`);
  }
}

async function loadRemoteDirectory(dirPath) {
  if (!currentConnection) return;
  
  try {
    const result = await ipcRenderer.invoke('list-directory', currentConnection, dirPath);
    
    if (result.success) {
      const fileList = document.getElementById('remote-file-list');
      allRemoteFiles = []; // Reset the files array
      
      // Add parent directory if not root
      if (dirPath !== '/') {
        allRemoteFiles.push({
          name: '..',
          type: 'directory',
          size: 0,
          path: dirPath.split('/').slice(0, -1).join('/') || '/',
          modifiedAt: null
        });
      }
      
      for (const file of result.files) {
        const fullPath = path.join(dirPath, file.name);
        
        allRemoteFiles.push({
          name: file.name,
          path: fullPath,
          type: file.type,
          size: file.size,
          modifiedAt: file.modifiedAt
        });
      }
      
      document.getElementById('remote-path').value = dirPath;
      
      // Clear search when loading new directory
      document.getElementById('remote-search').value = '';
      
      // Display files with current filters and sorting
      displayFiles(allRemoteFiles, 'remote');
      
      // Update tab
      if (tabManager) {
        tabManager.updateCurrentTab({
          remotePath: dirPath,
          remoteFiles: allRemoteFiles
        });
      }
    } else {
      showError(`Error loading remote directory: ${result.error}`);
    }
  } catch (error) {
    showError(`Error loading remote directory: ${error.message}`);
  }
}

function addFileItem(container, name, type, size, isLocal, onAction) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.type = type;
  item.dataset.name = name;
  item.dataset.filename = name; // For CSS selector to hide hidden files
  
  const icon = document.createElement('span');
  icon.className = 'file-item-icon';
  icon.textContent = type === 'directory' ? '📁' : '📄';
  
  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-item-name';
  nameSpan.textContent = name;
  
  const sizeSpan = document.createElement('span');
  sizeSpan.className = 'file-item-size';
  if (type === 'file') {
    sizeSpan.textContent = formatFileSize(size);
  }
  
  item.appendChild(icon);
  item.appendChild(nameSpan);
  item.appendChild(sizeSpan);
  
  // Single click selects the item
  item.addEventListener('click', (e) => {
    // Don't select if double-clicking
    if (e.detail === 1) {
      setTimeout(() => {
        if (!item.dataset.doubleClicked) {
          container.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          
          // For files, call the selection action
          if (type === 'file') {
            onAction();
          }
        }
        delete item.dataset.doubleClicked;
      }, 200);
    }
  });
  
  // Double click opens directories
  item.addEventListener('dblclick', () => {
    item.dataset.doubleClicked = 'true';
    onAction();
  });
  
  container.appendChild(item);
  return item; // Return the element for tracking
}

function selectLocalFile(filePath, fileName) {
  selectedLocalFile = { path: filePath, name: fileName };
  console.log('Local file selected:', selectedLocalFile);
  console.log('Current connection when selecting file:', currentConnection);
  document.getElementById('btn-upload').disabled = !currentConnection;
  
  // Update tab
  if (tabManager) {
    tabManager.updateCurrentTab({
      selectedLocalFile: selectedLocalFile
    });
  }
}

function selectRemoteFile(filePath, fileName) {
  selectedRemoteFile = { path: filePath, name: fileName };
  document.getElementById('btn-download').disabled = false;
  
  // Update tab
  if (tabManager) {
    tabManager.updateCurrentTab({
      selectedRemoteFile: selectedRemoteFile
    });
  }
}

async function uploadFile() {
  if (!currentConnection || !selectedLocalFile) {
    showError('No file selected or not connected');
    return;
  }
  
  const remotePath = path.join(
    document.getElementById('remote-path').value,
    selectedLocalFile.name
  );
  
  // Get file size
  let fileSize = 0;
  try {
    const stats = await fs.stat(selectedLocalFile.path);
    fileSize = stats.size;
  } catch (err) {
    console.error('Failed to get file size:', err);
  }
  
  // Add to queue
  transferQueue.addTransfer({
    type: 'upload',
    localPath: selectedLocalFile.path,
    remotePath: remotePath,
    size: fileSize,
    connectionId: currentConnection
  });
  
  updateStatus('File added to queue');
  showQueue();
}

async function downloadFile() {
  if (!currentConnection || !selectedRemoteFile) return;
  
  const localPath = path.join(
    document.getElementById('local-path').value,
    selectedRemoteFile.name
  );
  
  // Add to queue
  transferQueue.addTransfer({
    type: 'download',
    localPath: localPath,
    remotePath: selectedRemoteFile.path,
    connectionId: currentConnection
  });
  
  updateStatus('File added to queue');
  showQueue();
}

function showTerminal() {
  showBottomPanel('terminal');
  
  if (!terminal) {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff'
      },
      scrollback: 1000
    });
    
    terminalFitAddon = new FitAddon();
    terminal.loadAddon(terminalFitAddon);
    
    terminal.open(document.getElementById('terminal'));
    terminalFitAddon.fit();
    
    terminal.onData(data => {
      ipcRenderer.send('terminal-input', data);
    });
    
    // Send initial size
    ipcRenderer.send('terminal-resize', terminal.cols, terminal.rows);
    
    // Handle resize events
    terminal.onResize(({ cols, rows }) => {
      ipcRenderer.send('terminal-resize', cols, rows);
    });
    
    window.addEventListener('resize', () => {
      if (terminalFitAddon && document.getElementById('terminal-panel').classList.contains('active')) {
        terminalFitAddon.fit();
      }
    });
  } else if (terminalFitAddon) {
    // If terminal already exists, just fit it again
    setTimeout(() => terminalFitAddon.fit(), 100);
  }
}

function hideTerminal() {
  hideBottomPanel();
}

function showBottomPanel(tab) {
  const container = document.getElementById('bottom-panel-container');
  container.style.display = 'flex';
  
  if (tab) {
    switchBottomTab(tab);
  }
}

function hideBottomPanel() {
  document.getElementById('bottom-panel-container').style.display = 'none';
}

function switchBottomTab(tabName) {
  // Update tabs
  document.querySelectorAll('.bottom-tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update panels
  document.querySelectorAll('.bottom-tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  if (tabName === 'terminal') {
    document.getElementById('terminal-panel').classList.add('active');
    if (terminalFitAddon) {
      setTimeout(() => terminalFitAddon.fit(), 100);
    }
  } else if (tabName === 'queue') {
    document.getElementById('queue-panel').classList.add('active');
  } else if (tabName === 'log') {
    document.getElementById('log-panel').classList.add('active');
    activityLogger.updateDisplay();
  }
}

function toggleTerminal() {
  const container = document.getElementById('bottom-panel-container');
  if (container.style.display === 'none') {
    showTerminal();
  } else if (document.getElementById('terminal-panel').classList.contains('active')) {
    hideBottomPanel();
  } else {
    switchBottomTab('terminal');
  }
}

async function initializeTerminal(config) {
  // Pass the full config including authentication details
  const result = await ipcRenderer.invoke('create-terminal', config);
  if (!result.success) {
    console.error('Failed to create terminal:', result.error);
    document.getElementById('terminal').innerHTML = `<div style="padding: 20px; color: #ff6b6b;">Terminal error: ${result.error}</div>`;
  } else {
    // Wait for welcome message then reset viewport
    setTimeout(() => {
      if (terminal) {
        // Clear screen and reset cursor
        terminal.clear();
        terminal.reset();
        // Send a command to show prompt
        ipcRenderer.send('terminal-input', '\x0C'); // Ctrl+L to clear screen
      }
    }, 1500);
  }
}

function enableControls(enabled) {
  console.log('Enabling controls:', enabled);
  console.log('Selected files:', { local: selectedLocalFile, remote: selectedRemoteFile });
  
  document.getElementById('btn-disconnect').disabled = !enabled;
  document.getElementById('btn-sync-directory').disabled = !enabled;
  document.getElementById('btn-bookmark-remote').disabled = !enabled;
  document.getElementById('remote-path').disabled = !enabled;
  document.getElementById('btn-upload').disabled = !enabled || !selectedLocalFile;
  document.getElementById('btn-download').disabled = !enabled || !selectedRemoteFile;
  
  // Enable/disable search for remote panel
  document.getElementById('remote-search').disabled = !enabled;
  document.getElementById('clear-remote-search').disabled = !enabled;
  
  // Enable/disable filter and sort controls for remote panel
  document.getElementById('btn-remote-filter').disabled = !enabled;
  document.getElementById('remote-sort').disabled = !enabled;
  document.getElementById('btn-remote-sort-order').disabled = !enabled;
}

function updateStatus(message) {
  document.getElementById('status-message').textContent = message;
}

function updateConnectionStatus(message) {
  document.getElementById('connection-status').textContent = message;
}

function updateTransferStatus(message) {
  document.getElementById('transfer-status').textContent = message;
}

function clearRemoteFileList() {
  document.getElementById('remote-file-list').innerHTML = '';
  document.getElementById('remote-path').value = '/';
}

function showError(message) {
  updateStatus(`Error: ${message}`);
  console.error(message);
}

function showMessage(message) {
  updateStatus(message);
  console.log(message);
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function showSavedConnections() {
  const result = await ipcRenderer.invoke('get-profiles');
  if (!result.success) {
    showError('Failed to load saved connections');
    return;
  }
  
  const profiles = Object.values(result.profiles);
  const listContainer = document.getElementById('saved-connections-list');
  listContainer.innerHTML = '';
  
  if (profiles.length === 0) {
    listContainer.innerHTML = '<p style="text-align: center; color: #888;">No saved connections</p>';
  } else {
    profiles.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
    
    profiles.forEach(profile => {
      const item = createSavedConnectionItem(profile);
      listContainer.appendChild(item);
    });
  }
  
  document.getElementById('saved-connections-dialog').style.display = 'flex';
}

function hideSavedConnections() {
  document.getElementById('saved-connections-dialog').style.display = 'none';
}

function createSavedConnectionItem(profile) {
  const item = document.createElement('div');
  item.className = 'saved-connection-item';
  
  const info = document.createElement('div');
  info.className = 'saved-connection-info';
  
  const name = document.createElement('div');
  name.className = 'saved-connection-name';
  name.textContent = profile.name;
  
  const details = document.createElement('div');
  details.className = 'saved-connection-details';
  details.textContent = `${profile.protocol.toUpperCase()} - ${profile.username}@${profile.host}:${profile.port || 'default'}`;
  
  info.appendChild(name);
  info.appendChild(details);
  
  const actions = document.createElement('div');
  actions.className = 'saved-connection-actions';
  
  const connectBtn = document.createElement('button');
  connectBtn.textContent = 'Connect';
  connectBtn.addEventListener('click', () => connectToProfile(profile.id));
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteProfile(profile.id));
  
  actions.appendChild(connectBtn);
  actions.appendChild(deleteBtn);
  
  item.appendChild(info);
  item.appendChild(actions);
  
  return item;
}

async function connectToProfile(profileId) {
  const result = await ipcRenderer.invoke('get-profile', profileId);
  if (!result.success || !result.profile) {
    showError('Failed to load connection profile');
    return;
  }
  
  const profile = result.profile;
  hideSavedConnections();
  
  // Ensure port is set
  if (!profile.port) {
    if (profile.protocol === 'ftp') profile.port = 21;
    else if (profile.protocol === 'sftp') profile.port = 22;
    else if (profile.protocol === 'ftps') profile.port = 21;
  }
  
  console.log('Connecting with saved profile:', { ...profile, password: '***' });
  updateStatus('Connecting...');
  
  // Add general settings to profile
  const generalSettings = JSON.parse(localStorage.getItem('generalSettings') || '{}');
  profile.preserveTimestamps = generalSettings.preserveTimestamps !== false;
  
  try {
    const connectResult = await ipcRenderer.invoke('connect-ftp', profile);
    
    if (connectResult.success) {
      currentConnection = connectResult.connectionId;
      currentConnectionConfig = profile; // Store config for reconnection
      console.log('Connection established with ID:', currentConnection);
      
      // Update tab with connection info
      tabManager.updateCurrentTab({
        connection: currentConnection,
        connectionConfig: profile,
        title: profile.host
      });
      tabManager.updateTabTitle(tabManager.activeTabId, profile.host);
      
      updateConnectionStatus(`Connected to ${profile.host}`);
      updateStatus('Ready'); // Clear the "Connecting..." status
      enableControls(true);
      await loadRemoteDirectory('/');
      
      if (profile.protocol === 'sftp') {
        showTerminal();
        await initializeTerminal(profile);
      }
    } else {
      showError(`Connection failed: ${connectResult.error}`);
      updateStatus('Connection failed');
    }
  } catch (error) {
    showError(`Connection error: ${error.message}`);
    updateStatus('Connection error');
  }
}

async function deleteProfile(profileId) {
  if (confirm('Are you sure you want to delete this connection?')) {
    const result = await ipcRenderer.invoke('delete-profile', profileId);
    if (result.success) {
      showSavedConnections();
    } else {
      showError('Failed to delete connection');
    }
  }
}

async function testConnection() {
  const form = document.getElementById('connection-form');
  const formData = new FormData(form);
  const authType = formData.get('authType');
  
  const config = {
    protocol: formData.get('protocol'),
    host: formData.get('host'),
    port: parseInt(formData.get('port')) || (formData.get('protocol') === 'sftp' ? 22 : 21),
    username: formData.get('username')
  };
  
  if (authType === 'password') {
    config.password = formData.get('password');
  }
  
  updateStatus('Testing connection...');
  
  if (config.protocol === 'sftp') {
    try {
      console.log('Testing SSH connection with config:', { ...config, password: '***' });
      const result = await ipcRenderer.invoke('test-ssh-connection', config);
      
      if (result.success) {
        updateStatus('Test successful! SSH connection works.');
      } else {
        updateStatus(`Test failed: ${result.error}`);
        console.error('SSH test failed:', result);
      }
    } catch (error) {
      updateStatus(`Test error: ${error.message}`);
      console.error('Test error:', error);
    }
  } else {
    updateStatus('Test only available for SFTP connections');
  }
}

function setupDragAndDrop() {
  const remotePanel = document.querySelector('.remote-panel .panel-content');
  const localPanel = document.querySelector('.local-panel .panel-content');
  
  // Prevent default drag behaviors on the whole window
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });
  
  // Setup drop zone for remote panel
  remotePanel.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    remotePanel.classList.add('drag-highlight');
  });
  
  remotePanel.addEventListener('dragleave', (e) => {
    if (e.target === remotePanel || !remotePanel.contains(e.relatedTarget)) {
      remotePanel.classList.remove('drag-highlight');
    }
  });
  
  remotePanel.addEventListener('drop', async (e) => {
    e.preventDefault();
    remotePanel.classList.remove('drag-highlight');
    
    console.log('Drop event on remote panel');
    
    if (!currentConnection) {
      showError('Not connected to remote server');
      return;
    }
    
    // Handle file drops
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      console.log(`Dropped ${files.length} files`);
      for (const file of files) {
        // For Electron, file.path contains the full path
        const filePath = file.path;
        const fileName = file.name;
        console.log(`Processing dropped file: ${fileName} from ${filePath}`);
        
        // Check if it's a directory
        try {
          const stats = await fs.stat(filePath);
          if (stats.isDirectory()) {
            await uploadFolder(filePath);
          } else {
            await uploadDroppedFile(filePath, fileName);
          }
        } catch (err) {
          console.error('Error checking dropped item:', err);
          await uploadDroppedFile(filePath, fileName);
        }
      }
    } else {
      // Handle internal drag
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data && data.type === 'local-file') {
          console.log('Internal file drop:', data);
          await uploadDroppedFile(data.path, data.name);
        }
      } catch (err) {
        console.log('No internal drag data');
      }
    }
  });
  
  // Make local files draggable
  setupLocalFileDragging();
}

function setupLocalFileDragging() {
  // This will be called whenever local files are loaded
  const localItems = document.querySelectorAll('#local-file-list .file-item');
  localItems.forEach(item => {
    item.draggable = true;
    item.addEventListener('dragstart', handleDragStart);
  });
}

function handleDragStart(e) {
  const fileItem = e.target.closest('.file-item');
  const fileName = fileItem.querySelector('.file-item-name').textContent;
  const filePath = path.join(document.getElementById('local-path').value, fileName);
  
  console.log('Drag started:', { fileName, filePath });
  
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', JSON.stringify({ 
    type: 'local-file',
    path: filePath,
    name: fileName 
  }));
  
  // Visual feedback
  fileItem.style.opacity = '0.5';
  
  // Reset opacity when drag ends
  fileItem.addEventListener('dragend', () => {
    fileItem.style.opacity = '1';
  }, { once: true });
}


async function uploadDroppedFile(filePath, fileName) {
  if (!currentConnection) {
    showError('No active connection for upload');
    return;
  }
  
  const remotePath = path.join(
    document.getElementById('remote-path').value,
    fileName
  );
  
  // Get file size
  let fileSize = 0;
  try {
    const stats = await fs.stat(filePath);
    fileSize = stats.size;
  } catch (err) {
    console.error('Failed to get file size:', err);
  }
  
  // Add to queue
  transferQueue.addTransfer({
    type: 'upload',
    localPath: filePath,
    remotePath: remotePath,
    size: fileSize,
    connectionId: currentConnection
  });
  
  updateStatus(`Added ${fileName} to queue`);
  showQueue();
}

function setupContextMenu() {
  let currentContextFile = null;
  let currentContextIsRemote = false;
  
  const contextMenu = document.getElementById('context-menu');
  
  // Hide context menu when clicking elsewhere
  document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });
  
  // Setup context menu for file items
  document.addEventListener('contextmenu', (e) => {
    const fileItem = e.target.closest('.file-item');
    if (!fileItem) return;
    
    e.preventDefault();
    
    const fileName = fileItem.querySelector('.file-item-name').textContent;
    const isRemote = fileItem.closest('#remote-file-list') !== null;
    
    currentContextFile = {
      name: fileName,
      path: isRemote 
        ? path.join(document.getElementById('remote-path').value, fileName)
        : path.join(document.getElementById('local-path').value, fileName),
      item: fileItem
    };
    currentContextIsRemote = isRemote;
    
    // Show/hide appropriate menu items based on file type and location
    const isDirectory = fileItem.dataset.type === 'directory';
    const isPreviewable = !isDirectory && isPreviewableFile(fileName);
    const isEditable = !isDirectory && isEditableFile(fileName);
    contextMenu.querySelector('[data-action="edit"]').style.display = isEditable ? 'block' : 'none';
    contextMenu.querySelector('[data-action="preview"]').style.display = isPreviewable ? 'block' : 'none';
    contextMenu.querySelector('[data-action="download"]').style.display = isRemote && !isDirectory ? 'block' : 'none';
    contextMenu.querySelector('[data-action="upload"]').style.display = !isRemote && !isDirectory ? 'block' : 'none';
    contextMenu.querySelector('[data-action="download-folder"]').style.display = isRemote && isDirectory && fileName !== '..' ? 'block' : 'none';
    contextMenu.querySelector('[data-action="upload-folder"]').style.display = !isRemote && isDirectory && fileName !== '..' ? 'block' : 'none';
    contextMenu.querySelector('[data-action="permissions"]').style.display = isRemote ? 'block' : 'none';
    
    // Position and show menu
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    contextMenu.style.display = 'block';
  });
  
  // Handle context menu clicks
  contextMenu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    
    contextMenu.style.display = 'none';
    
    switch (action) {
      case 'edit':
        if (currentContextFile) {
          await codeEditor.openFile(currentContextFile.path, currentContextIsRemote, currentConnection);
        }
        break;
        
      case 'preview':
        await previewFile(currentContextFile, currentContextIsRemote);
        break;
        
      case 'download':
        if (currentContextFile && currentContextIsRemote) {
          selectedRemoteFile = { path: currentContextFile.path, name: currentContextFile.name };
          await downloadFile();
        }
        break;
        
      case 'upload':
        if (currentContextFile && !currentContextIsRemote) {
          selectedLocalFile = { path: currentContextFile.path, name: currentContextFile.name };
          await uploadFile();
        }
        break;
        
      case 'rename':
        await renameFile(currentContextFile, currentContextIsRemote);
        break;
        
      case 'delete':
        await deleteFile(currentContextFile, currentContextIsRemote);
        break;
        
      case 'permissions':
        if (currentContextIsRemote) {
          await showPermissionsDialog(currentContextFile);
        }
        break;
        
      case 'refresh':
        if (currentContextIsRemote) {
          await loadRemoteDirectory(document.getElementById('remote-path').value);
        } else {
          await loadLocalDirectory(document.getElementById('local-path').value);
        }
        break;
        
      case 'upload-folder':
        if (currentContextFile && !currentContextIsRemote) {
          await uploadFolder(currentContextFile.path);
        }
        break;
        
      case 'download-folder':
        if (currentContextFile && currentContextIsRemote) {
          await downloadFolder(currentContextFile.path, currentContextFile.name);
        }
        break;
        
      case 'compress-upload':
        if (currentContextFile && !currentContextIsRemote) {
          await compressAndUploadFile(currentContextFile);
        }
        break;
        
      case 'compress-upload-folder':
        if (currentContextFile && !currentContextIsRemote) {
          await compressAndUploadFolder(currentContextFile);
        }
        break;
    }
  });
  
  // Setup permissions dialog
  document.getElementById('btn-apply-permissions').addEventListener('click', applyPermissions);
  document.getElementById('btn-cancel-permissions').addEventListener('click', () => {
    document.getElementById('permissions-dialog').style.display = 'none';
  });
  
  // Handle octal input changes
  document.getElementById('perm-octal').addEventListener('input', updateCheckboxesFromOctal);
  
  // Handle checkbox changes
  const permCheckboxes = document.querySelectorAll('#permissions-dialog input[type="checkbox"]');
  permCheckboxes.forEach(cb => cb.addEventListener('change', updateOctalFromCheckboxes));
}

async function renameFile(file, isRemote) {
  const newName = prompt('Enter new name:', file.name);
  if (!newName || newName === file.name) return;
  
  if (isRemote && currentConnection) {
    try {
      const oldPath = file.path;
      const newPath = path.join(path.dirname(oldPath), newName);
      
      const result = await ipcRenderer.invoke('rename-file', currentConnection, oldPath, newPath);
      if (result.success) {
        await loadRemoteDirectory(document.getElementById('remote-path').value);
      } else {
        showError(`Rename failed: ${result.error}`);
      }
    } catch (error) {
      showError(`Rename error: ${error.message}`);
    }
  } else {
    // Local rename
    try {
      const oldPath = file.path;
      const newPath = path.join(path.dirname(oldPath), newName);
      await fs.rename(oldPath, newPath);
      await loadLocalDirectory(document.getElementById('local-path').value);
    } catch (error) {
      showError(`Rename error: ${error.message}`);
    }
  }
}

async function deleteFile(file, isRemote) {
  if (!confirm(`Delete ${file.name}?`)) return;
  
  if (isRemote && currentConnection) {
    try {
      const result = await ipcRenderer.invoke('delete-file', currentConnection, file.path);
      if (result.success) {
        await loadRemoteDirectory(document.getElementById('remote-path').value);
        activityLogger.addLog('success', `Deleted remote file: ${file.name}`, {
          file: file.name,
          path: file.path
        });
      } else {
        showError(`Delete failed: ${result.error}`);
        activityLogger.addLog('error', `Failed to delete: ${file.name}`, {
          file: file.name,
          error: result.error
        });
      }
    } catch (error) {
      showError(`Delete error: ${error.message}`);
    }
  } else {
    // Local delete
    try {
      await fs.unlink(file.path);
      await loadLocalDirectory(document.getElementById('local-path').value);
      activityLogger.addLog('success', `Deleted local file: ${file.name}`, {
        file: file.name,
        path: file.path
      });
    } catch (error) {
      showError(`Delete error: ${error.message}`);
      activityLogger.addLog('error', `Failed to delete: ${file.name}`, {
        file: file.name,
        error: error.message
      });
    }
  }
}

function isPreviewableFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const previewableExtensions = [
    // Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
    // Text files
    '.txt', '.log', '.md', '.json', '.xml', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.html',
    '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.conf', '.cfg', '.ini', '.env', '.gitignore', '.dockerignore',
    '.sql', '.go', '.rs', '.lua', '.vim', '.emacs'
  ];
  return previewableExtensions.includes(ext);
}

function isEditableFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const editableExtensions = [
    // Text and code files
    '.txt', '.log', '.md', '.json', '.xml', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.less', '.html', '.htm',
    '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.conf', '.cfg', '.ini', '.env', '.gitignore', '.dockerignore',
    '.sql', '.rs', '.go', '.swift', '.kt', '.scala', '.r', '.lua',
    '.pl', '.perl', '.vim', '.vimrc', '.tmux', '.dockerfile',
    '.makefile', '.cmake', '.gradle', '.properties', '.toml',
    '.vue', '.jsx', '.tsx', '.dart', '.elm', '.clj', '.cljs',
    '.ex', '.exs', '.erl', '.hrl', '.nim', '.nims', '.zig'
  ];
  
  // Also check for specific filenames
  const basename = path.basename(filename).toLowerCase();
  const editableNames = [
    'dockerfile', 'makefile', 'cmakelists.txt', 'readme',
    'license', 'todo', 'changelog', '.gitconfig', '.npmrc'
  ];
  
  return editableExtensions.includes(ext) || editableNames.includes(basename);
}

async function previewFile(file, isRemote) {
  const previewDialog = document.getElementById('preview-dialog');
  const previewTitle = document.getElementById('preview-title');
  const previewLoading = document.getElementById('preview-loading');
  const previewImage = document.getElementById('preview-image');
  const previewText = document.getElementById('preview-text');
  const previewError = document.getElementById('preview-error');
  
  // Reset preview state
  previewLoading.style.display = 'block';
  previewImage.style.display = 'none';
  previewText.style.display = 'none';
  previewError.style.display = 'none';
  
  previewTitle.textContent = `Preview: ${file.name}`;
  previewDialog.style.display = 'flex';
  
  try {
    let fileData, mimeType;
    
    if (isRemote && currentConnection) {
      // Download and preview remote file
      const result = await ipcRenderer.invoke('preview-file', currentConnection, file.path);
      if (!result.success) {
        throw new Error(result.error);
      }
      fileData = result.data;
      mimeType = result.mimeType;
    } else {
      // Read local file
      const buffer = await fs.readFile(file.path);
      fileData = buffer.toString('base64');
      mimeType = getMimeType(file.name);
    }
    
    previewLoading.style.display = 'none';
    
    if (mimeType.startsWith('image/')) {
      // Display image
      previewImage.src = `data:${mimeType};base64,${fileData}`;
      previewImage.style.display = 'block';
    } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      // Display text
      const textContent = Buffer.from(fileData, 'base64').toString('utf8');
      const maxLength = 50000; // Limit preview to 50KB of text
      previewText.textContent = textContent.length > maxLength 
        ? textContent.substring(0, maxLength) + '\n\n... (truncated)'
        : textContent;
      previewText.style.display = 'block';
    } else {
      throw new Error('File type not supported for preview');
    }
  } catch (error) {
    previewLoading.style.display = 'none';
    previewError.style.display = 'block';
    previewError.querySelector('p').textContent = `Preview error: ${error.message}`;
  }
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
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

function showSyncDialog() {
  if (!currentConnection) {
    showError('Please connect to a server first');
    return;
  }
  
  const syncDialog = document.getElementById('sync-dialog');
  const localPath = document.getElementById('local-path').value;
  const remotePath = document.getElementById('remote-path').value;
  
  document.getElementById('sync-local-path').textContent = localPath;
  document.getElementById('sync-remote-path').textContent = remotePath;
  document.getElementById('sync-preview').style.display = 'none';
  document.getElementById('btn-sync-execute').style.display = 'none';
  
  syncDialog.style.display = 'flex';
}

async function previewSync() {
  const direction = document.getElementById('sync-direction').value;
  const deleteExtra = document.getElementById('sync-delete-extra').checked;
  const overwriteNewer = document.getElementById('sync-overwrite-newer').checked;
  const localPath = document.getElementById('local-path').value;
  const remotePath = document.getElementById('remote-path').value;
  
  try {
    updateStatus('Analyzing directories...');
    
    // Get file lists
    const localFiles = await getLocalFileList(localPath);
    const remoteFiles = await getRemoteFileList(remotePath);
    
    // Compare files and determine sync actions
    const syncActions = await compareSyncFiles(localFiles, remoteFiles, {
      direction,
      deleteExtra,
      overwriteNewer,
      localPath,
      remotePath
    });
    
    // Display preview
    displaySyncPreview(syncActions);
    
    updateStatus('Ready');
  } catch (error) {
    showError(`Sync preview failed: ${error.message}`);
    updateStatus('Ready');
  }
}

async function getLocalFileList(dirPath) {
  const files = [];
  
  async function scanDir(currentPath, relativePath = '') {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath, relPath);
      } else {
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: relPath,
          size: stats.size,
          modified: stats.mtime,
          isDirectory: false
        });
      }
    }
  }
  
  await scanDir(dirPath);
  return files;
}

async function getRemoteFileList(dirPath) {
  const files = [];
  
  async function scanDir(currentPath, relativePath = '') {
    const result = await ipcRenderer.invoke('list-directory', currentConnection, currentPath);
    if (!result.success) {
      throw new Error(result.error);
    }
    
    for (const file of result.files) {
      if (file.name === '.' || file.name === '..') continue;
      
      const relPath = path.join(relativePath, file.name);
      
      if (file.type === 'directory') {
        await scanDir(path.join(currentPath, file.name), relPath);
      } else {
        files.push({
          name: file.name,
          path: relPath,
          size: file.size,
          modified: file.modifiedAt,
          isDirectory: false
        });
      }
    }
  }
  
  await scanDir(dirPath);
  return files;
}

async function compareSyncFiles(localFiles, remoteFiles, options) {
  const actions = [];
  const { direction, deleteExtra, overwriteNewer, localPath, remotePath } = options;
  
  // Create maps for easier lookup
  const localMap = new Map(localFiles.map(f => [f.path, f]));
  const remoteMap = new Map(remoteFiles.map(f => [f.path, f]));
  
  if (direction === 'upload' || direction === 'bidirectional') {
    // Check local files that need to be uploaded
    for (const localFile of localFiles) {
      const remoteFile = remoteMap.get(localFile.path);
      
      if (!remoteFile) {
        // File doesn't exist on remote
        actions.push({
          type: 'upload',
          file: localFile.path,
          reason: 'New file',
          localPath: path.join(localPath, localFile.path),
          remotePath: path.join(remotePath, localFile.path)
        });
      } else if (localFile.size !== remoteFile.size || 
                 (overwriteNewer || new Date(localFile.modified) > new Date(remoteFile.modified))) {
        // File is different
        actions.push({
          type: 'upload',
          file: localFile.path,
          reason: localFile.size !== remoteFile.size ? 'Different size' : 'Newer version',
          localPath: path.join(localPath, localFile.path),
          remotePath: path.join(remotePath, localFile.path)
        });
      }
    }
    
    // Check for remote files to delete
    if (deleteExtra && direction === 'upload') {
      for (const remoteFile of remoteFiles) {
        if (!localMap.has(remoteFile.path)) {
          actions.push({
            type: 'delete-remote',
            file: remoteFile.path,
            reason: 'Not in source',
            remotePath: path.join(remotePath, remoteFile.path)
          });
        }
      }
    }
  }
  
  if (direction === 'download' || direction === 'bidirectional') {
    // Check remote files that need to be downloaded
    for (const remoteFile of remoteFiles) {
      const localFile = localMap.get(remoteFile.path);
      
      if (!localFile) {
        // File doesn't exist locally
        actions.push({
          type: 'download',
          file: remoteFile.path,
          reason: 'New file',
          localPath: path.join(localPath, remoteFile.path),
          remotePath: path.join(remotePath, remoteFile.path)
        });
      } else if (remoteFile.size !== localFile.size || 
                 (overwriteNewer || new Date(remoteFile.modified) > new Date(localFile.modified))) {
        // File is different
        actions.push({
          type: 'download',
          file: remoteFile.path,
          reason: remoteFile.size !== localFile.size ? 'Different size' : 'Newer version',
          localPath: path.join(localPath, remoteFile.path),
          remotePath: path.join(remotePath, remoteFile.path)
        });
      }
    }
    
    // Check for local files to delete
    if (deleteExtra && direction === 'download') {
      for (const localFile of localFiles) {
        if (!remoteMap.has(localFile.path)) {
          actions.push({
            type: 'delete-local',
            file: localFile.path,
            reason: 'Not in source',
            localPath: path.join(localPath, localFile.path)
          });
        }
      }
    }
  }
  
  return actions;
}

function displaySyncPreview(actions) {
  const previewList = document.getElementById('sync-preview-list');
  const syncPreview = document.getElementById('sync-preview');
  const executeBtn = document.getElementById('btn-sync-execute');
  
  previewList.innerHTML = '';
  
  if (actions.length === 0) {
    previewList.innerHTML = '<p style="color: #888;">No changes needed - directories are in sync</p>';
  } else {
    actions.forEach(action => {
      const item = document.createElement('div');
      item.className = `sync-item ${action.type.replace('-', ' ')}`;
      
      let actionText = '';
      switch (action.type) {
        case 'upload':
          actionText = 'Upload';
          item.classList.add('upload');
          break;
        case 'download':
          actionText = 'Download';
          item.classList.add('download');
          break;
        case 'delete-local':
          actionText = 'Delete Local';
          item.classList.add('delete');
          break;
        case 'delete-remote':
          actionText = 'Delete Remote';
          item.classList.add('delete');
          break;
      }
      
      item.innerHTML = `
        <span class="sync-action">${actionText}:</span>
        <span class="sync-file">${action.file}</span>
        <span style="color: #888; font-size: 12px;"> (${action.reason})</span>
      `;
      
      previewList.appendChild(item);
    });
    
    executeBtn.style.display = 'inline-block';
    executeBtn.dataset.syncActions = JSON.stringify(actions);
  }
  
  syncPreview.style.display = 'block';
}

async function executeSync() {
  const executeBtn = document.getElementById('btn-sync-execute');
  const actions = JSON.parse(executeBtn.dataset.syncActions || '[]');
  
  if (actions.length === 0) return;
  
  if (!confirm(`Execute ${actions.length} sync operations?`)) return;
  
  document.getElementById('sync-dialog').style.display = 'none';
  
  // Add sync operations to transfer queue
  for (const action of actions) {
    switch (action.type) {
      case 'upload':
        transferQueue.addTransfer({
          type: 'upload',
          name: path.basename(action.file),
          localPath: action.localPath,
          remotePath: action.remotePath,
          size: 0 // Will be determined during transfer
        });
        break;
        
      case 'download':
        transferQueue.addTransfer({
          type: 'download',
          name: path.basename(action.file),
          localPath: action.localPath,
          remotePath: action.remotePath,
          size: 0 // Will be determined during transfer
        });
        break;
        
      case 'delete-local':
        try {
          await fs.unlink(action.localPath);
          updateStatus(`Deleted local file: ${action.file}`);
        } catch (error) {
          showError(`Failed to delete ${action.file}: ${error.message}`);
        }
        break;
        
      case 'delete-remote':
        try {
          const result = await ipcRenderer.invoke('delete-file', currentConnection, action.remotePath);
          if (!result.success) {
            throw new Error(result.error);
          }
          updateStatus(`Deleted remote file: ${action.file}`);
        } catch (error) {
          showError(`Failed to delete ${action.file}: ${error.message}`);
        }
        break;
    }
  }
  
  // Show transfer queue if there are transfers
  if (actions.some(a => a.type === 'upload' || a.type === 'download')) {
    showQueue();
  }
  
  // Refresh file lists
  await loadLocalDirectory(document.getElementById('local-path').value);
  await loadRemoteDirectory(document.getElementById('remote-path').value);
}

async function showBookmarksDialog() {
  const bookmarksDialog = document.getElementById('bookmarks-dialog');
  
  // Load bookmarks
  await loadBookmarks();
  
  bookmarksDialog.style.display = 'flex';
}

async function loadBookmarks() {
  // Load local bookmarks
  const localResult = await ipcRenderer.invoke('get-local-bookmarks');
  if (localResult.success) {
    displayLocalBookmarks(localResult.bookmarks);
  }
  
  // Load remote bookmarks
  const remoteResult = await ipcRenderer.invoke('get-remote-bookmarks');
  if (remoteResult.success) {
    displayRemoteBookmarks(remoteResult.bookmarks);
  }
}

function displayLocalBookmarks(bookmarks) {
  const container = document.getElementById('local-bookmarks-list');
  container.innerHTML = '';
  
  if (bookmarks.length === 0) {
    container.innerHTML = '<div class="empty-bookmarks">No local bookmarks yet</div>';
    return;
  }
  
  bookmarks.forEach(bookmark => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.innerHTML = `
      <div class="bookmark-item-info" data-path="${bookmark.path}">
        <div class="bookmark-item-name">${bookmark.name}</div>
        <div class="bookmark-item-path">${bookmark.path}</div>
      </div>
      <div class="bookmark-item-actions">
        <button class="bookmark-item-btn rename" data-id="${bookmark.id}" title="Rename">✏️</button>
        <button class="bookmark-item-btn delete" data-id="${bookmark.id}" title="Delete">🗑️</button>
      </div>
    `;
    
    // Click to navigate
    item.querySelector('.bookmark-item-info').addEventListener('click', () => {
      loadLocalDirectory(bookmark.path);
      document.getElementById('bookmarks-dialog').style.display = 'none';
    });
    
    // Rename button
    item.querySelector('.rename').addEventListener('click', (e) => {
      e.stopPropagation();
      renameBookmark(bookmark.id, bookmark.name, false);
    });
    
    // Delete button
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBookmark(bookmark.id, false);
    });
    
    container.appendChild(item);
  });
}

function displayRemoteBookmarks(bookmarks) {
  const container = document.getElementById('remote-bookmarks-list');
  container.innerHTML = '';
  
  if (bookmarks.length === 0) {
    container.innerHTML = '<div class="empty-bookmarks">No remote bookmarks yet</div>';
    return;
  }
  
  // Filter bookmarks for current host if connected
  const currentHost = currentConnectionConfig?.host;
  const filteredBookmarks = currentHost 
    ? bookmarks.filter(b => b.host === currentHost)
    : bookmarks;
  
  if (filteredBookmarks.length === 0) {
    container.innerHTML = '<div class="empty-bookmarks">No bookmarks for current host</div>';
    return;
  }
  
  filteredBookmarks.forEach(bookmark => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.innerHTML = `
      <div class="bookmark-item-info" data-path="${bookmark.path}">
        <div class="bookmark-item-name">${bookmark.name}</div>
        <div class="bookmark-item-path">${bookmark.host}: ${bookmark.path}</div>
      </div>
      <div class="bookmark-item-actions">
        <button class="bookmark-item-btn rename" data-id="${bookmark.id}" title="Rename">✏️</button>
        <button class="bookmark-item-btn delete" data-id="${bookmark.id}" title="Delete">🗑️</button>
      </div>
    `;
    
    // Click to navigate (only if connected to same host)
    item.querySelector('.bookmark-item-info').addEventListener('click', () => {
      if (currentHost === bookmark.host && currentConnection) {
        loadRemoteDirectory(bookmark.path);
        document.getElementById('bookmarks-dialog').style.display = 'none';
      } else {
        showError('Please connect to ' + bookmark.host + ' first');
      }
    });
    
    // Rename button
    item.querySelector('.rename').addEventListener('click', (e) => {
      e.stopPropagation();
      renameBookmark(bookmark.id, bookmark.name, true);
    });
    
    // Delete button
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBookmark(bookmark.id, true);
    });
    
    container.appendChild(item);
  });
}

async function bookmarkLocalPath() {
  const path = document.getElementById('local-path').value;
  const name = prompt('Bookmark name:', path.split('/').pop() || 'Root');
  
  if (name) {
    const result = await ipcRenderer.invoke('add-local-bookmark', { name, path });
    if (result.success) {
      updateStatus('Local bookmark added');
      showMessage('Bookmark added successfully');
    } else {
      showError('Failed to add bookmark: ' + result.error);
    }
  }
}

async function bookmarkRemotePath() {
  if (!currentConnection || !currentConnectionConfig) {
    showError('Please connect to a server first');
    return;
  }
  
  const path = document.getElementById('remote-path').value;
  const name = prompt('Bookmark name:', path.split('/').pop() || 'Root');
  
  if (name) {
    const result = await ipcRenderer.invoke('add-remote-bookmark', {
      name,
      path,
      host: currentConnectionConfig.host
    });
    if (result.success) {
      updateStatus('Remote bookmark added');
      showMessage('Bookmark added successfully');
    } else {
      showError('Failed to add bookmark: ' + result.error);
    }
  }
}

async function renameBookmark(id, currentName, isRemote) {
  const newName = prompt('New bookmark name:', currentName);
  
  if (newName && newName !== currentName) {
    const result = await ipcRenderer.invoke('rename-bookmark', id, newName, isRemote);
    if (result.success) {
      await loadBookmarks();
      updateStatus('Bookmark renamed');
    } else {
      showError('Failed to rename bookmark');
    }
  }
}

async function deleteBookmark(id, isRemote) {
  if (confirm('Delete this bookmark?')) {
    const result = await ipcRenderer.invoke('delete-bookmark', id, isRemote);
    if (result.success) {
      await loadBookmarks();
      updateStatus('Bookmark deleted');
    } else {
      showError('Failed to delete bookmark');
    }
  }
}

async function loadQuickConnectOptions() {
  const quickConnectSelect = document.getElementById('quick-connect');
  
  // Clear existing options except the first one
  while (quickConnectSelect.options.length > 1) {
    quickConnectSelect.remove(1);
  }
  
  // Get recent profiles
  const result = await ipcRenderer.invoke('get-recent-profiles');
  if (result.success && result.profiles.length > 0) {
    result.profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.name || profile.host} (${profile.protocol.toUpperCase()})`;
      quickConnectSelect.appendChild(option);
    });
  }
}

async function loadQuickConnectProfile(profileId) {
  const result = await ipcRenderer.invoke('get-profile', profileId);
  if (result.success && result.profile) {
    const profile = result.profile;
    
    // Fill in the form fields
    document.getElementById('protocol').value = profile.protocol;
    document.getElementById('host').value = profile.host;
    document.getElementById('port').value = profile.port || '';
    document.getElementById('username').value = profile.username;
    document.getElementById('auth-type').value = profile.authType || 'password';
    
    // Trigger auth type change event
    document.getElementById('auth-type').dispatchEvent(new Event('change'));
    
    // Fill auth fields
    if (profile.authType === 'key') {
      document.getElementById('private-key').value = profile.privateKeyPath || '';
      document.getElementById('passphrase').value = profile.passphrase || '';
    } else {
      document.getElementById('password').value = profile.password || '';
    }
    
    document.getElementById('save-password').checked = profile.savePassword || false;
    document.getElementById('profile-name').value = profile.name || '';
    
    // Focus on connect button
    document.querySelector('#connection-form button[type="submit"]').focus();
  }
}

async function refreshCurrentDirectories() {
  updateStatus('Refreshing directories...');
  
  // Refresh local directory
  const localPath = document.getElementById('local-path').value;
  await loadLocalDirectory(localPath);
  
  // Refresh remote directory if connected
  if (currentConnection) {
    const remotePath = document.getElementById('remote-path').value;
    await loadRemoteDirectory(remotePath);
  }
  
  updateStatus('Directories refreshed');
}

async function deleteSelectedFile() {
  // Determine which panel has focus
  const activeElement = document.activeElement;
  let isRemote = false;
  let selectedFile = null;
  
  if (activeElement && activeElement.closest('.local-panel')) {
    selectedFile = selectedLocalFile;
    isRemote = false;
  } else if (activeElement && activeElement.closest('.remote-panel')) {
    selectedFile = selectedRemoteFile;
    isRemote = true;
  } else {
    // Check which file is selected
    if (selectedLocalFile) {
      selectedFile = selectedLocalFile;
      isRemote = false;
    } else if (selectedRemoteFile) {
      selectedFile = selectedRemoteFile;
      isRemote = true;
    }
  }
  
  if (selectedFile) {
    await deleteFile(selectedFile, isRemote);
  }
}

async function openSelectedItem() {
  // Determine which panel has focus
  const activeElement = document.activeElement;
  
  if (activeElement && activeElement.closest('.local-panel')) {
    if (selectedLocalFile) {
      const fileElem = document.querySelector(`.local-panel .file-item.selected`);
      if (fileElem && fileElem.dataset.type === 'directory') {
        await loadLocalDirectory(selectedLocalFile.path);
      }
    }
  } else if (activeElement && activeElement.closest('.remote-panel')) {
    if (selectedRemoteFile && currentConnection) {
      const fileElem = document.querySelector(`.remote-panel .file-item.selected`);
      if (fileElem && fileElem.dataset.type === 'directory') {
        await loadRemoteDirectory(selectedRemoteFile.path);
      }
    }
  }
}

async function renameSelectedFile() {
  // Determine which panel has focus
  const activeElement = document.activeElement;
  let isRemote = false;
  let selectedFile = null;
  
  if (activeElement && activeElement.closest('.local-panel')) {
    selectedFile = selectedLocalFile;
    isRemote = false;
  } else if (activeElement && activeElement.closest('.remote-panel')) {
    selectedFile = selectedRemoteFile;
    isRemote = true;
  } else {
    // Check which file is selected
    if (selectedLocalFile) {
      selectedFile = selectedLocalFile;
      isRemote = false;
    } else if (selectedRemoteFile) {
      selectedFile = selectedRemoteFile;
      isRemote = true;
    }
  }
  
  if (selectedFile) {
    await renameFile(selectedFile, isRemote);
  }
}

function showFilterMenu(button, panel) {
  currentFilterPanel = panel;
  const filterMenu = document.getElementById('filter-menu');
  const rect = button.getBoundingClientRect();
  
  // Position the menu below the button
  filterMenu.style.left = rect.left + 'px';
  filterMenu.style.top = (rect.bottom + 5) + 'px';
  filterMenu.style.display = 'block';
  
  // Load current filters
  const filters = currentFilters[panel];
  
  // Reset all checkboxes and radios
  filterMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  filterMenu.querySelector('input[name="filter-size"][value="all"]').checked = true;
  
  // Set current filter values
  filters.types.forEach(type => {
    const typeCheckbox = filterMenu.querySelector(`.filter-type[value="${type}"]`);
    if (typeCheckbox) typeCheckbox.checked = true;
  });
  
  filters.extensions.forEach(ext => {
    const extCheckbox = filterMenu.querySelector(`.filter-ext[value="${ext}"]`);
    if (extCheckbox) extCheckbox.checked = true;
  });
  
  const sizeRadio = filterMenu.querySelector(`input[name="filter-size"][value="${filters.size}"]`);
  if (sizeRadio) sizeRadio.checked = true;
}

function applyFilter() {
  if (!currentFilterPanel) return;
  
  const filterMenu = document.getElementById('filter-menu');
  const filters = {
    types: [],
    extensions: [],
    size: 'all'
  };
  
  // Get selected types
  filterMenu.querySelectorAll('.filter-type:checked').forEach(cb => {
    filters.types.push(cb.value);
  });
  
  // Get selected extensions
  filterMenu.querySelectorAll('.filter-ext:checked').forEach(cb => {
    filters.extensions.push(cb.value);
  });
  
  // Get selected size
  const sizeRadio = filterMenu.querySelector('input[name="filter-size"]:checked');
  if (sizeRadio) filters.size = sizeRadio.value;
  
  // If no types selected, default to all
  if (filters.types.length === 0) {
    filters.types = ['all'];
  }
  
  // Update current filters
  currentFilters[currentFilterPanel] = filters;
  
  // Update filter button appearance
  const filterBtn = document.getElementById(`btn-${currentFilterPanel}-filter`);
  const hasActiveFilters = filters.types.length > 1 || filters.types[0] !== 'all' || 
                          filters.extensions.length > 0 || filters.size !== 'all';
  
  if (hasActiveFilters) {
    filterBtn.classList.add('filter-active');
  } else {
    filterBtn.classList.remove('filter-active');
  }
  
  // Hide menu and reapply filters
  filterMenu.style.display = 'none';
  
  if (currentFilterPanel === 'local') {
    displayFiles(allLocalFiles, 'local');
  } else {
    displayFiles(allRemoteFiles, 'remote');
  }
}

function resetFilter() {
  if (!currentFilterPanel) return;
  
  // Reset to defaults
  currentFilters[currentFilterPanel] = { types: ['all'], extensions: [], size: 'all' };
  
  // Remove active class from button
  const filterBtn = document.getElementById(`btn-${currentFilterPanel}-filter`);
  filterBtn.classList.remove('filter-active');
  
  // Apply the reset
  applyFilter();
}

function sortFiles(panel) {
  const sortBy = document.getElementById(`${panel}-sort`).value;
  const files = panel === 'local' ? allLocalFiles : allRemoteFiles;
  
  displayFiles(files, panel);
}

function toggleSortOrder(panel) {
  sortOrders[panel] = sortOrders[panel] === 'asc' ? 'desc' : 'asc';
  
  // Update button text
  const btn = document.getElementById(`btn-${panel}-sort-order`);
  btn.textContent = sortOrders[panel] === 'asc' ? '↓' : '↑';
  
  // Re-sort files
  const files = panel === 'local' ? allLocalFiles : allRemoteFiles;
  displayFiles(files, panel);
}

function applyFiltersAndSort(files, panel) {
  const filters = currentFilters[panel];
  const sortBy = document.getElementById(`${panel}-sort`).value;
  const sortOrder = sortOrders[panel];
  
  // Apply filters
  let filteredFiles = files.filter(file => {
    // Type filter
    if (!filters.types.includes('all')) {
      if (filters.types.includes('directories') && file.type !== 'directory') return false;
      if (filters.types.includes('files') && file.type !== 'file') return false;
    }
    
    // Extension filter
    if (filters.extensions.length > 0 && file.type === 'file') {
      const ext = path.extname(file.name).toLowerCase();
      let matchesExt = false;
      
      filters.extensions.forEach(filter => {
        switch(filter) {
          case 'images':
            if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg'].includes(ext)) matchesExt = true;
            break;
          case 'documents':
            if (['.txt', '.pdf', '.doc', '.docx', '.odt'].includes(ext)) matchesExt = true;
            break;
          case 'code':
            if (['.js', '.ts', '.py', '.html', '.css', '.java', '.cpp', '.c', '.h'].includes(ext)) matchesExt = true;
            break;
          case 'archives':
            if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) matchesExt = true;
            break;
        }
      });
      
      if (!matchesExt) return false;
    }
    
    // Size filter
    if (filters.size !== 'all' && file.type === 'file') {
      const sizeMB = file.size / (1024 * 1024);
      switch(filters.size) {
        case 'small':
          if (sizeMB >= 1) return false;
          break;
        case 'medium':
          if (sizeMB < 1 || sizeMB > 10) return false;
          break;
        case 'large':
          if (sizeMB <= 10) return false;
          break;
      }
    }
    
    return true;
  });
  
  // Sort files
  filteredFiles.sort((a, b) => {
    // Always put .. first
    if (a.name === '..') return -1;
    if (b.name === '..') return 1;
    
    // Then directories
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    
    // Then sort by selected criteria
    let comparison = 0;
    switch(sortBy) {
      case 'name':
        comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case 'size':
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case 'date':
        const dateA = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
        const dateB = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
        comparison = dateA - dateB;
        break;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
  
  return filteredFiles;
}

function displayFiles(files, panel) {
  const fileList = document.getElementById(`${panel}-file-list`);
  const searchValue = document.getElementById(`${panel}-search`).value.toLowerCase();
  
  fileList.innerHTML = '';
  
  // Apply filters and sorting
  const processedFiles = applyFiltersAndSort(files, panel);
  
  // Apply search filter if there's a search value
  const displayedFiles = searchValue 
    ? processedFiles.filter(file => file.name.toLowerCase().includes(searchValue))
    : processedFiles;
  
  // Update search status
  if (searchValue) {
    const hiddenCount = processedFiles.length - displayedFiles.length;
    updateStatus(`Found ${displayedFiles.length} matches${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}`);
  }
  
  // Display files
  displayedFiles.forEach(file => {
    const isRemote = panel === 'remote';
    const onClick = file.type === 'directory' && file.name !== '..' 
      ? () => {
          if (isRemote) {
            loadRemoteDirectory(file.path);
          } else {
            loadLocalDirectory(file.path);
          }
        }
      : null;
    
    addFileItem(fileList, file.name, file.type, file.size, isRemote, onClick);
  });
}

async function showPermissionsDialog(file) {
  if (!currentConnection) return;
  
  document.getElementById('perm-filename').textContent = file.name;
  
  // Get current permissions
  try {
    const result = await ipcRenderer.invoke('get-file-stats', currentConnection, file.path);
    if (result.success) {
      const mode = result.stats.mode;
      const perms = (mode & parseInt('777', 8)).toString(8).padStart(3, '0');
      
      document.getElementById('perm-current').textContent = perms;
      document.getElementById('perm-octal').value = perms;
      
      // Update checkboxes
      updateCheckboxesFromOctal();
      
      // Store file path for apply
      document.getElementById('permissions-dialog').dataset.filePath = file.path;
      document.getElementById('permissions-dialog').style.display = 'flex';
    } else {
      showError(`Failed to get file permissions: ${result.error}`);
    }
  } catch (error) {
    showError(`Error getting permissions: ${error.message}`);
  }
}

function updateCheckboxesFromOctal() {
  const octal = document.getElementById('perm-octal').value;
  if (!/^[0-7]{3}$/.test(octal)) return;
  
  const perms = octal.split('').map(n => parseInt(n));
  
  // Owner
  document.getElementById('owner-read').checked = (perms[0] & 4) !== 0;
  document.getElementById('owner-write').checked = (perms[0] & 2) !== 0;
  document.getElementById('owner-execute').checked = (perms[0] & 1) !== 0;
  
  // Group
  document.getElementById('group-read').checked = (perms[1] & 4) !== 0;
  document.getElementById('group-write').checked = (perms[1] & 2) !== 0;
  document.getElementById('group-execute').checked = (perms[1] & 1) !== 0;
  
  // Other
  document.getElementById('other-read').checked = (perms[2] & 4) !== 0;
  document.getElementById('other-write').checked = (perms[2] & 2) !== 0;
  document.getElementById('other-execute').checked = (perms[2] & 1) !== 0;
}

function updateOctalFromCheckboxes() {
  let owner = 0;
  if (document.getElementById('owner-read').checked) owner += 4;
  if (document.getElementById('owner-write').checked) owner += 2;
  if (document.getElementById('owner-execute').checked) owner += 1;
  
  let group = 0;
  if (document.getElementById('group-read').checked) group += 4;
  if (document.getElementById('group-write').checked) group += 2;
  if (document.getElementById('group-execute').checked) group += 1;
  
  let other = 0;
  if (document.getElementById('other-read').checked) other += 4;
  if (document.getElementById('other-write').checked) other += 2;
  if (document.getElementById('other-execute').checked) other += 1;
  
  document.getElementById('perm-octal').value = `${owner}${group}${other}`;
}

async function applyPermissions() {
  const filePath = document.getElementById('permissions-dialog').dataset.filePath;
  const octal = document.getElementById('perm-octal').value;
  
  if (!filePath || !/^[0-7]{3}$/.test(octal)) return;
  
  try {
    const result = await ipcRenderer.invoke('chmod', currentConnection, filePath, octal);
    if (result.success) {
      document.getElementById('permissions-dialog').style.display = 'none';
      await loadRemoteDirectory(document.getElementById('remote-path').value);
    } else {
      showError(`Failed to change permissions: ${result.error}`);
    }
  } catch (error) {
    showError(`Error changing permissions: ${error.message}`);
  }
}

async function reconnectTerminal() {
  if (!currentConnectionConfig || currentConnectionConfig.protocol !== 'sftp') {
    showError('No SFTP connection to reconnect');
    return;
  }
  
  // Clear existing terminal
  if (terminal) {
    terminal.clear();
    terminal.write('\r\n[Reconnecting...]\r\n');
  }
  
  updateStatus('Reconnecting terminal...');
  
  try {
    // Close existing terminal connection
    await ipcRenderer.invoke('close-terminal');
    
    // Create new terminal connection
    const result = await ipcRenderer.invoke('create-terminal', currentConnectionConfig);
    
    if (result.success) {
      updateStatus('Terminal reconnected');
      if (terminal) {
        terminal.write('\r\n[Terminal reconnected successfully]\r\n');
      }
    } else {
      showError(`Failed to reconnect terminal: ${result.error}`);
      if (terminal) {
        terminal.write(`\r\n[Reconnection failed: ${result.error}]\r\n`);
      }
    }
  } catch (error) {
    showError(`Terminal reconnection error: ${error.message}`);
    if (terminal) {
      terminal.write(`\r\n[Reconnection error: ${error.message}]\r\n`);
    }
  }
}

function filterFiles(type, searchTerm) {
  // Simply redisplay files, the displayFiles function will handle search
  displayFiles(type === 'local' ? allLocalFiles : allRemoteFiles, type);
}

function showQueue() {
  showBottomPanel('queue');
  updateQueueBadge();
}

function hideQueue() {
  hideBottomPanel();
}

function showActivityLog() {
  showBottomPanel('log');
  activityLogger.updateDisplay();
}

function updateQueueBadge() {
  const badge = document.getElementById('queue-count-badge');
  if (transferQueue) {
    const activeCount = transferQueue.queue.filter(t => 
      t.status === 'queued' || t.status === 'active' || t.status === 'paused'
    ).length;
    badge.textContent = activeCount > 0 ? activeCount : '';
  } else {
    badge.textContent = '';
  }
}

async function uploadFolder(localFolderPath) {
  if (!currentConnection) {
    showError('No active connection');
    return;
  }
  
  updateStatus('Scanning folder for upload...');
  
  try {
    // Get all files recursively
    const files = await getFilesRecursively(localFolderPath);
    
    if (files.length === 0) {
      showError('Folder is empty');
      return;
    }
    
    updateStatus(`Found ${files.length} files to upload`);
    
    // Calculate base path for relative paths
    const basePath = path.dirname(localFolderPath);
    const folderName = path.basename(localFolderPath);
    const remoteBasePath = path.join(document.getElementById('remote-path').value, folderName);
    
    // Create remote base directory
    await ipcRenderer.invoke('create-directory', currentConnection, remoteBasePath);
    
    // Add all files to queue
    for (const file of files) {
      const relativePath = path.relative(localFolderPath, file.path);
      const remotePath = path.join(remoteBasePath, relativePath);
      const remoteDir = path.dirname(remotePath);
      
      // Ensure remote directory exists
      if (remoteDir !== remoteBasePath) {
        await ipcRenderer.invoke('create-directory', currentConnection, remoteDir);
      }
      
      transferQueue.addTransfer({
        type: 'upload',
        localPath: file.path,
        remotePath: remotePath,
        size: file.size,
        connectionId: currentConnection
      });
    }
    
    updateStatus(`Added ${files.length} files to upload queue`);
    showQueue();
  } catch (error) {
    showError(`Folder upload error: ${error.message}`);
  }
}

async function downloadFolder(remoteFolderPath, folderName) {
  if (!currentConnection) {
    showError('No active connection');
    return;
  }
  
  updateStatus('Scanning remote folder...');
  
  try {
    // Get all remote files recursively
    const files = await getRemoteFilesRecursively(remoteFolderPath);
    
    if (files.length === 0) {
      showError('Folder is empty');
      return;
    }
    
    updateStatus(`Found ${files.length} files to download`);
    
    // Calculate local base path
    const localBasePath = path.join(document.getElementById('local-path').value, folderName);
    
    // Create local base directory
    await fs.mkdir(localBasePath, { recursive: true });
    
    // Add all files to queue
    for (const file of files) {
      const relativePath = path.relative(remoteFolderPath, file.path);
      const localPath = path.join(localBasePath, relativePath);
      const localDir = path.dirname(localPath);
      
      // Ensure local directory exists
      if (localDir !== localBasePath) {
        await fs.mkdir(localDir, { recursive: true });
      }
      
      transferQueue.addTransfer({
        type: 'download',
        localPath: localPath,
        remotePath: file.path,
        size: file.size,
        connectionId: currentConnection
      });
    }
    
    updateStatus(`Added ${files.length} files to download queue`);
    showQueue();
  } catch (error) {
    showError(`Folder download error: ${error.message}`);
  }
}

async function getFilesRecursively(dirPath, fileList = []) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await getFilesRecursively(fullPath, fileList);
      } else {
        try {
          const stats = await fs.stat(fullPath);
          fileList.push({
            path: fullPath,
            size: stats.size
          });
        } catch (err) {
          console.error(`Error accessing file ${fullPath}:`, err);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  
  return fileList;
}

async function getRemoteFilesRecursively(dirPath, fileList = []) {
  try {
    const result = await ipcRenderer.invoke('list-directory', currentConnection, dirPath);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    for (const item of result.files) {
      const fullPath = path.join(dirPath, item.name);
      
      if (item.type === 'directory') {
        await getRemoteFilesRecursively(fullPath, fileList);
      } else {
        fileList.push({
          path: fullPath,
          size: item.size
        });
      }
    }
  } catch (error) {
    console.error(`Error reading remote directory ${dirPath}:`, error);
  }
  
  return fileList;
}

// SSH Key Management Functions
async function showSSHKeysDialog() {
  document.getElementById('ssh-keys-dialog').style.display = 'flex';
  await loadSSHKeys();
}

async function loadSSHKeys() {
  const result = await ipcRenderer.invoke('list-ssh-keys');
  
  if (result.success) {
    displaySSHKeys(result.keys);
  } else {
    showError(`Failed to load SSH keys: ${result.error}`);
  }
}

function displaySSHKeys(keys) {
  const container = document.getElementById('ssh-keys-list');
  
  if (keys.length === 0) {
    container.innerHTML = '<div class="empty-ssh-keys">No SSH keys found. Generate one to get started!</div>';
    return;
  }
  
  container.innerHTML = '';
  
  keys.forEach(key => {
    const keyElement = document.createElement('div');
    keyElement.className = 'ssh-key-item';
    keyElement.innerHTML = `
      <div class="ssh-key-header">
        <div class="ssh-key-name">${key.name}</div>
        <div class="ssh-key-actions">
          <button class="ssh-key-btn" onclick="copySSHPublicKey('${key.id}')">Copy Public Key</button>
          <button class="ssh-key-btn" onclick="showSSHKeyDetails('${key.id}')">View</button>
          <button class="ssh-key-btn delete" onclick="deleteSSHKey('${key.id}', '${key.name}')">Delete</button>
        </div>
      </div>
      <div class="ssh-key-info">
        <span>Type: ${key.type}</span>
        <span>Created: ${new Date(key.createdAt).toLocaleDateString()}</span>
        ${key.hasPassphrase ? '<span>🔒 Passphrase protected</span>' : ''}
      </div>
      <div class="ssh-key-fingerprint">Fingerprint: ${key.fingerprint}</div>
      <div id="key-details-${key.id}" style="display: none;">
        <div class="public-key-content">${key.publicKey}</div>
      </div>
    `;
    
    container.appendChild(keyElement);
  });
}

async function handleGenerateSSHKey(event) {
  event.preventDefault();
  
  const name = document.getElementById('key-name').value.trim();
  const type = document.getElementById('key-type').value;
  const passphrase = document.getElementById('key-passphrase').value;
  const comment = document.getElementById('key-comment').value.trim();
  
  if (!name) {
    showError('Please enter a key name');
    return;
  }
  
  // Validate key name (no special characters that could cause issues)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showError('Key name can only contain letters, numbers, underscores, and hyphens');
    return;
  }
  
  updateStatus('Generating SSH key...');
  
  const result = await ipcRenderer.invoke('generate-ssh-key', {
    name,
    type,
    passphrase,
    comment
  });
  
  if (result.success) {
    updateStatus('SSH key generated successfully');
    showMessage(`SSH key "${name}" generated successfully!`);
    
    // Clear form
    document.getElementById('generate-key-form').reset();
    
    // Reload keys list
    await loadSSHKeys();
  } else {
    showError(`Failed to generate SSH key: ${result.error}`);
    updateStatus('Ready');
  }
}

window.copySSHPublicKey = async function(keyId) {
  const result = await ipcRenderer.invoke('get-ssh-public-key', keyId);
  
  if (result.success) {
    // Copy to clipboard
    navigator.clipboard.writeText(result.publicKey).then(() => {
      showMessage('Public key copied to clipboard!');
    }).catch(err => {
      showError('Failed to copy to clipboard');
    });
  } else {
    showError(`Failed to get public key: ${result.error}`);
  }
};

window.showSSHKeyDetails = function(keyId) {
  const detailsElement = document.getElementById(`key-details-${keyId}`);
  if (detailsElement) {
    detailsElement.style.display = detailsElement.style.display === 'none' ? 'block' : 'none';
  }
};

window.deleteSSHKey = async function(keyId, keyName) {
  const confirm = await showConfirm(`Are you sure you want to delete the SSH key "${keyName}"? This action cannot be undone.`);
  
  if (confirm) {
    const result = await ipcRenderer.invoke('delete-ssh-key', keyId);
    
    if (result.success) {
      showMessage(`SSH key "${keyName}" deleted successfully`);
      await loadSSHKeys();
    } else {
      showError(`Failed to delete SSH key: ${result.error}`);
    }
  }
};

function showConfirm(message) {
  // Simple confirm dialog - you could make this prettier
  return new Promise(resolve => {
    resolve(confirm(message));
  });
}

async function populateAvailableSSHKeys() {
  const select = document.getElementById('private-key-select');
  const result = await ipcRenderer.invoke('list-ssh-keys');
  
  // Clear existing options except the first one
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  if (result.success && result.keys.length > 0) {
    result.keys.forEach(key => {
      const option = document.createElement('option');
      option.value = key.path;
      option.textContent = `${key.name} (${key.type})`;
      select.appendChild(option);
    });
  }
  
  // Add change listener to populate the text input
  select.onchange = function() {
    if (this.value) {
      document.getElementById('private-key').value = this.value;
    }
  };
}

// Settings Functions
async function showSettingsDialog() {
  const dialog = document.getElementById('settings-dialog');
  dialog.style.display = 'flex';
  
  // Load general settings from localStorage
  const generalSettings = JSON.parse(localStorage.getItem('generalSettings') || '{}');
  document.getElementById('preserve-timestamps').checked = generalSettings.preserveTimestamps !== false;
  document.getElementById('overwrite-existing').checked = generalSettings.overwriteExisting !== false;
  document.getElementById('follow-symlinks').checked = generalSettings.followSymlinks || false;
  
  // Load compression settings from localStorage
  const compressionSettings = JSON.parse(localStorage.getItem('compressionSettings') || '{}');
  document.getElementById('auto-compress-files').checked = compressionSettings.autoCompressFiles !== false;
  document.getElementById('auto-compress-folders').checked = compressionSettings.autoCompressFolders !== false;
  document.getElementById('compression-threshold').value = compressionSettings.threshold || 1;
  document.getElementById('compression-threshold-unit').value = compressionSettings.thresholdUnit || 'MB';
  document.getElementById('compression-exclude').value = compressionSettings.exclude || 'jpg, jpeg, png, gif, zip, rar, 7z, mp3, mp4, avi';
  
  // Load appearance settings from localStorage
  const appearanceSettings = JSON.parse(localStorage.getItem('appearanceSettings') || '{}');
  document.getElementById('theme-select').value = appearanceSettings.theme || 'dark';
  document.getElementById('font-family').value = appearanceSettings.fontFamily || 'default';
  document.getElementById('font-size').value = appearanceSettings.fontSize || 13;
  document.getElementById('font-size-value').textContent = (appearanceSettings.fontSize || 13) + 'px';
  document.getElementById('show-hidden-files').checked = appearanceSettings.showHiddenFiles !== false;
  document.getElementById('compact-mode').checked = appearanceSettings.compactMode || false;
  
  // Show custom theme settings if custom theme is selected
  document.getElementById('custom-theme-settings').style.display = 
    appearanceSettings.theme === 'custom' ? 'block' : 'none';
  
  // Load custom colors if available
  if (appearanceSettings.customColors) {
    Object.keys(appearanceSettings.customColors).forEach(key => {
      const input = document.getElementById(`color-${key}`);
      if (input) input.value = appearanceSettings.customColors[key];
    });
  }
  
  // Load current speed limits if connected
  if (currentConnection) {
    const limits = await ipcRenderer.invoke('get-speed-limits', currentConnection);
    
    // Set global limits
    if (limits.globalUpload !== Infinity) {
      const value = limits.globalUpload / 1024; // Convert to KB/s
      if (value >= 1024) {
        document.getElementById('global-upload-limit').value = value / 1024;
        document.getElementById('global-upload-unit').value = 'MB/s';
      } else {
        document.getElementById('global-upload-limit').value = value;
        document.getElementById('global-upload-unit').value = 'KB/s';
      }
    }
    
    if (limits.globalDownload !== Infinity) {
      const value = limits.globalDownload / 1024; // Convert to KB/s
      if (value >= 1024) {
        document.getElementById('global-download-limit').value = value / 1024;
        document.getElementById('global-download-unit').value = 'MB/s';
      } else {
        document.getElementById('global-download-limit').value = value;
        document.getElementById('global-download-unit').value = 'KB/s';
      }
    }
    
    // Set connection-specific limits
    if (limits.upload !== Infinity) {
      const value = limits.upload / 1024; // Convert to KB/s
      if (value >= 1024) {
        document.getElementById('connection-upload-limit').value = value / 1024;
        document.getElementById('connection-upload-unit').value = 'MB/s';
      } else {
        document.getElementById('connection-upload-limit').value = value;
        document.getElementById('connection-upload-unit').value = 'KB/s';
      }
    }
    
    if (limits.download !== Infinity) {
      const value = limits.download / 1024; // Convert to KB/s
      if (value >= 1024) {
        document.getElementById('connection-download-limit').value = value / 1024;
        document.getElementById('connection-download-unit').value = 'MB/s';
      } else {
        document.getElementById('connection-download-limit').value = value;
        document.getElementById('connection-download-unit').value = 'KB/s';
      }
    }
  }
}

async function applySettings() {
  // Save general settings
  const generalSettings = {
    preserveTimestamps: document.getElementById('preserve-timestamps').checked,
    overwriteExisting: document.getElementById('overwrite-existing').checked,
    followSymlinks: document.getElementById('follow-symlinks').checked
  };
  localStorage.setItem('generalSettings', JSON.stringify(generalSettings));
  
  // Save compression settings
  const compressionSettings = {
    autoCompressFiles: document.getElementById('auto-compress-files').checked,
    autoCompressFolders: document.getElementById('auto-compress-folders').checked,
    threshold: parseFloat(document.getElementById('compression-threshold').value) || 1,
    thresholdUnit: document.getElementById('compression-threshold-unit').value,
    exclude: document.getElementById('compression-exclude').value
  };
  localStorage.setItem('compressionSettings', JSON.stringify(compressionSettings));
  
  // Save appearance settings
  const appearanceSettings = {
    theme: document.getElementById('theme-select').value,
    fontFamily: document.getElementById('font-family').value,
    fontSize: parseInt(document.getElementById('font-size').value),
    showHiddenFiles: document.getElementById('show-hidden-files').checked,
    compactMode: document.getElementById('compact-mode').checked
  };
  
  // Save custom colors if custom theme is selected
  if (appearanceSettings.theme === 'custom') {
    appearanceSettings.customColors = {
      bg: document.getElementById('color-bg').value,
      fg: document.getElementById('color-fg').value,
      accent: document.getElementById('color-accent').value,
      hover: document.getElementById('color-hover').value,
      border: document.getElementById('color-border').value,
      success: document.getElementById('color-success').value
    };
  }
  
  localStorage.setItem('appearanceSettings', JSON.stringify(appearanceSettings));
  
  // Apply appearance settings
  applyTheme(appearanceSettings);
  
  // Apply speed limit settings
  const globalUploadValue = parseFloat(document.getElementById('global-upload-limit').value) || 0;
  const globalUploadUnit = document.getElementById('global-upload-unit').value;
  const globalDownloadValue = parseFloat(document.getElementById('global-download-limit').value) || 0;
  const globalDownloadUnit = document.getElementById('global-download-unit').value;
  
  const connectionUploadValue = parseFloat(document.getElementById('connection-upload-limit').value) || 0;
  const connectionUploadUnit = document.getElementById('connection-upload-unit').value;
  const connectionDownloadValue = parseFloat(document.getElementById('connection-download-limit').value) || 0;
  const connectionDownloadUnit = document.getElementById('connection-download-unit').value;
  
  // Convert to bytes per second
  const convertToBytes = (value, unit) => {
    if (value === 0) return Infinity; // No limit
    const bytes = unit === 'MB/s' ? value * 1024 * 1024 : value * 1024;
    return bytes;
  };
  
  const globalUploadBytes = convertToBytes(globalUploadValue, globalUploadUnit);
  const globalDownloadBytes = convertToBytes(globalDownloadValue, globalDownloadUnit);
  const connectionUploadBytes = convertToBytes(connectionUploadValue, connectionUploadUnit);
  const connectionDownloadBytes = convertToBytes(connectionDownloadValue, connectionDownloadUnit);
  
  // Apply global limits
  await ipcRenderer.invoke('set-global-speed-limit', 'upload', globalUploadBytes);
  await ipcRenderer.invoke('set-global-speed-limit', 'download', globalDownloadBytes);
  
  // Apply connection-specific limits if connected
  if (currentConnection) {
    await ipcRenderer.invoke('set-speed-limit', currentConnection, 'upload', connectionUploadBytes);
    await ipcRenderer.invoke('set-speed-limit', currentConnection, 'download', connectionDownloadBytes);
  }
  
  // Close dialog
  document.getElementById('settings-dialog').style.display = 'none';
  
  // Update status
  updateStatus('Settings applied successfully');
}

// Theme Functions
function applyTheme(settings) {
  const body = document.body;
  
  // Remove all theme classes
  body.classList.remove('theme-light', 'theme-blue', 'theme-monokai', 'theme-solarized-dark');
  
  // Apply theme
  if (settings.theme && settings.theme !== 'dark' && settings.theme !== 'custom') {
    body.classList.add(`theme-${settings.theme}`);
  }
  
  // Apply custom theme colors
  if (settings.theme === 'custom' && settings.customColors) {
    const root = document.documentElement;
    root.style.setProperty('--bg-primary', settings.customColors.bg);
    root.style.setProperty('--text-primary', settings.customColors.fg);
    root.style.setProperty('--accent-color', settings.customColors.accent);
    root.style.setProperty('--hover-bg', settings.customColors.hover);
    root.style.setProperty('--border-color', settings.customColors.border);
    root.style.setProperty('--success-color', settings.customColors.success);
    
    // Set secondary colors based on primary
    root.style.setProperty('--bg-secondary', lightenDarkenColor(settings.customColors.bg, 20));
    root.style.setProperty('--bg-tertiary', lightenDarkenColor(settings.customColors.bg, 40));
    root.style.setProperty('--text-secondary', lightenDarkenColor(settings.customColors.fg, -30));
  } else if (settings.theme === 'dark') {
    // Reset to default dark theme
    const root = document.documentElement;
    root.style.setProperty('--bg-primary', '#1e1e1e');
    root.style.setProperty('--bg-secondary', '#2d2d2d');
    root.style.setProperty('--bg-tertiary', '#3a3a3a');
    root.style.setProperty('--text-primary', '#e0e0e0');
    root.style.setProperty('--text-secondary', '#a0a0a0');
    root.style.setProperty('--accent-color', '#00bfff');
    root.style.setProperty('--hover-bg', '#4a4a4a');
    root.style.setProperty('--border-color', '#3a3a3a');
    root.style.setProperty('--success-color', '#4caf50');
  }
  
  // Apply font family
  if (settings.fontFamily && settings.fontFamily !== 'default') {
    const fontMap = {
      'monospace': 'monospace',
      'consolas': 'Consolas, monospace',
      'monaco': 'Monaco, monospace',
      'fira-code': '"Fira Code", monospace',
      'jetbrains': '"JetBrains Mono", monospace'
    };
    document.documentElement.style.setProperty('--font-family', fontMap[settings.fontFamily]);
  }
  
  // Apply font size
  if (settings.fontSize) {
    document.documentElement.style.setProperty('--font-size', settings.fontSize + 'px');
  }
  
  // Apply compact mode
  if (settings.compactMode) {
    body.classList.add('compact-mode');
  } else {
    body.classList.remove('compact-mode');
  }
  
  // Apply show hidden files setting
  if (settings.showHiddenFiles === false) {
    body.classList.add('hide-hidden-files');
  } else {
    body.classList.remove('hide-hidden-files');
  }
  
  // Refresh file lists if needed
  if (window.currentLocalPath) {
    loadLocalDirectory(window.currentLocalPath);
  }
  if (window.currentRemotePath && window.currentConnection) {
    loadRemoteDirectory(window.currentRemotePath);
  }
}

function lightenDarkenColor(col, amt) {
  let usePound = false;
  if (col[0] === "#") {
    col = col.slice(1);
    usePound = true;
  }
  const num = parseInt(col, 16);
  let r = (num >> 16) + amt;
  if (r > 255) r = 255;
  else if (r < 0) r = 0;
  let b = ((num >> 8) & 0x00FF) + amt;
  if (b > 255) b = 255;
  else if (b < 0) b = 0;
  let g = (num & 0x0000FF) + amt;
  if (g > 255) g = 255;
  else if (g < 0) g = 0;
  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

// File Compression Functions
function shouldCompressFile(file) {
  const settings = JSON.parse(localStorage.getItem('compressionSettings') || '{}');
  
  // Check if compression is enabled for files
  if (settings.autoCompressFiles === false) {
    return false;
  }
  
  // Check file size threshold
  const threshold = settings.threshold || 1;
  const unit = settings.thresholdUnit || 'MB';
  let thresholdBytes = threshold;
  if (unit === 'KB') thresholdBytes *= 1024;
  else if (unit === 'MB') thresholdBytes *= 1024 * 1024;
  else if (unit === 'GB') thresholdBytes *= 1024 * 1024 * 1024;
  
  if (file.size < thresholdBytes) {
    return false;
  }
  
  // Check excluded extensions
  const excludedExtensions = (settings.exclude || 'jpg, jpeg, png, gif, zip, rar, 7z, mp3, mp4, avi')
    .split(',')
    .map(ext => ext.trim().toLowerCase());
  
  const fileExtension = file.name.split('.').pop().toLowerCase();
  if (excludedExtensions.includes(fileExtension)) {
    return false;
  }
  
  return true;
}

function shouldCompressFolder() {
  const settings = JSON.parse(localStorage.getItem('compressionSettings') || '{}');
  return settings.autoCompressFolders !== false;
}

async function compressAndUploadFile(file) {
  if (!currentConnection) {
    showError('No active connection');
    return;
  }
  
  try {
    updateStatus(`Compressing ${file.name}...`);
    
    // Request compression from main process
    const result = await ipcRenderer.invoke('compress-file', file.path);
    
    if (!result.success) {
      showError(`Failed to compress file: ${result.error}`);
      return;
    }
    
    const compressedFile = {
      name: result.compressedName,
      path: result.compressedPath,
      originalName: file.name,
      compressionRatio: result.compressionRatio
    };
    
    // Add to transfer queue
    const remotePath = path.join(
      document.getElementById('remote-path').value,
      compressedFile.name
    );
    
    transferQueue.addTransfer({
      type: 'upload',
      name: compressedFile.name,
      localPath: compressedFile.path,
      remotePath: remotePath,
      size: result.compressedSize,
      isCompressed: true,
      originalSize: result.originalSize,
      compressionRatio: result.compressionRatio,
      deleteAfterUpload: true // Clean up temp file after upload
    });
    
    updateStatus(`Compressed ${file.name} (${Math.round(result.compressionRatio * 100)}% of original size)`);
    showMessage(`File compressed to ${Math.round(result.compressionRatio * 100)}% of original size`);
  } catch (error) {
    showError(`Compression error: ${error.message}`);
  }
}

async function compressAndUploadFolder(folder) {
  if (!currentConnection) {
    showError('No active connection');
    return;
  }
  
  try {
    updateStatus(`Compressing folder ${folder.name}...`);
    
    // Request folder compression from main process
    const result = await ipcRenderer.invoke('compress-folder', folder.path);
    
    if (!result.success) {
      showError(`Failed to compress folder: ${result.error}`);
      return;
    }
    
    const compressedFile = {
      name: result.compressedName,
      path: result.compressedPath,
      originalName: folder.name,
      compressionRatio: result.compressionRatio
    };
    
    // Add to transfer queue
    const remotePath = path.join(
      document.getElementById('remote-path').value,
      compressedFile.name
    );
    
    transferQueue.addTransfer({
      type: 'upload',
      name: compressedFile.name,
      localPath: compressedFile.path,
      remotePath: remotePath,
      size: result.compressedSize,
      isCompressed: true,
      originalSize: result.originalSize,
      compressionRatio: result.compressionRatio,
      deleteAfterUpload: true // Clean up temp file after upload
    });
    
    updateStatus(`Compressed ${folder.name} (${Math.round(result.compressionRatio * 100)}% of original size)`);
    showMessage(`Folder compressed to ${Math.round(result.compressionRatio * 100)}% of original size`);
  } catch (error) {
    showError(`Compression error: ${error.message}`);
  }
}