import { joinRoom } from "https://unpkg.com/trystero?module";

export default class Engine {
  constructor(roomName, config = { appId: "wf" }) {
    // ---- internal state ----
    this.roomName = roomName;
    this.config = config;
    this.myProfile = {};
    this.peers = new Map();        // peerId -> { profile: {...} }
    this.currentLocation = null;   // { lat, lon, accuracy, timestamp }

    // ---- connect ----
    this.room = joinRoom(this.config, this.roomName);

    const [sendProfile, onProfile] = this.room.makeAction("profile");
    this.sendProfile = sendProfile;

    this.room.onPeerJoin((peerId) => {
      this.peers.set(peerId, { profile: {} });

      if (Object.keys(this.myProfile).length > 0) {
        this.sendProfile(this.myProfile, peerId);
      }
    });

    this.room.onPeerLeave((peerId) => {
      this.peers.delete(peerId);
    });

    onProfile((profile, peerId) => {
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { profile: {} });
      }
      this.peers.get(peerId).profile = profile;
    });
  }

  // --------------------------------------------------------
  // 🛰️ LOCATION HANDLING
  // --------------------------------------------------------

  async requestLocationPermission() {
    if (!("geolocation" in navigator)) return false;

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
        () => {
          this.currentLocation = null;
          resolve(false);
        },
        { enableHighAccuracy: true }
      );
    });
  }

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
  // 📐 DISTANCE HELPERS
  // --------------------------------------------------------

  _deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Haversine distance in km between (lat1, lon1) and (lat2, lon2)
   */
  _distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius km
    const dLat = this._deg2rad(lat2 - lat1);
    const dLon = this._deg2rad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this._deg2rad(lat1)) *
        Math.cos(this._deg2rad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --------------------------------------------------------
  // 🧪 PROFILE FUNCTIONS
  // --------------------------------------------------------

  async setProfile(profileObj) {
    this.myProfile = { ...this.myProfile, ...profileObj };

    await this._updateLocation();

    this.myProfile.location = this.currentLocation;

    this.sendProfile(this.myProfile);
  }

  /**
   * Returns:
   * [
   *   {
   *     id: "...",
   *     profile: {...metadata without location...},
   *     distance: "1.2 km" or "Somewhere"
   *   }
   * ]
   */
  getPeers() {
    const myLoc = this.currentLocation;

    return [...this.peers.entries()].map(([id, { profile }]) => {
      const { location, ...rest } = profile; // strip GPS from payload

      let distance = "Somewhere";

      if (myLoc && location) {
        const km = this._distanceKm(
          myLoc.lat,
          myLoc.lon,
          location.lat,
          location.lon
        );

        if (isFinite(km)) {
          distance =
            km < 1
              ? `${(km * 1000).toFixed(0)} m`
              : `${km.toFixed(2)} km`;
        }
      }

      return {
        id,
        profile: rest,
        distance,
      };
    });
  }

  getMyProfile() {
    return this.myProfile;
  }
}
