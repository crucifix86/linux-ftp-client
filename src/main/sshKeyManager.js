const { generateKeyPair } = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const Store = require('electron-store');
const { promisify } = require('util');
const generateKeyPairAsync = promisify(generateKeyPair);
const crypto = require('crypto');

class SSHKeyManager {
  constructor() {
    this.sshDir = path.join(os.homedir(), '.ssh');
    this.store = new Store({
      name: 'ssh-keys',
      defaults: {
        keys: []
      }
    });
  }

  async ensureSSHDirectory() {
    try {
      await fs.mkdir(this.sshDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      console.error('Error creating SSH directory:', error);
    }
  }

  async generateKey(options) {
    const { name, type, passphrase, comment } = options;
    
    await this.ensureSSHDirectory();
    
    const keyPath = path.join(this.sshDir, name);
    const publicKeyPath = `${keyPath}.pub`;
    
    // Check if key already exists
    try {
      await fs.access(keyPath);
      throw new Error(`Key ${name} already exists`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    let keyOptions = {
      modulusLength: type === 'rsa-4096' ? 4096 : 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    };
    
    if (passphrase) {
      keyOptions.privateKeyEncoding.cipher = 'aes-256-cbc';
      keyOptions.privateKeyEncoding.passphrase = passphrase;
    }
    
    try {
      let privateKey, publicKey;
      
      if (type === 'ed25519') {
        // For Ed25519, we need to use a different approach
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const commentArg = comment ? `-C "${comment}"` : '';
        const passphraseArg = passphrase ? `-N "${passphrase}"` : '-N ""';
        
        const command = `ssh-keygen -t ed25519 -f "${keyPath}" ${passphraseArg} ${commentArg} -q`;
        
        await execAsync(command);
        
        privateKey = await fs.readFile(keyPath, 'utf8');
        publicKey = await fs.readFile(publicKeyPath, 'utf8');
      } else {
        // RSA key generation
        const { publicKey: pubKey, privateKey: privKey } = await generateKeyPairAsync('rsa', keyOptions);
        
        // Convert to OpenSSH format
        const sshPublicKey = this.convertToOpenSSHFormat(pubKey, comment || `${name}@${os.hostname()}`);
        
        privateKey = privKey;
        publicKey = sshPublicKey;
        
        // Write keys to files
        await fs.writeFile(keyPath, privateKey, { mode: 0o600 });
        await fs.writeFile(publicKeyPath, publicKey, { mode: 0o644 });
      }
      
      // Calculate fingerprint
      const fingerprint = this.calculateFingerprint(publicKey);
      
      // Store key metadata
      const keyInfo = {
        id: crypto.randomBytes(16).toString('hex'),
        name,
        type: type === 'rsa-4096' ? 'RSA 4096' : type === 'ed25519' ? 'Ed25519' : 'RSA 2048',
        path: keyPath,
        publicPath: publicKeyPath,
        fingerprint,
        createdAt: new Date().toISOString(),
        hasPassphrase: !!passphrase
      };
      
      const keys = this.store.get('keys', []);
      keys.push(keyInfo);
      this.store.set('keys', keys);
      
      return {
        ...keyInfo,
        publicKey
      };
    } catch (error) {
      // Clean up if key generation failed
      try {
        await fs.unlink(keyPath);
        await fs.unlink(publicKeyPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  convertToOpenSSHFormat(pemPublicKey, comment) {
    // This is a simplified conversion - in production, you'd want to use a proper library
    const keyData = pemPublicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    
    return `ssh-rsa ${keyData} ${comment}`;
  }

  calculateFingerprint(publicKey) {
    // Calculate SHA256 fingerprint
    const keyData = publicKey.split(' ')[1];
    const buffer = Buffer.from(keyData, 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('base64');
    return `SHA256:${hash.replace(/=/g, '')}`;
  }

  async listKeys() {
    const keys = this.store.get('keys', []);
    const validKeys = [];
    
    for (const key of keys) {
      try {
        // Check if key files still exist
        await fs.access(key.path);
        await fs.access(key.publicPath);
        
        // Read public key
        const publicKey = await fs.readFile(key.publicPath, 'utf8');
        
        validKeys.push({
          ...key,
          publicKey
        });
      } catch (error) {
        // Key files don't exist, skip
        console.warn(`Key ${key.name} not found on disk`);
      }
    }
    
    // Update store with only valid keys
    this.store.set('keys', validKeys.map(({ publicKey, ...key }) => key));
    
    return validKeys;
  }

  async deleteKey(keyId) {
    const keys = this.store.get('keys', []);
    const keyIndex = keys.findIndex(k => k.id === keyId);
    
    if (keyIndex === -1) {
      throw new Error('Key not found');
    }
    
    const key = keys[keyIndex];
    
    try {
      // Delete key files
      await fs.unlink(key.path);
      await fs.unlink(key.publicPath);
    } catch (error) {
      console.warn('Error deleting key files:', error);
    }
    
    // Remove from store
    keys.splice(keyIndex, 1);
    this.store.set('keys', keys);
    
    return true;
  }

  async getPublicKey(keyId) {
    const keys = this.store.get('keys', []);
    const key = keys.find(k => k.id === keyId);
    
    if (!key) {
      throw new Error('Key not found');
    }
    
    return await fs.readFile(key.publicPath, 'utf8');
  }
}

module.exports = { SSHKeyManager };