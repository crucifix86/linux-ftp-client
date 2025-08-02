# Linux FTP Client - Project Notes

## Overview
A WinSCP-like FTP/SFTP client for Linux with integrated terminal support, built with Electron.

## Key Features Implemented

### 1. Connection Management
- **Multi-protocol support**: FTP, FTPS, SFTP
- **Connection profiles**: Save/load with encrypted password storage
- **Authentication methods**: Password and SSH key authentication
- **Connection status**: Real-time status updates
- **Multi-tab support**: Connect to multiple servers simultaneously

### 2. File Management
- **Dual-pane interface**: Local and remote file browsers
- **Navigation**: Double-click to open folders (prevents accidental navigation)
- **File selection**: Single-click to select files
- **File search**: Real-time filtering in both panels
- **Right-click context menus**:
  - Upload/Download (files and folders)
  - Rename
  - Delete (with confirmation)
  - Permissions (SFTP only)
  - Refresh

### 3. File Transfer
- **Transfer Queue**: Advanced queue management system
  - Pause/resume individual transfers
  - Global pause/resume all
  - Progress tracking with speed
  - Concurrent transfers (up to 3)
  - Error handling and retry
- **Upload/Download**: Via buttons, drag & drop, or context menu
- **Recursive operations**: Upload/download entire folder structures
- **Drag & Drop support**:
  - Internal: Drag from local panel to remote panel
  - External: Drag files/folders from file manager
  - Visual feedback with highlighting

### 4. Terminal Integration
- **Automatic terminal**: Opens for SFTP connections
- **SSH shell**: Direct shell access through ssh2 library
- **Terminal reconnect**: Button to reconnect dropped sessions
- **Integrated xterm.js**: Full terminal emulator in the app

### 5. Permissions Management (SFTP only)
- **Visual editor**: Checkboxes for Owner/Group/Other permissions
- **Octal notation**: Direct input and display
- **Live updates**: Changes between checkboxes and octal are synchronized

### 6. Multi-Tab Interface
- **Tab management**: Create, switch, close tabs
- **Independent sessions**: Each tab maintains its own connection
- **Keyboard shortcuts**: 
  - Ctrl/Cmd+T: New tab
  - Ctrl/Cmd+W: Close tab
  - Ctrl/Cmd+Tab: Next tab
  - Ctrl/Cmd+Shift+Tab: Previous tab
  - Ctrl/Cmd+1-9: Switch to specific tab
- **Visual indicators**: Active tab highlighting, hover effects

### 7. Search Functionality
- **Real-time search**: Filter files as you type
- **Case-insensitive**: Searches match any case
- **Clear button**: Quick reset of search
- **Status updates**: Shows match count
- **Auto-clear**: Resets when changing directories

## Technical Architecture

### Main Process (`src/main/`)
- `index.js`: Electron main process, IPC handlers
- `connectionManager.js`: Handles FTP/SFTP connections
- `profileManager.js`: Manages saved connection profiles
- `menu.js`: Application menu structure

### Renderer Process (`src/renderer/`)
- `index.html`: UI structure with modals for connections and permissions
- `styles.css`: Dark theme styling
- `renderer.js`: UI logic, event handling, file operations

### Dependencies
- **electron**: Desktop application framework
- **ssh2**: SFTP/SSH connections
- **basic-ftp**: FTP/FTPS connections
- **xterm**: Terminal emulator
- **electron-store**: Encrypted profile storage
- **uuid**: Connection ID generation

## Security Considerations
- Content Security Policy implemented
- Password encryption for saved profiles
- No sandbox mode for terminal functionality
- Secure connection handling

## Known Limitations
1. Terminal only works with SFTP connections (not FTP)
2. Permissions management only for SFTP
3. No recursive directory operations
4. No file preview functionality

## Usage Tips
1. **Double-click** folders to navigate (single-click only selects)
2. **Drag files** from local to remote panel for quick upload
3. **Right-click** for context menu options
4. **Save profiles** with "Save as" field when connecting
5. **Test connection** button helps diagnose issues

## Development Commands
```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Run normally
npm start

# Lint code
npm run lint

# Build distributable
npm run build
```

## File Structure
```
linux-ftp-client/
├── src/
│   ├── main/           # Main process files
│   ├── renderer/       # UI files
│   └── shared/         # Shared utilities (if any)
├── assets/             # Icons and images
├── node_modules/       # Dependencies
├── package.json        # Project configuration
├── README.md          # User documentation
└── PROJECT_NOTES.md   # This file
```

## Future Enhancement Ideas
- File search functionality
- Multiple simultaneous connections
- Transfer queue management
- File synchronization
- SSH key generation
- Theme customization
- File preview (images, text)
- Bookmark/favorite folders
- Transfer speed limiting
- Recursive operations
- File compression before transfer

## Debugging Tips
1. Open DevTools with F12
2. Check console for connection details
3. All operations log to console
4. Status bar shows current operation
5. Test button for connection diagnostics

## Recent Updates (Latest Session)
1. **Terminal Reconnect Button**: Added refresh button to reconnect dropped SSH sessions
2. **File Search**: Implemented real-time search in both local and remote panels
3. **Transfer Queue**: Complete queue system with pause/resume, progress tracking
4. **Multi-Tab Support**: Full tabbed interface with keyboard shortcuts
5. **Recursive Operations**: Upload/download entire folder structures
6. **File Preview**: Quick preview for images and text files with right-click menu
7. **Directory Sync**: Compare and sync local/remote directories with preview
8. **Bookmarks**: Save and manage favorite local/remote paths with quick navigation
9. **Quick Connect**: Dropdown with recent connections in connection dialog
10. **Keyboard Shortcuts**: F5 refresh, Del delete, F2 rename, Enter navigate, and more
11. **File Filtering & Sorting**: Filter by type/extension/size, sort by name/size/date
12. **SSH Key Management**: Generate Ed25519/RSA keys, view fingerprints, copy public keys
13. **File Compression**: Compress files/folders before upload (gzip for files, tar.gz for folders)
14. **Tabbed Bottom Panel**: Separate tabs for Terminal and Transfer Queue to avoid UI conflicts
15. **Transfer Speed Limiting**: Set bandwidth limits globally or per-connection (KB/s or MB/s)
16. **Custom Themes & Appearance**: Multiple color themes (Light, Dark, Blue, Monokai, Solarized, Custom), font customization, compact mode
17. **Activity Log Panel**: Complete transfer history with timestamps, file details, speeds, and export functionality
18. **Timestamp Preservation**: Option to maintain original file modification times during transfers
19. **Code Editor**: Built-in editor with encoding preservation, syntax highlighting, and support for multiple file encodings

## Completed Features (All Features Implemented!)
- ✅ Basic FTP/SFTP client functionality
- ✅ Dual-pane file browser
- ✅ Integrated terminal
- ✅ Connection profiles
- ✅ Drag & drop transfers
- ✅ Right-click context menus
- ✅ File permissions management
- ✅ Terminal reconnect button
- ✅ File search functionality
- ✅ Transfer queue with pause/resume
- ✅ Multi-tab support
- ✅ Recursive directory operations
- ✅ File preview (images and text)
- ✅ Directory synchronization
- ✅ Bookmarks/favorites system
- ✅ Quick connect dropdown
- ✅ Comprehensive keyboard shortcuts
- ✅ Advanced file filtering and sorting
- ✅ SSH Key Management (generate, view, delete keys)
- ✅ File Compression before transfer
- ✅ Transfer Speed Limiting (bandwidth control)
- ✅ Custom Themes and Appearance Settings
- ✅ Activity Log with Transfer History
- ✅ Timestamp Preservation for File Transfers
- ✅ Code Editor with Encoding Preservation

## Keyboard Shortcuts
- **F1**: Show keyboard shortcuts help
- **F5**: Refresh directories
- **Delete**: Delete selected file
- **F2**: Rename selected file
- **Enter**: Open selected folder
- **Ctrl/Cmd + K**: Focus search
- **Ctrl/Cmd + U**: Upload selected file
- **Ctrl/Cmd + Shift + D**: Download selected file
- **Ctrl/Cmd + D**: Toggle bookmarks
- **Ctrl/Cmd + Q**: Toggle transfer queue
- **Ctrl/Cmd + T**: New tab
- **Ctrl/Cmd + W**: Close tab
- **Escape**: Close dialogs

## Project State
- **All planned features completed!** 🎉
- App is fully functional with advanced features
- Professional FTP/SFTP client with all modern conveniences
- Code is well-structured with separate managers for tabs, transfers, connections, themes, and logging