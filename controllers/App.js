import LoveEngine from '../other/LoveEngine.js';
import RadarEngine from '../other/RadarEngine.js';

export default class App {
  profileFields = ['displayName', 'vibe', 'age', 'tribe', 'role', 'tagline', 'lookingFor', 'radius', 'photoUrl'];
  chatHistoryStorageKey = 'meateor:chatHistory';
  unreadStorageKey = 'meateor:chatUnread';
  chatHydrateInterval = null;

  state = {
    profileCollapsed: false,
    gallery: [],
    chat: {
      openPeerId: null,
      messages: {},
      drafts: {},
      unread: {},
      peerDeviceIds: {},
      hydratedPeers: {},
    },
    get roster() {
      if (!state.app.love || !state.app.radar || !this.me) return [];
      return state.app.love.peers
        .filter(x => !x.location || state.app.radar.distance(x.location) <= Number(this.me.radius || 0))
        .sort((a, b) => {
          if (!a.location && !b.location) return 0;
          if (!a.location) return 1;
          if (!b.location) return -1;
          return state.app.radar.distance(a.location) - state.app.radar.distance(b.location);
        });
    },
    get activeChatPeer() {
      let peerId = this.chat && this.chat.openPeerId;
      if (!peerId || !state.app.love) return null;
      return state.app.love.peers.find(peer => peer.id === peerId) || null;
    },
  };

  isProfileComplete = profile => {
    if (!profile) return false;
    return this.profileFields.every(field => {
      let value = profile[field];
      if (typeof value === 'number') return !Number.isNaN(value);
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
  };

  persistProfile = () => {
    if (!this.state.me) return;
    localStorage.setItem('meateor:profile', JSON.stringify(this.state.me));
  };

  persistGallery = () => {
    let gallery = Array.isArray(this.state.gallery) ? this.state.gallery : [];
    localStorage.setItem('meateor:gallery', JSON.stringify(gallery));
  };

  getChatHistoryMap = () => {
    let raw = localStorage.getItem(this.chatHistoryStorageKey);
    if (!raw) return {};
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = {};
    }
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  };

  saveChatHistoryMap = history => {
    let safeHistory = history && typeof history === 'object' ? history : {};
    localStorage.setItem(this.chatHistoryStorageKey, JSON.stringify(safeHistory));
  };

  getUnreadCountsMap = () => {
    let raw = localStorage.getItem(this.unreadStorageKey);
    if (!raw) return {};
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = {};
    }
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  };

  saveUnreadCountsMap = counts => {
    let nextCounts = counts && typeof counts === 'object' ? counts : {};
    localStorage.setItem(this.unreadStorageKey, JSON.stringify(nextCounts));
  };

  getPeerDeviceId = peerId => {
    if (!peerId) return null;
    if (this.state.chat.peerDeviceIds[peerId]) return this.state.chat.peerDeviceIds[peerId];
    if (!this.state.love || !Array.isArray(this.state.love.peers)) return null;
    let peer = this.state.love.peers.find(candidate => candidate && candidate.id === peerId);
    if (peer && peer.devid) {
      this.state.chat.peerDeviceIds[peerId] = peer.devid;
      return peer.devid;
    }
    return null;
  };

  getStoredMessagesForPeer = (peerId, deviceIdOverride) => {
    let deviceId = deviceIdOverride || this.getPeerDeviceId(peerId);
    if (!deviceId) return [];
    let history = this.getChatHistoryMap();
    let stored = history[deviceId];
    if (!Array.isArray(stored)) return [];
    return stored.map(entry => ({
      direction: entry.direction === 'out' ? 'out' : 'in',
      type: entry.type === 'photo' ? 'photo' : 'text',
      text: typeof entry.text === 'string' ? entry.text : '',
      photoUrl: entry.photoUrl,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    }));
  };

  getStoredUnreadForPeer = (peerId, deviceIdOverride) => {
    let deviceId = deviceIdOverride || this.getPeerDeviceId(peerId);
    if (!deviceId) return 0;
    let counts = this.getUnreadCountsMap();
    let value = counts[deviceId];
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return value;
  };

  persistChatHistoryEntry = (peerId, entry) => {
    let deviceId = this.getPeerDeviceId(peerId);
    if (!deviceId || !entry) return;
    let history = this.getChatHistoryMap();
    if (!Array.isArray(history[deviceId])) history[deviceId] = [];
    history[deviceId].push({
      direction: entry.direction === 'out' ? 'out' : 'in',
      type: entry.type === 'photo' ? 'photo' : 'text',
      text: typeof entry.text === 'string' ? entry.text : '',
      photoUrl: entry.photoUrl,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    });
    this.saveChatHistoryMap(history);
  };

  persistUnreadCountForPeer = peerId => {
    let deviceId = this.getPeerDeviceId(peerId);
    if (!deviceId) return;
    let counts = this.getUnreadCountsMap();
    let countValue = Number(this.state.chat.unread[peerId]) || 0;
    counts[deviceId] = countValue;
    this.saveUnreadCountsMap(counts);
  };

  getMessageKey = entry => {
    if (!entry) return '';
    let direction = entry.direction === 'out' ? 'out' : 'in';
    let type = entry.type === 'photo' ? 'photo' : 'text';
    let text = typeof entry.text === 'string' ? entry.text : '';
    let photoUrl = entry.photoUrl || '';
    let timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : 0;
    return [direction, type, text, photoUrl, timestamp].join('|');
  };

  hydratePeerChatFromStorage = (peerId, deviceIdOverride) => {
    if (!peerId) return;
    if (this.state.chat.hydratedPeers[peerId]) return;
    let deviceId = deviceIdOverride || this.getPeerDeviceId(peerId);
    if (!deviceId) return;
    let storedMessages = this.getStoredMessagesForPeer(peerId, deviceId);
    let currentMessages = Array.isArray(this.state.chat.messages[peerId]) ? [...this.state.chat.messages[peerId]] : [];
    if (Array.isArray(storedMessages) && storedMessages.length) {
      let keySet = new Set();
      let merged = [];
      storedMessages.forEach(entry => {
        let key = this.getMessageKey(entry);
        keySet.add(key);
        merged.push(entry);
      });
      currentMessages.forEach(entry => {
        let key = this.getMessageKey(entry);
        if (!keySet.has(key)) {
          keySet.add(key);
          merged.push(entry);
        }
      });
      this.state.chat.messages[peerId] = merged;
    } else {
      this.state.chat.messages[peerId] = currentMessages;
    }
    let storedUnread = this.getStoredUnreadForPeer(peerId, deviceId);
    let currentUnread = Number(this.state.chat.unread[peerId]) || 0;
    if (storedUnread) this.state.chat.unread[peerId] = storedUnread + currentUnread;
    else if (this.state.chat.unread[peerId] === undefined) this.state.chat.unread[peerId] = 0;
    this.state.chat.hydratedPeers[peerId] = true;
  };

  hydrateAllPeerChats = () => {
    if (!this.state.love || !Array.isArray(this.state.love.peers)) return;
    this.state.love.peers.forEach(peer => {
      if (!peer || !peer.id) return;
      this.hydratePeerChatFromStorage(peer.id, peer.devid);
    });
  };

  updateCollapsedFromProfile = () => {
    this.state.profileCollapsed = this.isProfileComplete(this.state.me);
  };

  addPhotoToGallery = dataUrl => {
    if (!dataUrl) return;
    if (!Array.isArray(this.state.gallery)) this.state.gallery = [];
    let existingIndex = this.state.gallery.indexOf(dataUrl);
    if (existingIndex !== -1) this.state.gallery.splice(existingIndex, 1);
    this.state.gallery.unshift(dataUrl);
    if (this.state.gallery.length > 30) this.state.gallery.splice(30);
    this.persistGallery();
  };

  ensureChatContainers = peerId => {
    if (!peerId) return;
    this.hydratePeerChatFromStorage(peerId);
    if (!this.state.chat.messages[peerId]) this.state.chat.messages[peerId] = [];
    if (this.state.chat.drafts[peerId] === undefined) this.state.chat.drafts[peerId] = '';
    if (this.state.chat.unread[peerId] === undefined) this.state.chat.unread[peerId] = this.getStoredUnreadForPeer(peerId);
    if (Number.isNaN(this.state.chat.unread[peerId])) this.state.chat.unread[peerId] = 0;
  };

  appendChatMessage = (peerId, message) => {
    if (!peerId || !message) return;
    this.ensureChatContainers(peerId);
    let entry = {
      direction: message.direction,
      type: message.type || (message.photoUrl ? 'photo' : 'text'),
      text: message.text,
      photoUrl: message.photoUrl,
      timestamp: message.timestamp || Date.now(),
    };
    this.state.chat.messages[peerId].push(entry);
    this.persistChatHistoryEntry(peerId, entry);
  };

  handleIncomingChat = (peerId, payload) => {
    if (!peerId || !payload) return;
    let type = payload.type || (payload.dataUrl ? 'photo' : 'text');
    let text = typeof payload.text === 'string' ? payload.text : '';
    if (type === 'text' && !text.trim()) return;
    if (type === 'photo' && !payload.dataUrl) return;
    let timestamp = payload.timestamp || Date.now();
    let message = { direction: 'in', type, timestamp };
    if (type === 'photo') message.photoUrl = payload.dataUrl;
    else message.text = text;
    this.appendChatMessage(peerId, message);
    if (this.state.chat.openPeerId !== peerId) {
      let currentUnread = Number(this.state.chat.unread[peerId]) || 0;
      this.state.chat.unread[peerId] = currentUnread + 1;
      this.persistUnreadCountForPeer(peerId);
    }
  };

  sendPhotoMessage = dataUrl => {
    if (!dataUrl) return;
    let peerId = this.state.chat.openPeerId;
    if (!peerId) return;
    let timestamp = Date.now();
    this.appendChatMessage(peerId, { direction: 'out', type: 'photo', photoUrl: dataUrl, timestamp });
    if (this.state.love && this.state.love.sendDirectMessage) {
      this.state.love.sendDirectMessage({ type: 'photo', dataUrl, timestamp }, peerId);
    }
  };

  actions = {
    init: async () => {
      this.state.love = new LoveEngine({ appId: 'meateor2' }, 'gaybar');
      this.state.radar = new RadarEngine();
      this.state.love.onChatMessage((payload, id) => this.handleIncomingChat(id, payload));
      setInterval(() => this.state.me.location = this.state.radar.location, 1000);
      this.state.me = this.state.love.me;
      let storedProfile = JSON.parse(localStorage.getItem('meateor:profile') || 'null');
      Object.assign(this.state.me, storedProfile || {
        displayName: 'You',
        vibe: 'Online',
        age: 18,
        tribe: 'Geek',
        role: 'Vers',
        tagline: `Let's chat!`,
        lookingFor: `Friends & chill`,
        radius: 100,
      });
      let storedGallery = JSON.parse(localStorage.getItem('meateor:gallery') || '[]');
      this.state.gallery = Array.isArray(storedGallery) ? storedGallery : [];
      this.updateCollapsedFromProfile();
      this.state.initialized = true;
      if (this.chatHydrateInterval) clearInterval(this.chatHydrateInterval);
      this.hydrateAllPeerChats();
      this.chatHydrateInterval = setInterval(() => this.hydrateAllPeerChats(), 2000);
    },
    toggleProfileCollapsed: () => {
      this.state.profileCollapsed = !this.state.profileCollapsed;
    },
    updateProfileField: (field, value) => {
      if (!this.state.me || !field) return;
      let nextValue = value;
      if (field === 'age') {
        let parsed = Number(value);
        nextValue = value === '' || Number.isNaN(parsed) ? value : parsed;
      }
      if (field === 'radius') {
        let parsed = Number(value);
        nextValue = Number.isNaN(parsed) ? this.state.me.radius : parsed;
      }
      this.state.me[field] = nextValue;
      this.updateCollapsedFromProfile();
      this.persistProfile();
    },
    pickPhoto: async inputId => {
      let input = document.getElementById(inputId);
      if (!input || !input.files || !input.files[0]) return;
      let file = input.files[0];
      let reader = new FileReader();
      reader.onload = () => {
        this.state.me.photoUrl = reader.result;
        this.updateCollapsedFromProfile();
        this.persistProfile();
      };
      reader.readAsDataURL(file);
    },
    openChat: peerId => {
      if (!peerId) return;
      this.ensureChatContainers(peerId);
      this.state.chat.openPeerId = peerId;
      this.state.chat.unread[peerId] = 0;
      this.persistUnreadCountForPeer(peerId);
    },
    updateChatDraft: (peerId, value) => {
      if (!peerId) return;
      this.ensureChatContainers(peerId);
      this.state.chat.drafts[peerId] = value;
    },
    sendChatMessage: () => {
      let peerId = this.state.chat.openPeerId;
      if (!peerId) return;
      this.ensureChatContainers(peerId);
      let draft = this.state.chat.drafts[peerId] || '';
      let text = draft.trim();
      if (!text) return;
      let timestamp = Date.now();
      this.appendChatMessage(peerId, { direction: 'out', type: 'text', text, timestamp });
      this.state.chat.drafts[peerId] = '';
      if (this.state.love && this.state.love.sendDirectMessage) {
        this.state.love.sendDirectMessage({ type: 'text', text, timestamp }, peerId);
      }
    },
    closeChat: () => {
      this.state.chat.openPeerId = null;
    },
    uploadChatPhoto: inputId => {
      let input = document.getElementById(inputId);
      if (!input || !input.files || !input.files[0]) return;
      let file = input.files[0];
      let reader = new FileReader();
      reader.onload = () => {
        let dataUrl = reader.result;
        if (!dataUrl) return;
        this.addPhotoToGallery(dataUrl);
        this.sendPhotoMessage(dataUrl);
        input.value = '';
      };
      reader.readAsDataURL(file);
    },
    sendChatPhotoFromGallery: dataUrl => {
      if (!dataUrl) return;
      this.addPhotoToGallery(dataUrl);
      this.sendPhotoMessage(dataUrl);
    },
  };
}
