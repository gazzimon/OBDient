'use strict';
// No-op stub for Hyperswarm — used in the React Native / Hermes bundle.
// Net/UDP sockets are unavailable in RN; P2P requires a native Expo module.
class Hyperswarm {
  constructor() { this.connections = new Set(); }
  on() { return this; }
  off() { return this; }
  once() { return this; }
  emit() { return false; }
  join() {}
  leave() {}
  async destroy() {}
  flush() { return Promise.resolve(); }
}
module.exports = Hyperswarm;
