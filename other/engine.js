import { joinRoom } from "https://unpkg.com/trystero?module";

export default class Engine {
  constructor(roomName, config = { appId: "wf" }) {
    // ---- internal state ----
    this.roomName = roomName;
    this.config = config;
    this.myProfile = {};
    this.peers = new Map();   // peerId -> { profile: {...} }

    // ---- connect ----
    this.room = joinRoom(this.config, this.roomName);

    // messaging channel for profile exchange
    const [sendProfile, onProfile] = this.room.makeAction("profile");
    this.sendProfile = sendProfile;

    // ---- peer join ----
    this.room.onPeerJoin((peerId) => {
      this.peers.set(peerId, { profile: {} });

      // send our current profile to the newcomer
      if (Object.keys(this.myProfile).length > 0) {
        this.sendProfile(this.myProfile, peerId);
      }
    });

    // ---- peer leave ----
    this.room.onPeerLeave((peerId) => {
      this.peers.delete(peerId);
    });

    // ---- receiving metadata ----
    onProfile((profile, peerId) => {
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { profile: {} });
      }
      this.peers.get(peerId).profile = profile;
    });
  }

  /**
   * Merge new metadata into your profile and broadcast to all peers.
   */
  setProfile(profileObj) {
    this.myProfile = { ...this.myProfile, ...profileObj };
    this.sendProfile(this.myProfile);
  }

  /**
   * Return an array of peers and their metadata.
   * [{ id, profile }, ...]
   */
  getPeers() {
    return [...this.peers.entries()].map(([id, { profile }]) => ({
      id,
      profile,
    }));
  }

  /**
   * Optionally get your own profile.
   */
  getMyProfile() {
    return this.myProfile;
  }
};
