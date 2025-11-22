import { joinRoom } from 'https://unpkg.com/trystero?module';

export default class LoveEngine {
  constructor(config, roomName) {
    this.devid = localStorage.getItem('meateor:devid') || crypto.randomUUID();
    localStorage.setItem('meateor:devid', this.devid);
    this.roomName = roomName;
    this.config = config;
    this.me = { devid: this.devid, counter: 0 };
    this._peers = {};
    this._deviceActivity = {};
    this._connections = {};
    this._connectionLookup = {};
    this.counterTimeoutMs = 25000;
    this.room = joinRoom(this.config, this.roomName);
    this._messageHandlers = new Set();
    let [sendProfile, onProfile] = this.room.makeAction("profile");
    let [sendMessage, onMessage] = this.room.makeAction("message");
    this.room.onPeerJoin(id => {
      this._connectionLookup[id] = null;
      if (Object.keys(this.me).length > 0) sendProfile(this.me, id);
    });
    this.room.onPeerLeave(id => {
      let deviceId = this._connectionLookup[id];
      delete this._connectionLookup[id];
      if (deviceId) {
        this._connections[deviceId] = null;
        let peer = this._peers[deviceId];
        if (peer) {
          peer.connectionId = null;
          peer.offline = true;
          peer.lastSeen = Date.now();
        }
      }
      d.update();
    });
    onProfile((profile, id) => {
      let safeProfile = profile && typeof profile === 'object' ? profile : {};
      let deviceId = safeProfile.devid || id;
      let nextCounter = Number(safeProfile.counter) || 0;
      let timestamp = Date.now();
      let activity = this._deviceActivity[deviceId] || { value: null, updatedAt: timestamp };
      if (activity.value !== nextCounter) activity = { value: nextCounter, updatedAt: timestamp };
      this._deviceActivity[deviceId] = activity;
      let previousConnection = this._connections[deviceId];
      if (previousConnection && previousConnection !== id) delete this._connectionLookup[previousConnection];
      this._connections[deviceId] = id;
      this._connectionLookup[id] = deviceId;
      let existing = this._peers[deviceId] || {};
      this._peers[deviceId] = {
        ...existing,
        ...safeProfile,
        id: deviceId,
        devid: deviceId,
        connectionId: id,
        offline: false,
        counter: nextCounter,
        lastSeen: activity.updatedAt,
      };
      d.update();
    });
    this.sendDirectMessage = (message, deviceId) => {
      let connectionId = this._connections[deviceId];
      if (!connectionId) return false;
      sendMessage(message, connectionId);
      return true;
    };
    onMessage((payload, id) => {
      let deviceId = this._connectionLookup[id];
      if (!deviceId) return;
      this._messageHandlers.forEach(handler => handler(payload, deviceId));
      d.update();
    });
    this.beacon = setInterval(() => {
      sendProfile(this.me);
      localStorage.setItem('meateor:profile', JSON.stringify(this.me));
    }, 2000);
    this.peerSweepInterval = setInterval(() => this.pruneStalePeers(), 3000);
  }
  get peers() { return [...Object.values(this._peers)] }
  onChatMessage(handler) {
    if (!handler) return () => {};
    this._messageHandlers.add(handler);
    let off = () => this._messageHandlers.delete(handler);
    return off;
  }
  pruneStalePeers() {
    let now = Date.now();
    let changed = false;
    Object.keys(this._peers).forEach(deviceId => {
      let peer = this._peers[deviceId];
      if (!peer) return;
      let activity = this._deviceActivity[deviceId];
      let lastChangedAt = activity ? activity.updatedAt : peer.lastSeen || 0;
      if (now - lastChangedAt > this.counterTimeoutMs) {
        if (!peer.offline || peer.connectionId) {
          peer.offline = true;
          peer.connectionId = null;
          peer.lastSeen = lastChangedAt;
          changed = true;
        }
      }
    });
    if (changed) d.update();
  }
  stop() {
    clearInterval(this.beacon);
    if (this.peerSweepInterval) clearInterval(this.peerSweepInterval);
  }
};
