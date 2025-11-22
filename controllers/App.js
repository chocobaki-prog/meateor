export default class App {
  state = {
    userId: '',
    me: {
      displayName: 'You',
      age: 27,
      role: 'Vers',
      tribe: 'Discreet',
      vibe: 'Looking',
      location: '1.2 mi nearby',
      distance: 1.2,
      tagline: 'Tap in, stay hydrated.',
      hashtags: ['Gym', 'Nightlife'],
      lookingFor: 'Chats & meets',
      photoUrl: 'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=600&q=80',
      colorway: 'from-amber-400/40 to-transparent',
      updatedAt: Date.now(),
      coords: null,
    },
    roster: [],
    visibleRoster: [],
    vibeTags: ['Gym', 'Nightlife', 'Travel', 'Sneakers', 'Level-headed', 'Pup'],
    trendingTribes: ['Discreet', 'Jock', 'Bear', 'Twink'],
    filters: {
      tribe: 'all',
      vibe: 'any',
      radius: 5,
    },
    composer: {
      text: '',
    },
    connection: {
      roomId: '',
      status: 'idle',
      peers: 0,
      error: '',
      lastEvent: '',
    },
    lastWave: null,
    geolocation: {
      status: 'idle',
      message: '',
      coords: null,
    },
  };

  constructor() {
    this.room = null;
    this.sendProfile = null;
    this.sendWave = null;
    this.broadcastTimer = null;
    this.beacon = null;
    this.profileStorageKey = 'meat:profile';
    this.storage = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        this.storage = window.localStorage;
      } else if (typeof localStorage !== 'undefined') {
        this.storage = localStorage;
      }
    } catch (err) {
      this.storage = null;
    }
    this.storageAvailable = !!this.storage;
    this.state.userId = this.generateId('meat');
    this.state.connection.roomId = this.pickRoomId();
    this.loadStoredProfile();
    this.state.roster = this.seedRoster();
    this.refreshVisibleRoster();
    this.bootstrapRoom();
    this.startBeacon();
  }

  loadStoredProfile() {
    if (!this.storageAvailable) return;
    try {
      let raw = this.storage.getItem(this.profileStorageKey);
      if (!raw) return;
      let saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        Object.assign(this.state.me, saved);
      }
      if (!Array.isArray(this.state.me.hashtags)) this.state.me.hashtags = [];
      let dist = Number(this.state.me.distance);
      if (!Number.isFinite(dist)) dist = 1.2;
      this.state.me.distance = dist;
      if (!this.state.me.location) {
        this.state.me.location = dist.toFixed(1) + ' mi nearby';
      }
      if (this.state.me.coords) {
        this.state.geolocation.coords = { ...this.state.me.coords };
        this.state.geolocation.status = 'cached';
        this.state.geolocation.message = 'Using saved fix';
      }
    } catch (err) {}
  }

  persistProfile() {
    if (!this.storageAvailable) return;
    try {
      let snapshot = {
        ...this.state.me,
        hashtags: [...(this.state.me.hashtags || [])],
        coords: this.state.me.coords ? { ...this.state.me.coords } : null,
      };
      this.storage.setItem(this.profileStorageKey, JSON.stringify(snapshot));
    } catch (err) {}
  }

  startBeacon() {
    if (this.beacon) clearInterval(this.beacon);
    this.beacon = setInterval(() => this.broadcastProfile(true), 2000);
  }

  applyCoordinates(coords) {
    if (!coords) return;
    this.state.me.coords = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: coords.accuracy,
    };
    this.state.geolocation.coords = { ...this.state.me.coords };
    this.state.me.location = this.describeCoords(this.state.me.coords);
    this.state.me.updatedAt = Date.now();
    this.persistProfile();
    this.scheduleBroadcast();
    this.recalculateRosterDistances();
    this.refreshVisibleRoster();
  }

  describeCoords(coords) {
    if (!coords) return this.state.me.location;
    let lat = coords.lat.toFixed(3);
    let lon = coords.lon.toFixed(3);
    return `~${lat}, ${lon}`;
  }

  actions = {
    updateProfileField: (field, value) => {
      if (!(field in this.state.me)) return;
      this.state.me[field] = value;
      this.state.me.updatedAt = Date.now();
      this.refreshVisibleRoster();
      this.scheduleBroadcast();
      this.persistProfile();
    },
    updateDistance: value => {
      let miles = Number(value) || 0;
      this.state.me.distance = miles;
      this.state.me.location = miles.toFixed(1) + ' mi nearby';
      this.state.me.updatedAt = Date.now();
      this.scheduleBroadcast();
      this.persistProfile();
    },
    toggleVibeTag: tag => {
      if (!tag) return;
      let list = this.state.me.hashtags || [];
      let index = list.indexOf(tag);
      if (index >= 0) {
        list.splice(index, 1);
      } else if (list.length < 4) {
        list.push(tag);
      }
      this.state.me.hashtags = [...list];
      this.state.me.updatedAt = Date.now();
      this.scheduleBroadcast();
      this.persistProfile();
    },
    setFilter: (field, value) => {
      if (!(field in this.state.filters)) return;
      this.state.filters = { ...this.state.filters, [field]: value };
      this.refreshVisibleRoster();
    },
    updateComposer: value => {
      this.state.composer.text = value;
    },
    sendHello: profileId => {
      if (!profileId) return;
      let target = this.state.roster.find(item => item.peerId === profileId || item.userId === profileId);
      if (!target) return;
      let payload = {
        fromName: this.state.me.displayName,
        fromTribe: this.state.me.tribe,
        text: this.state.composer.text || 'Tap in?',
        timestamp: Date.now(),
      };
      try {
        if (this.sendWave) this.sendWave(payload, target.peerId);
        this.state.lastWave = {
          text: 'You pinged ' + (target.displayName || 'someone nearby') + '.',
          tone: 'sent',
          timestamp: Date.now(),
        };
        this.state.composer.text = '';
      } catch (err) {
        this.state.lastWave = {
          text: 'Unable to ping right now.',
          tone: 'error',
          timestamp: Date.now(),
        };
      }
    },
    refreshRoom: () => {
      this.bootstrapRoom(true);
    },
    shufflePhoto: () => {
      let gallery = [
        'https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1528892952291-009c663ce843?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1504253163759-c23fccaebb55?auto=format&fit=crop&w=600&q=80',
      ];
      let pick = gallery[Math.floor(Math.random() * gallery.length)];
      this.state.me.photoUrl = pick;
      this.state.me.updatedAt = Date.now();
      this.scheduleBroadcast();
      this.persistProfile();
    },
    pickPhoto: inputRef => {
      let elementId = typeof inputRef === 'string' ? inputRef : null;
      let file = null;
      if (elementId && typeof document !== 'undefined') {
        let el = document.getElementById(elementId);
        if (el && el.files && el.files[0]) file = el.files[0];
      } else if (inputRef && inputRef.name) {
        file = inputRef;
      }
      if (!file) return;
      if (typeof FileReader === 'undefined') {
        this.state.lastWave = {
          text: 'FileReader missing in this browser',
          tone: 'error',
          timestamp: Date.now(),
        };
        return;
      }
      let reader = new FileReader();
      reader.onload = () => {
        let dataUrl = reader.result;
        if (!dataUrl) return;
        this.state.me.photoUrl = dataUrl;
        this.state.me.updatedAt = Date.now();
        this.persistProfile();
        this.scheduleBroadcast();
      };
      reader.onerror = () => {
        this.state.lastWave = {
          text: 'Photo upload failed',
          tone: 'error',
          timestamp: Date.now(),
        };
      };
      reader.readAsDataURL(file);
      if (elementId && typeof document !== 'undefined') {
        let el = document.getElementById(elementId);
        if (el && el.type === 'file') el.value = '';
      }
    },
    useGeolocation: () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        this.state.geolocation.status = 'error';
        this.state.geolocation.message = 'GPS not supported';
        return;
      }
      this.state.geolocation.status = 'requesting';
      this.state.geolocation.message = 'Locating…';
      navigator.geolocation.getCurrentPosition(
        position => {
          this.state.geolocation.status = 'ok';
          this.state.geolocation.message = 'Location locked';
          this.applyCoordinates(position.coords);
        },
        err => {
          this.state.geolocation.status = 'error';
          this.state.geolocation.message = err && err.message ? err.message : 'GPS denied';
        },
        { enableHighAccuracy: true, timeout: 12000 }
      );
    },
  };

  generateId(prefix) {
    let base = 'xxxxxx'.replace(/x/g, () => ((Math.random() * 36) | 0).toString(36));
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      base = crypto.randomUUID().split('-').slice(-1)[0];
    }
    return prefix + '-' + base;
  }

  pickRoomId() {
    let hash = (typeof location !== 'undefined' && location.hash) ? location.hash.replace('#', '').trim() : '';
    let search = '';
    if (typeof location !== 'undefined') {
      let params = new URLSearchParams(location.search || '');
      search = params.get('room') || '';
    }
    let chosen = hash || search || 'meat-global';
    return chosen.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'meat-global';
  }

  seedRoster() {
    return [];
  }

  refreshVisibleRoster() {
    this.recalculateRosterDistances();
    let tribe = this.state.filters.tribe;
    let vibe = this.state.filters.vibe;
    let within = Number(this.state.filters.radius) || 5;
    let list = this.state.roster.filter(profile => {
      let tribePass = tribe === 'all' || profile.tribe === tribe;
      let vibePass = vibe === 'any' || profile.vibe === vibe;
      let distanceValue = Number(profile.distance);
      let distPass = !Number.isFinite(distanceValue) || distanceValue <= within;
      return tribePass && vibePass && distPass;
    });
    this.state.visibleRoster = list;
    this.state.connection.peers = this.state.roster.filter(item => item.live).length;
  }

  recalculateRosterDistances() {
    if (!this.state.me.coords) return;
    let mine = this.state.me.coords;
    let changed = false;
    let updated = this.state.roster.map(profile => {
      if (!profile.coords) return profile;
      let miles = this.distanceMiles(mine.lat, mine.lon, profile.coords.lat, profile.coords.lon);
      if (!Number.isFinite(miles)) return profile;
      if (Math.abs((profile.distance || 0) - miles) < 0.05) return profile;
      changed = true;
      return { ...profile, distance: miles };
    });
    if (changed) {
      this.state.roster = updated;
    }
  }

  scheduleBroadcast() {
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.broadcastTimer = setTimeout(() => this.broadcastProfile(), 400);
  }

  async bootstrapRoom(force) {
    if (this.room && !force) return;
    if (this.room && force) {
      try {
        this.room.leave();
      } catch (err) {}
      this.room = null;
    }
    this.state.connection.status = 'connecting';
    this.state.connection.error = '';
    try {
      let module = await import('https://unpkg.com/trystero/torrent?module');
      let joinRoom = module.joinRoom;
      if (!joinRoom && module.default) joinRoom = module.default.joinRoom || module.default;
      if (!joinRoom && module.Trystero) joinRoom = module.Trystero.joinRoom;
      if (typeof joinRoom !== 'function') throw new Error('Trystero joinRoom missing');
      let config = {
        appId: 'meat-trystero',
        rtcConfig: {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        },
      };
      let room = joinRoom(config, this.state.connection.roomId);
      this.room = room;
      let profileAction = room.makeAction('profile');
      if (profileAction) {
        this.sendProfile = profileAction[0];
        profileAction[1]((payload, peerId) => this.ingestPeer(peerId, payload));
      }
      let waveAction = room.makeAction('wave');
      if (waveAction) {
        this.sendWave = waveAction[0];
        waveAction[1]((payload) => this.receiveWave(payload));
      }
      if (room.onPeerJoin) {
        room.onPeerJoin(peerId => {
          this.tagConnection('peer joined', peerId);
          this.broadcastProfile(true, peerId);
        });
      }
      if (room.onPeerLeave) {
        room.onPeerLeave(peerId => this.handlePeerLeave(peerId));
      }
      this.state.connection.status = 'connected';
      this.state.connection.lastEvent = 'Connected at ' + new Date().toLocaleTimeString();
      this.broadcastProfile(true);
    } catch (err) {
      this.state.connection.status = 'error';
      this.state.connection.error = err && err.message ? err.message : 'Unable to join MEAT room';
    }
  }

  broadcastProfile(force, peerId) {
    if (!this.sendProfile) return;
    if (!peerId && !force && this.lastProfileAt && Date.now() - this.lastProfileAt < 1500) return;
    let payload = {
      userId: this.state.userId,
      displayName: this.state.me.displayName,
      age: this.state.me.age,
      tribe: this.state.me.tribe,
      vibe: this.state.me.vibe,
      location: this.state.me.location,
      distance: this.state.me.distance,
      tagline: this.state.me.tagline,
      hashtags: this.state.me.hashtags,
      role: this.state.me.role,
      lookingFor: this.state.me.lookingFor,
      photoUrl: this.state.me.photoUrl,
      coords: this.state.me.coords,
      updatedAt: Date.now(),
    };
    try {
      if (peerId) {
        this.sendProfile(payload, peerId);
      } else {
        this.sendProfile(payload);
        this.lastProfileAt = Date.now();
      }
    } catch (err) {
      this.state.connection.error = 'Signal blocked';
    }
  }

  ingestPeer(peerId, payload) {
    if (!payload || payload.userId === this.state.userId) return;
    let roster = this.state.roster.filter(profile => profile.peerId !== peerId && profile.userId !== payload.userId);
    let coords = null;
    if (payload.coords && typeof payload.coords === 'object') {
      let lat = Number(payload.coords.lat);
      let lon = Number(payload.coords.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        coords = { lat, lon };
      }
    }
    let fallbackDistance = Number(payload.distance);
    let entry = {
      ...payload,
      peerId,
      fingerprint: payload.userId || peerId,
      lastSeen: Date.now(),
      live: true,
      coords,
    };
    let derivedDistance = this.distanceFromPeer(coords, fallbackDistance);
    if (derivedDistance != null) entry.distance = derivedDistance;
    roster.unshift(entry);
    this.state.roster = roster.slice(0, 60);
    this.refreshVisibleRoster();
  }

  handlePeerLeave(peerId) {
    let roster = this.state.roster.map(profile => {
      if (profile.peerId === peerId) {
        return { ...profile, live: false };
      }
      return profile;
    });
    this.state.roster = roster;
    this.refreshVisibleRoster();
  }

  tagConnection(text, peerId) {
    this.state.connection.lastEvent = text + ' ' + peerId;
  }

  receiveWave(payload) {
    if (!payload) return;
    let from = payload.fromName || 'MEAT visitor';
    this.state.lastWave = {
      text: from + ' sent: ' + (payload.text || 'hey'),
      tone: 'inbound',
      timestamp: payload.timestamp || Date.now(),
    };
  }

  distanceFromPeer(coords, fallbackDistance) {
    if (coords && this.state.me.coords) {
      let miles = this.distanceMiles(this.state.me.coords.lat, this.state.me.coords.lon, coords.lat, coords.lon);
      if (Number.isFinite(miles)) return miles;
    }
    if (Number.isFinite(fallbackDistance)) return fallbackDistance;
    return null;
  }

  distanceMiles(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
    let R = 3958.8;
    let dLat = this.deg2rad(lat2 - lat1);
    let dLon = this.deg2rad(lon2 - lon1);
    let a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  deg2rad(value) {
    return (value * Math.PI) / 180;
  }
}
