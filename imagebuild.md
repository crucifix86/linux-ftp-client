# Building Linux FTP Client AppImage

This guide explains how to build a distributable AppImage for Linux FTP Client that works on all Linux distributions.

## Prerequisites

- Node.js and npm installed
- Linux system with development tools
- wget and git

## Build Steps

### 1. Clean Build Environment

First, ensure no user data is included in the build:

```bash
# Remove any existing user configuration
rm -rf ~/.config/linux-ftp-client
rm -rf ~/.local/share/linux-ftp-client
rm -rf ~/.cache/linux-ftp-client

# Clean previous builds
rm -rf dist/
```

### 2. Build the Application

```bash
npm install
npm run build
```

This creates the application in `dist/linux-unpacked/`.

### 3. Prepare AppImage Directory

```bash
# Create clean build directory
rm -rf /tmp/ftp-clean-build
mkdir -p /tmp/ftp-clean-build
cp -r dist/linux-unpacked/* /tmp/ftp-clean-build/

# Create AppRun script
cat > /tmp/ftp-clean-build/AppRun << 'EOF'
#!/bin/bash
APPDIR="$(dirname "$(readlink -f "$0")")"
cd "$APPDIR"
export LD_LIBRARY_PATH="${APPDIR}/usr/lib:${APPDIR}:${LD_LIBRARY_PATH}"
export PATH="${APPDIR}:${PATH}"
export ELECTRON_NO_SANDBOX=1
export ELECTRON_DISABLE_SANDBOX=1
exec "${APPDIR}/linux-ftp-client" --no-sandbox --disable-gpu-sandbox "$@"
EOF

chmod +x /tmp/ftp-clean-build/AppRun
chmod +x /tmp/ftp-clean-build/linux-ftp-client
```

### 4. Create Desktop Entry

```bash
cat > /tmp/ftp-clean-build/linux-ftp-client.desktop << 'EOF'
[Desktop Entry]
Name=Linux FTP Client
Comment=FTP/SFTP Client
Exec=AppRun %U
Icon=linux-ftp-client
Type=Application
Categories=Network;FileTransfer;
Terminal=false
EOF

# Add icon (create placeholder if needed)
touch /tmp/ftp-clean-build/linux-ftp-client.png
```

### 5. Download AppImageTool

```bash
# Download latest appimagetool
wget https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage
```

### 6. Build the AppImage

```bash
# Build with static runtime (no libfuse dependency)
ARCH=x86_64 ./appimagetool-x86_64.AppImage --appimage-extract-and-run \
    /tmp/ftp-clean-build \
    LinuxFTPClient.AppImage
```

## Important Notes

- The AppImage uses a **static runtime** that works with both libfuse2 and libfuse3
- It includes `--no-sandbox` flag to prevent Electron sandbox issues
- Always build from a clean environment to avoid including personal data
- The resulting AppImage is completely portable and works on any Linux distribution

## Testing

Test the AppImage on different systems:

```bash
# Make executable
chmod +x LinuxFTPClient.AppImage

# Run from terminal
./LinuxFTPClient.AppImage

# Or copy to Desktop and use a .desktop launcher for GUI launching
```

## Distribution

The AppImage is self-contained and can be distributed directly. Users only need to:
1. Download the AppImage
2. Make it executable: `chmod +x LinuxFTPClient.AppImage`
3. Run it

No installation or dependencies required!