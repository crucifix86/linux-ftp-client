const Store = require('electron-store');
const crypto = require('crypto');

class ProfileManager {
  constructor() {
    this.store = new Store({
      name: 'connection-profiles',
      encryptionKey: 'linux-ftp-client-encryption-key'
    });
  }

  saveProfile(profile) {
    const profiles = this.getProfiles();
    const id = profile.id || crypto.randomBytes(16).toString('hex');
    
    console.log('Saving profile:', profile);
    
    const profileToSave = {
      id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.authType || 'password',
      savePassword: profile.savePassword || false,
      lastUsed: new Date().toISOString()
    };
    
    // Always save the password if savePassword is true, even if it's empty
    if (profile.savePassword) {
      if (profile.password) {
        profileToSave.password = this.encryptPassword(profile.password);
        console.log('Password encrypted and saved');
      } else {
        console.warn('Save password is true but no password provided');
      }
    }
    
    console.log('Profile to save:', { ...profileToSave, password: profileToSave.password ? '***' : 'none' });
    
    profiles[id] = profileToSave;
    this.store.set('profiles', profiles);
    
    return id;
  }

  getProfiles() {
    return this.store.get('profiles', {});
  }

  getProfile(id) {
    const profiles = this.getProfiles();
    const profile = profiles[id];
    
    console.log('Loading profile:', id);
    console.log('Profile data before decryption:', JSON.stringify(profile, null, 2));
    
    if (profile && profile.password) {
      try {
        profile.password = this.decryptPassword(profile.password);
        console.log('Password decrypted successfully');
      } catch (error) {
        console.error('Failed to decrypt password:', error);
        // Remove corrupted password
        delete profile.password;
      }
    }
    
    // Ensure authType is set
    if (profile && !profile.authType) {
      profile.authType = 'password';
    }
    
    console.log('Profile data after processing:', { ...profile, password: profile.password ? '***' : undefined });
    
    return profile;
  }

  deleteProfile(id) {
    const profiles = this.getProfiles();
    delete profiles[id];
    this.store.set('profiles', profiles);
  }

  updateLastUsed(id) {
    const profiles = this.getProfiles();
    if (profiles[id]) {
      profiles[id].lastUsed = new Date().toISOString();
      this.store.set('profiles', profiles);
    }
  }

  encryptPassword(password) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync('linux-ftp-client-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      authTag: authTag.toString('hex'),
      iv: iv.toString('hex')
    };
  }

  decryptPassword(encryptedData) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync('linux-ftp-client-key', 'salt', 32);
    const decipher = crypto.createDecipheriv(
      algorithm,
      key,
      Buffer.from(encryptedData.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  getRecentProfiles(limit = 5) {
    const profiles = this.getProfiles();
    return Object.values(profiles)
      .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
      .slice(0, limit)
      .map(profile => {
        if (profile.password) {
          delete profile.password;
        }
        return profile;
      });
  }
}

module.exports = { ProfileManager };