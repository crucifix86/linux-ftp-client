const { Transform } = require('stream');

class SpeedLimiter extends Transform {
  constructor(options = {}) {
    super();
    this.maxBytesPerSecond = options.maxBytesPerSecond || Infinity;
    this.chunkSize = options.chunkSize || 16384; // 16KB chunks
    this.startTime = Date.now();
    this.totalBytes = 0;
    this.lastCheck = Date.now();
  }

  _transform(chunk, encoding, callback) {
    if (this.maxBytesPerSecond === Infinity) {
      // No speed limit, pass through
      this.push(chunk);
      callback();
      return;
    }

    const processChunk = () => {
      const now = Date.now();
      const elapsed = (now - this.startTime) / 1000; // seconds
      const expectedBytes = elapsed * this.maxBytesPerSecond;
      
      if (this.totalBytes + chunk.length <= expectedBytes) {
        // We're within our speed limit
        this.totalBytes += chunk.length;
        this.push(chunk);
        callback();
      } else {
        // We need to wait
        const excessBytes = (this.totalBytes + chunk.length) - expectedBytes;
        const waitTime = (excessBytes / this.maxBytesPerSecond) * 1000; // milliseconds
        
        setTimeout(() => {
          this.totalBytes += chunk.length;
          this.push(chunk);
          callback();
        }, waitTime);
      }
    };

    processChunk();
  }
}

// Store for managing speed limits per connection
class SpeedLimitManager {
  constructor() {
    this.limits = new Map();
  }

  setLimit(connectionId, type, bytesPerSecond) {
    if (!this.limits.has(connectionId)) {
      this.limits.set(connectionId, {});
    }
    this.limits.get(connectionId)[type] = bytesPerSecond;
  }

  getLimit(connectionId, type) {
    const connectionLimits = this.limits.get(connectionId);
    if (!connectionLimits) return Infinity;
    return connectionLimits[type] || Infinity;
  }

  removeConnection(connectionId) {
    this.limits.delete(connectionId);
  }

  setGlobalLimit(type, bytesPerSecond) {
    this.globalLimits = this.globalLimits || {};
    this.globalLimits[type] = bytesPerSecond;
  }

  getEffectiveLimit(connectionId, type) {
    const connectionLimit = this.getLimit(connectionId, type);
    const globalLimit = (this.globalLimits && this.globalLimits[type]) || Infinity;
    return Math.min(connectionLimit, globalLimit);
  }
}

module.exports = { SpeedLimiter, SpeedLimitManager };