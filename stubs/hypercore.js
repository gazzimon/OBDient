'use strict';
// No-op stub for Hypercore — used in the React Native / Hermes bundle.
// File-system access is unavailable in the JS layer of RN.
// replicate() is never called because the Hyperswarm stub never fires
// 'connection' events, so it is safe to return a trivial object here.
class Hypercore {
  constructor() {
    this.key = new Uint8Array(32);
    this.length = 0;
    this.opened = false;
  }
  on() { return this; }
  off() { return this; }
  once() { return this; }
  emit() { return false; }
  async ready() {}
  async append() {}
  async get() { return null; }
  async update() {}
  async close() {}
  replicate() {
    return { pipe: () => ({ pipe: () => {} }), on: () => {}, destroy: () => {} };
  }
  download() { return { done: () => Promise.resolve(), destroy: () => {} }; }
}
module.exports = Hypercore;
