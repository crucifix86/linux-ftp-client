const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class BookmarksManager {
  constructor() {
    this.store = new Store({
      name: 'bookmarks',
      defaults: {
        localBookmarks: [],
        remoteBookmarks: []
      }
    });
  }

  getLocalBookmarks() {
    return this.store.get('localBookmarks', []);
  }

  getRemoteBookmarks() {
    return this.store.get('remoteBookmarks', []);
  }

  addLocalBookmark(bookmark) {
    const bookmarks = this.getLocalBookmarks();
    const newBookmark = {
      id: uuidv4(),
      name: bookmark.name || path.basename(bookmark.path) || 'Root',
      path: bookmark.path,
      createdAt: new Date().toISOString()
    };
    
    // Check if bookmark already exists
    const exists = bookmarks.some(b => b.path === newBookmark.path);
    if (!exists) {
      bookmarks.push(newBookmark);
      this.store.set('localBookmarks', bookmarks);
    }
    
    return newBookmark;
  }

  addRemoteBookmark(bookmark) {
    const bookmarks = this.getRemoteBookmarks();
    const newBookmark = {
      id: uuidv4(),
      name: bookmark.name || path.basename(bookmark.path) || 'Root',
      path: bookmark.path,
      host: bookmark.host,
      createdAt: new Date().toISOString()
    };
    
    // Check if bookmark already exists for this host
    const exists = bookmarks.some(b => b.path === newBookmark.path && b.host === newBookmark.host);
    if (!exists) {
      bookmarks.push(newBookmark);
      this.store.set('remoteBookmarks', bookmarks);
    }
    
    return newBookmark;
  }

  deleteLocalBookmark(id) {
    const bookmarks = this.getLocalBookmarks();
    const filtered = bookmarks.filter(b => b.id !== id);
    this.store.set('localBookmarks', filtered);
  }

  deleteRemoteBookmark(id) {
    const bookmarks = this.getRemoteBookmarks();
    const filtered = bookmarks.filter(b => b.id !== id);
    this.store.set('remoteBookmarks', filtered);
  }

  renameBookmark(id, newName, isRemote = false) {
    const key = isRemote ? 'remoteBookmarks' : 'localBookmarks';
    const bookmarks = this.store.get(key, []);
    const bookmark = bookmarks.find(b => b.id === id);
    
    if (bookmark) {
      bookmark.name = newName;
      this.store.set(key, bookmarks);
    }
    
    return bookmark;
  }
}

module.exports = { BookmarksManager };