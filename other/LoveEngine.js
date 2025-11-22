import { joinRoom } from 'https://unpkg.com/trystero?module';

export default class LoveEngine {
  constructor(config, roomName) {
    this.roomName = roomName;
    this.config = config;
    this.me = {};
    this._peers = {};
    this.room = joinRoom(this.config, this.roomName);
    let [sendProfile, onProfile] = this.room.makeAction("profile");
    this.room.onPeerJoin(id => {
      this._peers[id] = {};
      if (Object.keys(this.me).length > 0) sendProfile(this.me, id);
    });
    this.room.onPeerLeave(id => { delete this._peers[id]; d.update() });
    onProfile((profile, id) => { this._peers[id] = { id: null, ...profile, id }; d.update() });
    this.beacon = setInterval(() => sendProfile(this.me), 2000);
  }
  get peers() { return [...Object.values(this._peers)] }
  stop() { clearInterval(this.beacon) }
};
