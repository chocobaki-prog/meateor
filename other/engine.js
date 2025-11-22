import { joinRoom } from "https://unpkg.com/trystero?module";

export default class Engine {
  constructor(roomName, config = { appId: "wf" }) {
    // ---- internal state ----
    this.roomName = roomName;
    this.config = config;
    this.myProfile = {};
    this.peers = new Map();       // peerId -> { profile: {...} }

    // cached location (null until available)
    this.currentLocation = null;

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

  // --------------------------------------------------------
  // 🛰️ LOCATION FUNCTIONS
  // --------------------------------------------------------

  /**
   * Ask browser for geolocation permission.
   * Returns true on success, false if denied or unavailable.
   */
  async requestLocationPermission() {
    if (!("geolocation" in navigator)) {
      console.warn("Geolocation is not available in this browser/environment.");
      return false;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentLocation = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp
          };
          resolve(true);
        },
        (err) => {
          console.warn("Location permission denied:", err);
          this.currentLocation = null;
          resolve(false);
        },
        { enableHighAccuracy: true }
      );
    });
  }

  /**
   * Internal helper to fetch fresh GPS data right before sending profile.
   */
  async _updateLocation() {
    if (!("geolocation" in navigator)) {
      this.currentLocation = null;
      return;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentLocation = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp
          };
          resolve();
        },
        () => {
          this.currentLocation = null;
          resolve();
        },
        { enableHighAccuracy: true }
      );
    });
  }

  // --------------------------------------------------------
  // 🧪 PROFILE FUNCTIONS
  // --------------------------------------------------------

  /**
   * Merge new metadata, attach GPS data, and broadcast.
   */
  async setProfile(profileObj) {
    // merge user-supplied data
    this.myProfile = { ...this.myProfile, ...profileObj };

    // auto-update GPS location
    await this._updateLocation();

    // inject location property
    this.myProfile.location = this.currentLocation || 'Somewhere';

    // broadcast to all peers
    this.sendProfile(this.myProfile);
  }

  /**
   * Get array of peers and their metadata: [{ id, profile }, ...]
   */
  getPeers() {
    return [...this.peers.entries()].map(([id, { profile }]) => ({
      id,
      profile,
    }));
  }

  getMyProfile() {
    return this.myProfile;
  }
}
