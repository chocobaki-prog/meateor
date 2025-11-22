import { joinRoom } from 'https://unpkg.com/trystero?module';

export default class LoveEngine {
  constructor(config, roomName) {
    this.roomName = roomName;
    this.config = config;
    this.me = {};
    this._peers = {};
    this.room = joinRoom(this.config, this.roomName);
    this._messageHandlers = new Set();
    let [sendProfile, onProfile] = this.room.makeAction("profile");
    let [sendMessage, onMessage] = this.room.makeAction("message");
    this.room.onPeerJoin(id => {
      this._peers[id] = {};
      if (Object.keys(this.me).length > 0) sendProfile(this.me, id);
    });
    this.room.onPeerLeave(id => { delete this._peers[id]; d.update() });
    onProfile((profile, id) => { this._peers[id] = { id: null, ...profile, id }; d.update() });
    this.sendDirectMessage = (message, id) => sendMessage(message, id);
    onMessage((payload, id) => {
      this._messageHandlers.forEach(handler => handler(payload, id));
      d.update();
    });
    this.beacon = setInterval(() => {
      sendProfile(this.me);
      localStorage.setItem('meateor:profile', JSON.stringify(this.me));
    }, 2000);
  }
  get peers() { return [...Object.values(this._peers)] }
  onChatMessage(handler) {
    if (!handler) return () => {};
    this._messageHandlers.add(handler);
    let off = () => this._messageHandlers.delete(handler);
    return off;
  }
  stop() { clearInterval(this.beacon) }
};
