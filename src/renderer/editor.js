const { ipcRenderer } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { detect } = require('chardet');
const iconv = require('iconv-lite');

class CodeEditor {
  constructor() {
    this.currentFile = null;
    this.originalContent = null;
    this.currentEncoding = 'utf8';
    this.isModified = false;
    this.isRemote = false;
    this.connectionId = null;
    this.editor = null;
    this.listeners = new Map();
    this.isMinimized = false;
    this.isMaximized = false;
    this.previousPosition = null;
  }

  async initialize() {
    // Load CodeMirror CSS
    const cmCss = document.createElement('link');
    cmCss.rel = 'stylesheet';
    cmCss.href = '../../node_modules/codemirror/lib/codemirror.css';
    document.head.appendChild(cmCss);
    
    const cmTheme = document.createElement('link');
    cmTheme.rel = 'stylesheet';
    cmTheme.href = '../../node_modules/codemirror/theme/monokai.css';
    document.head.appendChild(cmTheme);
    
    // Load CodeMirror
    const CodeMirror = require('codemirror');
    require('codemirror/mode/javascript/javascript');
    require('codemirror/mode/python/python');
    require('codemirror/mode/xml/xml');
    require('codemirror/mode/htmlmixed/htmlmixed');
    require('codemirror/mode/css/css');
    require('codemirror/mode/php/php');
    require('codemirror/mode/sql/sql');
    require('codemirror/mode/markdown/markdown');
    require('codemirror/mode/yaml/yaml');
    require('codemirror/mode/shell/shell');
    require('codemirror/mode/clike/clike');
    require('codemirror/mode/rust/rust');
    require('codemirror/mode/go/go');
    require('codemirror/addon/edit/closebrackets');
    require('codemirror/addon/edit/matchbrackets');
    require('codemirror/addon/selection/active-line');
    
    // Initialize CodeMirror editor
    this.editor = CodeMirror.fromTextArea(document.getElementById('editor-textarea'), {
      lineNumbers: true,
      theme: 'monokai',
      mode: 'text/plain',
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      autoCloseBrackets: true,
      matchBrackets: true,
      styleActiveLine: true,
      extraKeys: {
        'Ctrl-S': () => this.save(),
        'Cmd-S': () => this.save(),
        'Ctrl-W': () => this.close(),
        'Cmd-W': () => this.close(),
        'F11': () => this.toggleFullscreen()
      }
    });

    // Track changes
    this.editor.on('change', () => {
      if (this.originalContent !== null && this.editor.getValue() !== this.originalContent) {
        this.setModified(true);
      } else {
        this.setModified(false);
      }
    });

    // Setup UI event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.getElementById('btn-editor-save').addEventListener('click', () => this.save());
    document.getElementById('btn-editor-reload').addEventListener('click', () => this.reload());
    document.getElementById('btn-editor-close').addEventListener('click', () => this.close());
    document.getElementById('btn-editor-minimize').addEventListener('click', () => this.minimize());
    document.getElementById('btn-editor-maximize').addEventListener('click', () => this.maximize());
    document.getElementById('editor-encoding').addEventListener('change', (e) => this.changeEncoding(e.target.value));
    document.getElementById('editor-mode').addEventListener('change', (e) => this.changeMode(e.target.value));
    
    // Make the editor draggable
    this.makeDraggable();
  }
  
  makeDraggable() {
    const dialog = document.getElementById('editor-dialog');
    const header = dialog.querySelector('.editor-header');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    
    header.addEventListener('mousedown', (e) => {
      // Don't start drag if clicking on controls
      if (e.target.closest('.editor-controls')) return;
      
      isDragging = true;
      initialX = e.clientX - dialog.offsetLeft;
      initialY = e.clientY - dialog.offsetTop;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      
      // Ensure window stays within viewport
      currentX = Math.max(0, Math.min(currentX, window.innerWidth - dialog.offsetWidth));
      currentY = Math.max(0, Math.min(currentY, window.innerHeight - dialog.offsetHeight));
      
      dialog.style.left = currentX + 'px';
      dialog.style.top = currentY + 'px';
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  async openFile(filePath, isRemote = false, connectionId = null) {
    try {
      this.currentFile = filePath;
      this.isRemote = isRemote;
      this.connectionId = connectionId;

      let content;
      let detectedEncoding;

      if (isRemote) {
        // Download remote file to temp location for encoding detection
        const tempPath = path.join(require('os').tmpdir(), `ftp-edit-${Date.now()}-${path.basename(filePath)}`);
        
        const result = await ipcRenderer.invoke('download-file-with-progress', connectionId, filePath, tempPath, `editor-${Date.now()}`);
        if (!result.success) {
          throw new Error(`Failed to download file: ${result.error}`);
        }

        // Read the file to detect encoding
        const buffer = await fs.readFile(tempPath);
        detectedEncoding = detect(buffer) || 'utf8';
        
        // Convert to string using detected encoding
        content = iconv.decode(buffer, detectedEncoding);
        
        // Clean up temp file
        await fs.unlink(tempPath);
      } else {
        // Read local file
        const buffer = await fs.readFile(filePath);
        detectedEncoding = detect(buffer) || 'utf8';
        content = iconv.decode(buffer, detectedEncoding);
      }

      this.currentEncoding = detectedEncoding;
      this.originalContent = content;
      
      // Update UI
      document.getElementById('editor-filename').textContent = path.basename(filePath);
      document.getElementById('editor-path').textContent = filePath;
      document.getElementById('editor-path').title = filePath;
      
      // Set the encoding dropdown - normalize encoding names to match dropdown options
      const encodingSelect = document.getElementById('editor-encoding');
      let normalizedEncoding = detectedEncoding.toLowerCase();
      
      // Map common encoding names to dropdown values
      const encodingMap = {
        'utf-8': 'utf8',
        'utf8': 'utf8',
        'utf16le': 'utf16le',
        'utf16be': 'utf16be',
        'iso-8859-1': 'latin1',
        'iso88591': 'latin1',
        'latin1': 'latin1',
        'windows-1252': 'windows1252',
        'windows1252': 'windows1252',
        'ascii': 'ascii',
        'gb18030': 'gb18030',
        'shift_jis': 'shift_jis',
        'shiftjis': 'shift_jis',
        'euc-jp': 'euc-jp',
        'eucjp': 'euc-jp',
        'euc-kr': 'euc-kr',
        'euckr': 'euc-kr',
        'big5': 'big5'
      };
      
      const mappedEncoding = encodingMap[normalizedEncoding] || detectedEncoding;
      
      // Try to set the value, if it doesn't exist in dropdown, add it
      if ([...encodingSelect.options].some(opt => opt.value === mappedEncoding)) {
        encodingSelect.value = mappedEncoding;
      } else {
        // Add the detected encoding as a new option if it's not in the list
        const option = document.createElement('option');
        option.value = detectedEncoding;
        option.textContent = detectedEncoding.toUpperCase();
        encodingSelect.appendChild(option);
        encodingSelect.value = detectedEncoding;
      }
      
      // Set editor content and mode
      this.editor.setValue(content);
      this.editor.clearHistory();
      this.setModified(false);
      
      // Auto-detect file mode based on extension
      const mode = this.detectMode(filePath);
      this.editor.setOption('mode', mode);
      document.getElementById('editor-mode').value = mode;
      
      // Show editor dialog
      document.getElementById('editor-dialog').style.display = 'flex';
      
      // Focus editor and ensure proper sizing
      setTimeout(() => {
        this.editor.refresh();
        this.editor.focus();
        // Force CodeMirror to recalculate its size
        this.editor.setSize("100%", "100%");
      }, 100);
      
      // Log to activity
      if (window.activityLogger) {
        window.activityLogger.addLog('info', `Opened file in editor: ${path.basename(filePath)}`, {
          path: filePath,
          encoding: detectedEncoding,
          remote: isRemote
        });
      }
      
    } catch (error) {
      console.error('Error opening file:', error);
      alert(`Failed to open file: ${error.message}`);
    }
  }

  async save() {
    if (!this.currentFile || !this.isModified) return;

    try {
      const content = this.editor.getValue();
      
      // Convert content to buffer with original encoding
      const buffer = iconv.encode(content, this.currentEncoding);

      if (this.isRemote) {
        // Save to temp file first
        const tempPath = path.join(require('os').tmpdir(), `ftp-save-${Date.now()}-${path.basename(this.currentFile)}`);
        await fs.writeFile(tempPath, buffer);
        
        // Upload to remote
        const result = await ipcRenderer.invoke('upload-file-with-progress', this.connectionId, tempPath, this.currentFile, `editor-${Date.now()}`);
        
        // Clean up temp file
        await fs.unlink(tempPath);
        
        if (!result.success) {
          throw new Error(`Failed to upload file: ${result.error}`);
        }
      } else {
        // Save local file
        await fs.writeFile(this.currentFile, buffer);
      }

      this.originalContent = content;
      this.setModified(false);
      
      // Update status
      this.showStatus('File saved successfully', 'success');
      
      // Log to activity
      if (window.activityLogger) {
        window.activityLogger.addLog('success', `Saved file: ${path.basename(this.currentFile)}`, {
          path: this.currentFile,
          encoding: this.currentEncoding,
          remote: this.isRemote
        });
      }
      
    } catch (error) {
      console.error('Error saving file:', error);
      alert(`Failed to save file: ${error.message}`);
    }
  }

  async reload() {
    if (this.currentFile) {
      if (this.isModified) {
        const confirmed = confirm('You have unsaved changes. Are you sure you want to reload?');
        if (!confirmed) return;
      }
      await this.openFile(this.currentFile, this.isRemote, this.connectionId);
    }
  }

  close() {
    if (this.isModified) {
      const confirmed = confirm('You have unsaved changes. Are you sure you want to close?');
      if (!confirmed) return;
    }

    this.currentFile = null;
    this.originalContent = null;
    this.isModified = false;
    this.editor.setValue('');
    document.getElementById('editor-dialog').style.display = 'none';
  }

  async changeEncoding(newEncoding) {
    if (newEncoding === this.currentEncoding) return;

    try {
      // Re-read file with new encoding
      let buffer;
      
      if (this.isRemote) {
        // Download to temp for re-encoding
        const tempPath = path.join(require('os').tmpdir(), `ftp-reenc-${Date.now()}-${path.basename(this.currentFile)}`);
        const result = await ipcRenderer.invoke('download-file-with-progress', this.connectionId, this.currentFile, tempPath, `editor-reenc-${Date.now()}`);
        if (!result.success) {
          throw new Error(`Failed to download file: ${result.error}`);
        }
        buffer = await fs.readFile(tempPath);
        await fs.unlink(tempPath);
      } else {
        buffer = await fs.readFile(this.currentFile);
      }

      // Convert with new encoding
      const content = iconv.decode(buffer, newEncoding);
      this.currentEncoding = newEncoding;
      this.originalContent = content;
      this.editor.setValue(content);
      this.setModified(false);
      
      this.showStatus(`Encoding changed to ${newEncoding}`, 'info');
      
    } catch (error) {
      console.error('Error changing encoding:', error);
      alert(`Failed to change encoding: ${error.message}`);
      // Revert encoding selection
      document.getElementById('editor-encoding').value = this.currentEncoding;
    }
  }

  changeMode(mode) {
    this.editor.setOption('mode', mode);
  }

  setModified(modified) {
    this.isModified = modified;
    const indicator = document.getElementById('editor-modified');
    if (modified) {
      indicator.style.display = 'inline';
      document.getElementById('editor-filename').classList.add('modified');
    } else {
      indicator.style.display = 'none';
      document.getElementById('editor-filename').classList.remove('modified');
    }
  }

  detectMode(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const modeMap = {
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript-jsx',
      '.json': 'application/json',
      '.html': 'htmlmixed',
      '.htm': 'htmlmixed',
      '.xml': 'xml',
      '.css': 'css',
      '.scss': 'text/x-scss',
      '.sass': 'text/x-sass',
      '.less': 'text/x-less',
      '.py': 'python',
      '.rb': 'ruby',
      '.php': 'php',
      '.java': 'text/x-java',
      '.c': 'text/x-csrc',
      '.cpp': 'text/x-c++src',
      '.h': 'text/x-csrc',
      '.cs': 'text/x-csharp',
      '.go': 'text/x-go',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'text/x-kotlin',
      '.scala': 'text/x-scala',
      '.sh': 'shell',
      '.bash': 'shell',
      '.zsh': 'shell',
      '.fish': 'shell',
      '.ps1': 'powershell',
      '.sql': 'sql',
      '.md': 'markdown',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml',
      '.ini': 'text/x-ini',
      '.conf': 'text/x-ini',
      '.dockerfile': 'dockerfile',
      '.makefile': 'text/x-makefile',
      '.cmake': 'cmake',
      '.r': 'r',
      '.lua': 'lua',
      '.pl': 'perl',
      '.vim': 'text/x-vim'
    };
    
    // Check for specific filenames
    const basename = path.basename(filePath).toLowerCase();
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile' || basename.startsWith('makefile.')) return 'text/x-makefile';
    if (basename === 'cmakelists.txt') return 'cmake';
    
    return modeMap[ext] || 'text/plain';
  }

  toggleFullscreen() {
    const dialog = document.getElementById('editor-dialog');
    dialog.classList.toggle('fullscreen');
    this.editor.refresh();
  }

  minimize() {
    const dialog = document.getElementById('editor-dialog');
    const taskbar = document.getElementById('editor-taskbar');
    const taskbarItems = document.getElementById('taskbar-items');
    
    // Hide the editor
    dialog.style.display = 'none';
    this.isMinimized = true;
    
    // Show taskbar if not already visible
    taskbar.style.display = 'flex';
    
    // Create taskbar item if it doesn't exist
    let taskbarItem = document.getElementById(`taskbar-${this.currentFile}`);
    if (!taskbarItem) {
      taskbarItem = document.createElement('button');
      taskbarItem.id = `taskbar-${this.currentFile}`;
      taskbarItem.className = 'taskbar-item';
      taskbarItem.innerHTML = `
        <span class="taskbar-filename">${path.basename(this.currentFile || 'Untitled')}</span>
        ${this.isModified ? '<span class="taskbar-modified">●</span>' : ''}
      `;
      taskbarItem.addEventListener('click', () => this.restore());
      taskbarItems.appendChild(taskbarItem);
    }
  }

  restore() {
    const dialog = document.getElementById('editor-dialog');
    dialog.style.display = 'block';
    this.isMinimized = false;
    
    // Remove taskbar item
    const taskbarItem = document.getElementById(`taskbar-${this.currentFile}`);
    if (taskbarItem) {
      taskbarItem.remove();
    }
    
    // Hide taskbar if no items left
    const taskbarItems = document.getElementById('taskbar-items');
    if (taskbarItems.children.length === 0) {
      document.getElementById('editor-taskbar').style.display = 'none';
    }
    
    // Refresh editor
    if (this.editor) {
      setTimeout(() => {
        this.editor.refresh();
        this.editor.focus();
      }, 100);
    }
  }

  maximize() {
    const dialog = document.getElementById('editor-dialog');
    const maximizeBtn = document.getElementById('btn-editor-maximize');
    
    if (this.isMaximized) {
      // Restore to previous size
      if (this.previousPosition) {
        dialog.style.left = this.previousPosition.left;
        dialog.style.top = this.previousPosition.top;
        dialog.style.width = this.previousPosition.width;
        dialog.style.height = this.previousPosition.height;
      }
      maximizeBtn.textContent = '□';
      this.isMaximized = false;
    } else {
      // Save current position
      this.previousPosition = {
        left: dialog.style.left,
        top: dialog.style.top,
        width: dialog.style.width,
        height: dialog.style.height
      };
      
      // Maximize
      dialog.style.left = '0';
      dialog.style.top = '0';
      dialog.style.width = '100%';
      dialog.style.height = '100%';
      maximizeBtn.textContent = '◻';
      this.isMaximized = true;
    }
    
    // Refresh editor
    if (this.editor) {
      setTimeout(() => {
        this.editor.refresh();
      }, 100);
    }
  }

  showStatus(message, type = 'info') {
    const status = document.getElementById('editor-status');
    status.textContent = message;
    status.className = `editor-status ${type}`;
    status.style.display = 'block';
    
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }
}

module.exports = { CodeEditor };