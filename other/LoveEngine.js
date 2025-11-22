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
    this.counterTimeoutMs = 25000;
    this.room = joinRoom(this.config, this.roomName);
    this._messageHandlers = new Set();
    let [sendProfile, onProfile] = this.room.makeAction("profile");
    let [sendMessage, onMessage] = this.room.makeAction("message");
    this.room.onPeerJoin(id => {
      this._peers[id] = { _counterLastChangedAt: Date.now(), _counterLastValue: null };
      if (Object.keys(this.me).length > 0) sendProfile(this.me, id);
    });
    this.room.onPeerLeave(id => {
      let peer = this._peers[id];
      delete this._peers[id];
      if (peer) {
        let deviceId = peer._activityDeviceId || peer.devid;
        if (deviceId) {
          let stillPresent = Object.values(this._peers).some(other => other && (other._activityDeviceId || other.devid) === deviceId);
          if (!stillPresent) delete this._deviceActivity[deviceId];
        }
      }
      d.update();
    });
    onProfile((profile, id) => {
      let safeProfile = profile && typeof profile === 'object' ? profile : {};
      let existing = this._peers[id] || {};
      let nextCounter = Number(safeProfile.counter) || 0;
      let deviceId = safeProfile.devid || id;
      let activity = this._deviceActivity[deviceId] || { value: null, updatedAt: Date.now() };
      if (activity.value !== nextCounter) {
        activity = { value: nextCounter, updatedAt: Date.now() };
      }
      this._deviceActivity[deviceId] = activity;
      let lastChangedAt = activity.updatedAt;
      this._peers[id] = {
        id: null,
        ...safeProfile,
        counter: nextCounter,
        id,
        _counterLastValue: activity.value,
        _counterLastChangedAt: lastChangedAt,
        _activityDeviceId: deviceId,
      };
      d.update();
    });
    this.sendDirectMessage = (message, id) => sendMessage(message, id);
    onMessage((payload, id) => {
      this._messageHandlers.forEach(handler => handler(payload, id));
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
    Object.keys(this._peers).forEach(id => {
      let peer = this._peers[id];
      if (!peer) return;
      let deviceId = peer._activityDeviceId || peer.devid || id;
      let activity = deviceId ? this._deviceActivity[deviceId] : null;
      let lastChangedAt = activity ? activity.updatedAt : (peer._counterLastChangedAt || 0);
      if (now - lastChangedAt > this.counterTimeoutMs) {
        delete this._peers[id];
        if (deviceId) {
          let stillPresent = Object.values(this._peers).some(other => other && (other._activityDeviceId || other.devid || other.id) === deviceId);
          if (!stillPresent) delete this._deviceActivity[deviceId];
        }
        d.update();
      }
    });
  }
  stop() {
    clearInterval(this.beacon);
    if (this.peerSweepInterval) clearInterval(this.peerSweepInterval);
  }
};
