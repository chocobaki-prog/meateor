import LoveEngine from '../other/LoveEngine.js';
import RadarEngine from '../other/RadarEngine.js';
import genpix from '../other/genpix.js';

let storedAgeGateVerified = false;
let ageGateSupported = typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
let callSupported = typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    storedAgeGateVerified = window.localStorage.getItem('meateor:ageVerified') === '1';
  }
} catch (error) {}

export default class App {
  profileFields = ['displayName', 'vibe', 'age', 'tribe', 'role', 'tagline', 'lookingFor', 'radius', 'photoUrl'];
  chatHistoryStorageKey = 'meateor:chatHistory';
  unreadStorageKey = 'meateor:chatUnread';
  chatHydrateInterval = null;
  profileCounterInterval = null;
  chatScrollElement = null;
  chatScrollFrame = null;
  pingAudio = null;
  knownRosterPeerIds = new Set();
  rosterSeeded = false;
  soundUnlocked = false;
  pendingPingCount = 0;
  soundUnlockInstalled = false;
  faceApi = null;
  faceApiLoadPromise = null;
  faceDetectorOptions = null;
  ageVerificationStream = null;
  ageVerificationLoop = null;
  ageVerificationVideo = null;
  initRequested = false;
  bootstrapped = false;
  callRequestTimeout = null;
  sendCallStream = null;
  callStreamUnsubscribe = null;
  localCallStream = null;
  localCallStreamPromise = null;
  remoteCallStream = null;
  callLocalVideoElement = null;
  callRemoteVideoElement = null;

  state = {
    ageGate: {
      verified: storedAgeGateVerified,
      verifying: false,
      error: null,
      streamActive: false,
      resultAge: null,
      minimumAge: 21,
      loadingModels: false,
      supported: ageGateSupported,
    },
    pix: {},
    profileCollapsed: false,
    gallery: [],
    chat: {
      openPeerId: null,
      messages: {},
      drafts: {},
      unread: {},
      peerDeviceIds: {},
      hydratedPeers: {},
      autoScrollEnabled: true,
    },
    lightbox: {
      open: false,
      peerId: null,
      direction: null,
      photos: [],
      activeIndex: 0,
    },
    call: {
      status: 'idle',
      supported: callSupported,
      activePeerId: null,
      requestId: null,
      incomingPeerId: null,
      incomingRequestId: null,
      error: null,
      fullscreen: false,
      localStreamActive: false,
      remoteStreamActive: false,
    },
    get roster() {
      if (!state.app.love || !state.app.radar || !this.me) return [];
      let radius = Number(this.me.radius || 0);
      return state.app.love.peers
        .filter(x => x && x.displayName && String(x.displayName).trim())
        .filter(x => {
          if (!x.location) return true;
          if (x.offline) return true;
          let distance = state.app.radar.distance(x.location);
          return Number.isNaN(distance) ? true : distance <= radius;
        })
        .sort((a, b) => {
          if (!!a.offline !== !!b.offline) return a.offline ? 1 : -1;
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
    get activeChatPeerOnline() {
      let peer = this.activeChatPeer;
      if (!peer) return false;
      return !peer.offline && !!peer.connectionId;
    },
    get activeCallPeerName() {
      let peerId = this.call && this.call.activePeerId;
      if (!peerId || !state.app.love || !Array.isArray(state.app.love.peers)) return '';
      let peer = state.app.love.peers.find(entry => entry && entry.id === peerId);
      if (!peer || !peer.displayName) return '';
      return peer.displayName;
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

  startProfileCounter = () => {
    if (this.profileCounterInterval) clearInterval(this.profileCounterInterval);
    this.profileCounterInterval = setInterval(() => {
      if (!this.state.me) return;
      let current = Number(this.state.me.counter) || 0;
      this.state.me.counter = current + 1;
    }, 1000);
  };

  initPingAudio = () => {
    if (this.pingAudio) return;
    if (typeof Audio === 'undefined') return;
    this.pingAudio = new Audio('media/ping.wav');
    this.pingAudio.preload = 'auto';
  };

  performPingPlayback = () => {
    try {
      if (!this.pingAudio) this.initPingAudio();
      if (!this.pingAudio) return;
      this.pingAudio.currentTime = 0;
      let playResult = this.pingAudio.play();
      if (playResult && playResult.catch) {
        playResult.catch(() => {});
      }
    } catch (error) {}
  };

  playPingSound = () => {
    if (!this.soundUnlocked) {
      this.pendingPingCount += 1;
      return;
    }
    this.performPingPlayback();
  };

  installSoundUnlockListeners = () => {
    if (this.soundUnlockInstalled) return;
    if (typeof window === 'undefined') return;
    this.soundUnlockInstalled = true;
    let handler = () => {
      ['pointerdown', 'touchstart', 'keydown'].forEach(eventName => {
        window.removeEventListener(eventName, handler, true);
      });
      this.actions.enablePingAudio();
    };
    ['pointerdown', 'touchstart', 'keydown'].forEach(eventName => {
      window.addEventListener(eventName, handler, { capture: true });
    });
  };

  clearChatScrollFrame = () => {
    if (!this.chatScrollFrame) return;
    let win = typeof window !== 'undefined' ? window : null;
    let caf = win && win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : clearTimeout;
    caf(this.chatScrollFrame);
    this.chatScrollFrame = null;
  };

  scheduleChatScroll = () => {
    if (!this.state.chat.autoScrollEnabled || !this.chatScrollElement) return;
    this.clearChatScrollFrame();
    let win = typeof window !== 'undefined' ? window : null;
    let raf = win && win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (fn => setTimeout(fn, 16));
    this.chatScrollFrame = raf(() => {
      if (this.chatScrollElement) {
        this.chatScrollElement.scrollTop = this.chatScrollElement.scrollHeight;
      }
      this.chatScrollFrame = null;
    });
  };

  updateAutoScrollState = element => {
    let target = element || this.chatScrollElement;
    if (!target) return;
    let distance = target.scrollHeight - target.scrollTop - target.clientHeight;
    this.state.chat.autoScrollEnabled = distance <= 50;
    return this.state.chat.autoScrollEnabled;
  };

  refreshKnownRoster = forceSeed => {
    let rosterList = Array.isArray(this.state.roster) ? this.state.roster : [];
    let shouldSeed = forceSeed || !this.rosterSeeded;
    if (!rosterList.length) {
      this.knownRosterPeerIds.clear();
      this.rosterSeeded = false;
      return;
    }
    let currentIds = new Set();
    rosterList.forEach(peer => {
      if (!peer || !peer.id) return;
      currentIds.add(peer.id);
      this.state.chat.peerDeviceIds[peer.id] = peer.id;
      if (peer.connectionId) this.state.chat.peerDeviceIds[peer.connectionId] = peer.id;
      if (!this.knownRosterPeerIds.has(peer.id) && !shouldSeed) {
        this.playPingSound();
      }
      this.knownRosterPeerIds.add(peer.id);
    });
    this.rosterSeeded = true;
    Array.from(this.knownRosterPeerIds).forEach(id => {
      if (!currentIds.has(id)) this.knownRosterPeerIds.delete(id);
    });
  };

  getPeerById = peerId => {
    if (!peerId || !this.state.love || !Array.isArray(this.state.love.peers)) return null;
    return this.state.love.peers.find(peer => peer && peer.id === peerId) || null;
  };

  getPeerConnectionId = peerId => {
    if (!peerId) return null;
    let peer = this.getPeerById(peerId);
    if (peer && peer.connectionId) return peer.connectionId;
    if (this.state.chat && this.state.chat.peerDeviceIds) {
      let mappedDevice = this.state.chat.peerDeviceIds[peerId];
      if (mappedDevice && mappedDevice !== peerId) {
        let fallbackPeer = this.getPeerById(mappedDevice);
        if (fallbackPeer && fallbackPeer.connectionId) return fallbackPeer.connectionId;
      }
    }
    return null;
  };

  canSendToPeer = peerId => {
    let peer = this.getPeerById(peerId);
    if (!peer) return false;
    return !peer.offline && !!peer.connectionId;
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
    let peer = this.state.love.peers.find(candidate => candidate && (candidate.id === peerId || candidate.connectionId === peerId));
    if (peer && peer.id) {
      this.state.chat.peerDeviceIds[peerId] = peer.id;
      if (!this.state.chat.peerDeviceIds[peer.id]) this.state.chat.peerDeviceIds[peer.id] = peer.id;
      return peer.id;
    }
    return peerId;
  };

  getStoredMessagesForPeer = (peerId, deviceIdOverride) => {
    let deviceId = deviceIdOverride || this.getPeerDeviceId(peerId);
    if (!deviceId) return [];
    let history = this.getChatHistoryMap();
    let stored = history[deviceId];
    if (!Array.isArray(stored)) return [];
    return stored;
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
    history[deviceId].push(entry);
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

  resetLightboxState = () => {
    this.state.lightbox.open = false;
    this.state.lightbox.peerId = null;
    this.state.lightbox.direction = null;
    this.state.lightbox.activeIndex = 0;
    this.state.lightbox.photos = [];
  };

  getPhotoMessagesForPeer = (peerId, direction) => {
    if (!peerId) return [];
    this.ensureChatContainers(peerId);
    let filterDirection = direction === 'out' ? 'out' : 'in';
    let messages = Array.isArray(this.state.chat.messages[peerId]) ? this.state.chat.messages[peerId] : [];
    return messages.filter(entry => entry && entry.type === 'photo' && entry.photoUrl && entry.direction === filterDirection);
  };

  syncLightboxForPeer = peerId => {
    if (!this.state.lightbox || !this.state.lightbox.open) return;
    if (!peerId || this.state.lightbox.peerId !== peerId) return;
    let direction = this.state.lightbox.direction;
    if (!direction) return;
    let photos = this.getPhotoMessagesForPeer(peerId, direction);
    if (!photos.length) {
      this.resetLightboxState();
      return;
    }
    let nextIndex = this.state.lightbox.activeIndex;
    if (nextIndex >= photos.length) nextIndex = photos.length - 1;
    if (nextIndex < 0) nextIndex = 0;
    this.state.lightbox.photos = photos;
    this.state.lightbox.activeIndex = nextIndex;
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
      pixUrl: message.pixUrl,
      amount: message.amount,
      timestamp: message.timestamp || Date.now(),
    };
    this.state.chat.messages[peerId].push(entry);
    this.persistChatHistoryEntry(peerId, entry);
    if (entry.type === 'photo') this.syncLightboxForPeer(peerId);
    if (this.state.chat.autoScrollEnabled) this.scheduleChatScroll();
  };

  ensureLocalCallMedia = async () => {
    if (this.localCallStream) {
      this.state.call.localStreamActive = true;
      this.attachLocalCallStream();
      return this.localCallStream;
    }
    if (this.localCallStreamPromise) return this.localCallStreamPromise;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera or microphone unavailable.');
    }
    let pendingPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    this.localCallStreamPromise = pendingPromise;
    return pendingPromise
      .then(stream => {
        if (this.localCallStreamPromise !== pendingPromise) {
          try {
            if (stream && stream.getTracks) stream.getTracks().forEach(track => track.stop());
          } catch (error) {}
          return this.localCallStream;
        }
        this.localCallStreamPromise = null;
        this.localCallStream = stream;
        this.state.call.localStreamActive = true;
        this.attachLocalCallStream();
        return stream;
      })
      .catch(error => {
        if (this.localCallStreamPromise === pendingPromise) {
          this.localCallStreamPromise = null;
        }
        throw error;
      });
  };

  ensureCallStreamSetup = () => {
    if (this.sendCallStream) return;
    if (!this.state.love || !this.state.love.room) return;
    if (typeof this.state.love.room.makeStream !== 'function') return;
    let pair = this.state.love.room.makeStream();
    if (!Array.isArray(pair) || pair.length < 2) return;
    let sendStream = pair[0];
    let onStream = pair[1];
    this.sendCallStream = (stream, peerId) => {
      if (!sendStream || !stream || !peerId) return;
      let targetConnectionId = this.getPeerConnectionId(peerId) || peerId;
      if (!targetConnectionId) return;
      try {
        sendStream(stream, targetConnectionId);
      } catch (error) {}
    };
    if (typeof onStream === 'function') {
      this.callStreamUnsubscribe = onStream((remoteStream, remotePeerId) => {
        let deviceId = this.getPeerDeviceId(remotePeerId) || remotePeerId;
        this.handleIncomingMediaStream(remoteStream, deviceId);
      });
    }
  };

  handleIncomingMediaStream = (stream, peerId) => {
    if (!stream || !peerId) return;
    let activePeerId = this.state.call.activePeerId;
    if (!activePeerId) return;
    if (activePeerId !== peerId) return;
    this.remoteCallStream = stream;
    this.state.call.remoteStreamActive = true;
    this.state.call.status = 'active';
    this.state.call.error = null;
    this.attachRemoteCallStream();
  };

  attachCallStreamToElement = (element, stream, muted) => {
    if (!element) return;
    try {
      element.autoplay = true;
      element.playsInline = true;
      element.muted = !!muted;
      if (element.srcObject !== stream) {
        element.srcObject = stream || null;
      }
      if (element.play) {
        let result = element.play();
        if (result && result.catch) result.catch(() => {});
      }
    } catch (error) {}
  };

  attachLocalCallStream = () => {
    if (!this.callLocalVideoElement) return;
    this.attachCallStreamToElement(this.callLocalVideoElement, this.localCallStream, true);
  };

  attachRemoteCallStream = () => {
    if (!this.callRemoteVideoElement) return;
    this.attachCallStreamToElement(this.callRemoteVideoElement, this.remoteCallStream, false);
  };

  bindLocalCallVideoElement = element => {
    this.callLocalVideoElement = element;
    if (element) {
      this.attachLocalCallStream();
    }
  };

  releaseLocalCallVideoElement = element => {
    if (this.callLocalVideoElement === element) {
      try {
        if (this.callLocalVideoElement) this.callLocalVideoElement.srcObject = null;
      } catch (error) {}
      this.callLocalVideoElement = null;
    }
  };

  bindRemoteCallVideoElement = element => {
    this.callRemoteVideoElement = element;
    if (element) {
      this.attachRemoteCallStream();
    }
  };

  releaseRemoteCallVideoElement = element => {
    if (this.callRemoteVideoElement === element) {
      try {
        if (this.callRemoteVideoElement) this.callRemoteVideoElement.srcObject = null;
      } catch (error) {}
      this.callRemoteVideoElement = null;
    }
  };

  tearDownLocalCallStream = () => {
    this.localCallStreamPromise = null;
    if (this.localCallStream && this.localCallStream.getTracks) {
      this.localCallStream.getTracks().forEach(track => track.stop());
    }
    this.localCallStream = null;
    if (this.callLocalVideoElement) {
      try {
        this.callLocalVideoElement.srcObject = null;
      } catch (error) {}
    }
    this.state.call.localStreamActive = false;
  };

  tearDownRemoteCallStream = () => {
    if (this.remoteCallStream && this.remoteCallStream.getTracks) {
      this.remoteCallStream.getTracks().forEach(track => track.stop());
    }
    this.remoteCallStream = null;
    if (this.callRemoteVideoElement) {
      try {
        this.callRemoteVideoElement.srcObject = null;
      } catch (error) {}
    }
    this.state.call.remoteStreamActive = false;
  };

  clearCallRequestTimeout = () => {
    if (this.callRequestTimeout) {
      clearTimeout(this.callRequestTimeout);
      this.callRequestTimeout = null;
    }
  };

  startCallRequestTimer = () => {
    this.clearCallRequestTimeout();
    this.callRequestTimeout = setTimeout(() => {
      if (this.state.call.status === 'requesting') {
        this.state.call.error = 'No answer. Try again later.';
        this.endCallSession(true);
      }
    }, 25000);
  };

  endCallSession = keepError => {
    this.clearCallRequestTimeout();
    this.tearDownLocalCallStream();
    this.tearDownRemoteCallStream();
    if (!keepError) this.state.call.error = null;
    this.state.call.status = 'idle';
    this.state.call.activePeerId = null;
    this.state.call.requestId = null;
    this.state.call.incomingPeerId = null;
    this.state.call.incomingRequestId = null;
    this.state.call.fullscreen = false;
    this.state.call.localStreamActive = false;
    this.state.call.remoteStreamActive = false;
  };

  sendCallSignal = (peerId, payload) => {
    if (!peerId || !payload) return;
    if (!this.state.love || !this.state.love.sendDirectMessage) return;
    this.state.love.sendDirectMessage({ call: payload }, peerId);
  };

  handleCallSignal = (peerId, detail) => {
    if (!peerId || !detail) return false;
    let type = detail.type;
    if (!type) return false;
    let requestId = detail.requestId || null;
    if (type === 'request') {
      if (!this.state.call.supported) {
        this.sendCallSignal(peerId, { type: 'error', requestId, message: 'Calls unsupported on this device.' });
        return true;
      }
      if (this.state.call.status !== 'idle') {
        this.sendCallSignal(peerId, { type: 'busy', requestId });
        return true;
      }
      this.endCallSession(false);
      this.state.call.status = 'ringing';
      this.state.call.incomingPeerId = peerId;
      this.state.call.incomingRequestId = requestId;
      this.state.call.activePeerId = peerId;
      this.state.call.error = null;
      return true;
    }
    if (type === 'accept') {
      if (this.state.call.activePeerId !== peerId || this.state.call.requestId !== requestId) return true;
      this.clearCallRequestTimeout();
      this.beginCallMediaSession(peerId);
      return true;
    }
    if (type === 'reject') {
      if (this.state.call.activePeerId === peerId && this.state.call.requestId === requestId) {
        this.state.call.error = 'Call declined';
        this.endCallSession(true);
      }
      return true;
    }
    if (type === 'busy') {
      if (this.state.call.activePeerId === peerId && this.state.call.requestId === requestId) {
        this.state.call.error = 'They are busy right now';
        this.endCallSession(true);
      }
      return true;
    }
    if (type === 'cancel') {
      if (this.state.call.incomingPeerId === peerId && this.state.call.incomingRequestId === requestId) {
        this.state.call.error = 'Call cancelled';
        this.endCallSession(true);
      }
      return true;
    }
    if (type === 'end') {
      if (this.state.call.activePeerId === peerId) {
        this.endCallSession(false);
      }
      return true;
    }
    if (type === 'error') {
      if (this.state.call.activePeerId === peerId) {
        this.state.call.error = detail.message || 'Call failed';
        this.endCallSession(true);
      }
      return true;
    }
    return false;
  };

  beginCallMediaSession = async peerId => {
    if (!peerId) return;
    if (!this.state.call.supported) {
      this.state.call.error = 'Calls unsupported on this device.';
      this.endCallSession(true);
      return;
    }
    this.ensureCallStreamSetup();
    this.state.call.status = 'connecting';
    this.state.call.error = null;
    try {
      let stream = await this.ensureLocalCallMedia();
      if (!stream) throw new Error('Camera or microphone unavailable.');
      this.localCallStream = stream;
      this.state.call.localStreamActive = true;
      this.attachLocalCallStream();
      if (this.sendCallStream) {
        this.sendCallStream(stream, peerId);
      }
    } catch (error) {
      let message = error && error.message ? error.message : 'Unable to access camera or microphone.';
      this.state.call.error = message;
      this.sendCallSignal(peerId, { type: 'error', requestId: this.state.call.requestId || this.state.call.incomingRequestId, message });
      this.endCallSession(true);
    }
  };

  handleIncomingChat = (peerId, payload) => {
    if (!peerId || !payload) return;
    if (payload.call) {
      if (this.handleCallSignal(peerId, payload.call)) return;
    }
    let type = payload.type || (payload.dataUrl ? 'photo' : 'text');
    let text = typeof payload.text === 'string' ? payload.text : '';
    if (type === 'text' && !text.trim()) return;
    if (type === 'photo' && !payload.dataUrl) return;
    let timestamp = payload.timestamp || Date.now();
    let message = { direction: 'in', type, timestamp };
    if (type === 'photo') message.photoUrl = payload.dataUrl;
    if (type === 'pix') { message.pixUrl = payload.pixUrl; message.amount = payload.amount }
    else message.text = text;
    this.appendChatMessage(peerId, message);
    this.playPingSound();
    if (this.state.chat.openPeerId !== peerId) {
      let currentUnread = Number(this.state.chat.unread[peerId]) || 0;
      this.state.chat.unread[peerId] = currentUnread + 1;
      this.persistUnreadCountForPeer(peerId);
    }
  };

  sendPhotoMessage = dataUrl => {
    if (!dataUrl) return;
    let peerId = this.state.chat.openPeerId;
    if (!peerId || !this.canSendToPeer(peerId)) return;
    let timestamp = Date.now();
    this.appendChatMessage(peerId, { direction: 'out', type: 'photo', photoUrl: dataUrl, timestamp });
    if (this.state.love && this.state.love.sendDirectMessage) {
      this.state.love.sendDirectMessage({ type: 'photo', dataUrl, timestamp }, peerId);
    }
  };

  bootstrapApp = async () => {
    if (this.bootstrapped) return;
    this.bootstrapped = true;
    this.state.love = new LoveEngine({ appId: 'meateor2' }, 'gaybar');
    this.state.radar = new RadarEngine();
    this.state.love.onChatMessage((payload, id) => this.handleIncomingChat(id, payload));
    this.ensureCallStreamSetup();
    setInterval(() => this.state.me.location = this.state.radar.location, 1000);
    this.state.me = this.state.love.me;
    let storedProfile = JSON.parse(localStorage.getItem('meateor:profile') || 'null');
    this.state.pix = JSON.parse(localStorage.getItem('meateor:pix') || '{}');
    Object.assign(this.state.me, storedProfile || {
      displayName: '',
      vibe: 'Online',
      age: 21,
      tribe: 'Discreet',
      role: 'Vers',
      tagline: `Let's chat!`,
      lookingFor: `Friends & chill`,
      radius: 100,
    });
    if (typeof this.state.me.counter !== 'number' || Number.isNaN(this.state.me.counter)) {
      this.state.me.counter = 0;
    }
    let storedGallery = JSON.parse(localStorage.getItem('meateor:gallery') || '[]');
    this.state.gallery = Array.isArray(storedGallery) ? storedGallery : [];
    this.updateCollapsedFromProfile();
    this.state.initialized = true;
    if (this.chatHydrateInterval) clearInterval(this.chatHydrateInterval);
    this.hydrateAllPeerChats();
    this.refreshKnownRoster(true);
    this.chatHydrateInterval = setInterval(() => {
      this.hydrateAllPeerChats();
      this.refreshKnownRoster();
    }, 2000);
    this.startProfileCounter();
    this.installSoundUnlockListeners();
  };

  getFaceAssetBasePath = () => {
    let prefix = '.';
    if (typeof window !== 'undefined' && window.rootPrefix !== undefined && window.rootPrefix !== null) {
      prefix = window.rootPrefix || '.';
    }
    if (!prefix || typeof prefix !== 'string') prefix = '.';
    if (prefix.endsWith('/')) {
      prefix = prefix.slice(0, -1) || '.';
    }
    return `${prefix}/other`;
  };

  loadFaceApiLibrary = async () => {
    if (this.faceApi) return this.faceApi;
    if (this.faceApiLoadPromise) return this.faceApiLoadPromise;
    this.state.ageGate.loadingModels = true;
    this.faceApiLoadPromise = (async () => {
      await import('../other/face-api.js');
      let globalFaceApi = typeof faceapi !== 'undefined' ? faceapi : null;
      if (!globalFaceApi && typeof globalThis !== 'undefined') {
        globalFaceApi = globalThis.faceapi || null;
      }
      if (!globalFaceApi && typeof window !== 'undefined') {
        globalFaceApi = window.faceapi || null;
      }
      if (!globalFaceApi) throw new Error('Unable to initialize age verification library');
      let basePath = this.getFaceAssetBasePath();
      await Promise.all([
        globalFaceApi.nets.tinyFaceDetector.loadFromUri(basePath),
        globalFaceApi.nets.ageGenderNet.loadFromUri(basePath),
      ]);
      if (!this.faceDetectorOptions) {
        this.faceDetectorOptions = new globalFaceApi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      }
      return globalFaceApi;
    })();
    try {
      let resolved = await this.faceApiLoadPromise;
      this.faceApi = resolved;
      this.state.ageGate.loadingModels = false;
      return resolved;
    } catch (error) {
      this.state.ageGate.loadingModels = false;
      this.faceApiLoadPromise = null;
      throw error;
    }
  };

  requestAgeVerificationStream = async () => {
    if (this.ageVerificationStream) return this.ageVerificationStream;
    if (!this.state.ageGate.supported) throw new Error('Camera access is not supported in this browser');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access is unavailable');
    }
    let stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.ageVerificationStream = stream;
    this.state.ageGate.streamActive = true;
    let video = this.ageVerificationVideo;
    if (!video && typeof document !== 'undefined') {
      video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      this.ageVerificationVideo = video;
    }
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('autoplay', 'true');
      let playResult = video.play();
      if (playResult && playResult.catch) {
        playResult.catch(() => {});
      }
    }
    return stream;
  };

  clearAgeDetectionLoop = () => {
    if (this.ageVerificationLoop) {
      clearTimeout(this.ageVerificationLoop);
      this.ageVerificationLoop = null;
    }
  };

  teardownAgeVerificationStream = () => {
    this.clearAgeDetectionLoop();
    if (this.ageVerificationStream && this.ageVerificationStream.getTracks) {
      this.ageVerificationStream.getTracks().forEach(track => track.stop());
    }
    this.ageVerificationStream = null;
    if (this.ageVerificationVideo) {
      try {
        this.ageVerificationVideo.pause();
      } catch (error) {}
      this.ageVerificationVideo.srcObject = null;
    }
    this.state.ageGate.streamActive = false;
  };

  cancelAgeVerificationProcess = () => {
    this.state.ageGate.verifying = false;
    this.teardownAgeVerificationStream();
  };

  runAgeDetection = async () => {
    if (!this.state.ageGate.verifying) return;
    if (!this.ageVerificationVideo) {
      this.ageVerificationLoop = setTimeout(() => this.runAgeDetection(), 500);
      return;
    }
    let faceApiInstance;
    try {
      faceApiInstance = await this.loadFaceApiLibrary();
    } catch (error) {
      this.state.ageGate.error = error && error.message ? error.message : 'Unable to load verification models';
      this.cancelAgeVerificationProcess();
      return;
    }
    if (!this.state.ageGate.verifying) return;
    try {
      if (!this.faceDetectorOptions && faceApiInstance && faceApiInstance.TinyFaceDetectorOptions) {
        this.faceDetectorOptions = new faceApiInstance.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      }
      let detectorOptions = this.faceDetectorOptions || (faceApiInstance && faceApiInstance.TinyFaceDetectorOptions ? new faceApiInstance.TinyFaceDetectorOptions() : null);
      if (!detectorOptions) throw new Error('Unable to configure face detector');
      let detectionResult = await faceApiInstance
        .detectSingleFace(this.ageVerificationVideo, detectorOptions)
        .withAgeAndGender();
      if (!detectionResult) {
        this.state.ageGate.error = 'We could not detect your face. Stay centered in good light.';
        if (this.state.ageGate.verifying) {
          this.ageVerificationLoop = setTimeout(() => this.runAgeDetection(), 1200);
        }
        return;
      }
      let detectedAge = Number(detectionResult.age);
      if (!Number.isNaN(detectedAge)) {
        this.state.ageGate.resultAge = detectedAge;
        if (detectedAge >= this.state.ageGate.minimumAge) {
          this.finishAgeVerification(detectedAge);
          return;
        }
        this.state.ageGate.error = `Detected age ${Math.round(detectedAge)} is below the required ${this.state.ageGate.minimumAge}.`;
      } else {
        this.state.ageGate.error = 'Hold still so we can confirm your age.';
      }
    } catch (error) {
      this.state.ageGate.error = error && error.message ? error.message : 'Unable to analyze camera feed';
    }
    if (this.state.ageGate.verifying) {
      this.ageVerificationLoop = setTimeout(() => this.runAgeDetection(), 1200);
    }
  };

  finishAgeVerification = age => {
    this.state.ageGate.error = null;
    this.state.ageGate.resultAge = age;
    this.state.ageGate.verifying = false;
    this.state.ageGate.verified = true;
    this.teardownAgeVerificationStream();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('meateor:ageVerified', '1');
        window.localStorage.setItem('meateor:ageVerifiedAge', String(Math.round(age)));
      }
    } catch (error) {}
    if (this.initRequested) {
      this.bootstrapApp();
    }
  };

  actions = {
    init: async () => {
      this.initRequested = true;
      if (!this.state.ageGate.verified) return;
      await this.bootstrapApp();
    },
    startAgeVerification: async () => {
      if (this.state.ageGate.verified || this.state.ageGate.verifying) return;
      if (!this.state.ageGate.supported) {
        this.state.ageGate.error = 'Camera access is required for verification.';
        return;
      }
      this.state.ageGate.error = null;
      this.state.ageGate.resultAge = null;
      this.state.ageGate.verifying = true;
      try {
        await this.requestAgeVerificationStream();
        await this.loadFaceApiLibrary();
        this.runAgeDetection();
      } catch (error) {
        this.state.ageGate.error = error && error.message ? error.message : 'Unable to start age verification';
        this.cancelAgeVerificationProcess();
      }
    },
    cancelAgeVerification: () => {
      this.cancelAgeVerificationProcess();
    },
    attachAgeVideo: element => {
      if (!element) return;
      this.ageVerificationVideo = element;
      this.ageVerificationVideo.muted = true;
      this.ageVerificationVideo.playsInline = true;
      this.ageVerificationVideo.setAttribute('autoplay', 'true');
      if (this.ageVerificationStream) {
        element.srcObject = this.ageVerificationStream;
        let playResult = element.play();
        if (playResult && playResult.catch) {
          playResult.catch(() => {});
        }
      }
    },
    detachAgeVideo: element => {
      if (this.ageVerificationVideo === element) {
        if (!this.state.ageGate.verified) {
          this.cancelAgeVerificationProcess();
        }
        this.ageVerificationVideo = null;
      }
    },
    savePix: () => localStorage.setItem('meateor:pix', JSON.stringify(this.state.pix)),
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
      this.state.chat.autoScrollEnabled = true;
      this.scheduleChatScroll();
    },
    updateChatDraft: (peerId, value) => {
      if (!peerId) return;
      this.ensureChatContainers(peerId);
      this.state.chat.drafts[peerId] = value;
    },
    sendChatMessage: async () => {
      let peerId = this.state.chat.openPeerId;
      if (!peerId || !this.canSendToPeer(peerId)) return;
      this.ensureChatContainers(peerId);
      let draft = this.state.chat.drafts[peerId] || '';
      let text = draft.trim();
      if (!text) return;
      text = text.trim();
      let timestamp = Date.now();
      let message = { type: 'text', timestamp: Date.now() };
      if (!text.startsWith('/pix ')) {
        message.text = text;
        this.appendChatMessage(peerId, { direction: 'out', ...message });
        this.state.chat.drafts[peerId] = '';
      } else {
        message.type = 'pix';
        let amount = Number(text.slice('/pix '.length).trim());
        if (Number.isNaN(amount)) throw new Error(`Invalid PIX amount`);
        message.pixUrl = await genpix({ ...this.state.pix, amount });
        message.amount = amount;
        this.state.chat.drafts[peerId] = '';
        this.appendChatMessage(peerId, { direction: 'out', ...message });
      }
      if (this.state.love && this.state.love.sendDirectMessage) {
        console.log(message);
        this.state.love.sendDirectMessage(message, peerId);
      }
    },
    closeChat: () => {
      this.state.chat.openPeerId = null;
      this.resetLightboxState();
      this.state.chat.autoScrollEnabled = true;
      this.chatScrollElement = null;
      this.clearChatScrollFrame();
    },
    uploadChatPhoto: inputId => {
      let input = document.getElementById(inputId);
      if (!input || !input.files || !input.files[0]) return;
      let peerId = this.state.chat.openPeerId;
      if (!peerId || !this.canSendToPeer(peerId)) {
        input.value = '';
        return;
      }
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
      let peerId = this.state.chat.openPeerId;
      if (!peerId || !this.canSendToPeer(peerId)) return;
      this.addPhotoToGallery(dataUrl);
      this.sendPhotoMessage(dataUrl);
    },
    enablePingAudio: () => {
      if (this.soundUnlocked) return;
      this.soundUnlocked = true;
      this.initPingAudio();
      this.flushPendingPings();
    },
    attachChatScroll: element => {
      if (!element) return;
      this.chatScrollElement = element;
      this.state.chat.autoScrollEnabled = true;
      this.scheduleChatScroll();
    },
    detachChatScroll: element => {
      if (this.chatScrollElement === element) {
        this.chatScrollElement = null;
        this.clearChatScrollFrame();
      }
    },
    handleChatScroll: element => {
      if (!element) return;
      let target = element && element.target ? element.target : element;
      if (this.updateAutoScrollState(target)) {
        this.scheduleChatScroll();
      }
    },
    openPhotoLightbox: (peerId, timestamp, direction, photoUrl) => {
      if (!peerId) return;
      this.ensureChatContainers(peerId);
      let filterDirection = direction === 'out' ? 'out' : 'in';
      let photos = this.getPhotoMessagesForPeer(peerId, filterDirection);
      if (!photos.length) return;
      let targetTimestamp = typeof timestamp === 'number' ? timestamp : null;
      let targetPhoto = typeof photoUrl === 'string' ? photoUrl : null;
      let startIndex = photos.findIndex(entry => {
        if (targetTimestamp && entry.timestamp === targetTimestamp) return true;
        if (targetPhoto && entry.photoUrl === targetPhoto) return true;
        return false;
      });
      if (startIndex === -1) startIndex = 0;
      this.state.lightbox.open = true;
      this.state.lightbox.peerId = peerId;
      this.state.lightbox.direction = filterDirection;
      this.state.lightbox.activeIndex = startIndex;
      this.state.lightbox.photos = photos;
    },
    closePhotoLightbox: () => {
      this.resetLightboxState();
    },
    nextPhotoLightbox: () => {
      if (!this.state.lightbox || !this.state.lightbox.open) return;
      let photos = Array.isArray(this.state.lightbox.photos) ? this.state.lightbox.photos : [];
      if (!photos.length) {
        this.resetLightboxState();
        return;
      }
      let nextIndex = (this.state.lightbox.activeIndex + 1) % photos.length;
      this.state.lightbox.activeIndex = nextIndex;
    },
    prevPhotoLightbox: () => {
      if (!this.state.lightbox || !this.state.lightbox.open) return;
      let photos = Array.isArray(this.state.lightbox.photos) ? this.state.lightbox.photos : [];
      if (!photos.length) {
        this.resetLightboxState();
        return;
      }
      let nextIndex = (this.state.lightbox.activeIndex - 1 + photos.length) % photos.length;
      this.state.lightbox.activeIndex = nextIndex;
    },
    requestCall: async () => {
      if (!this.state.call.supported) {
        this.state.call.error = 'Calls are not supported on this device.';
        return;
      }
      if (this.state.call.status !== 'idle') {
        this.state.call.error = 'You are already handling a call.';
        return;
      }
      let peerId = this.state.chat.openPeerId;
      if (!peerId || !this.canSendToPeer(peerId)) {
        this.state.call.error = 'They need to be online to start a call.';
        return;
      }
      let requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      this.state.call.requestId = requestId;
      this.state.call.activePeerId = peerId;
      this.state.call.status = 'requesting';
      this.state.call.error = null;
      this.ensureCallStreamSetup();
      this.sendCallSignal(peerId, { type: 'request', requestId });
      this.startCallRequestTimer();
      try {
        await this.ensureLocalCallMedia();
      } catch (error) {
        let message = error && error.message ? error.message : 'Unable to access camera or microphone.';
        this.state.call.error = message;
        this.sendCallSignal(peerId, { type: 'error', requestId, message });
        this.endCallSession(true);
        return;
      }
    },
    cancelOutgoingCall: () => {
      if (this.state.call.status !== 'requesting') return;
      let peerId = this.state.call.activePeerId;
      if (peerId) {
        this.sendCallSignal(peerId, { type: 'cancel', requestId: this.state.call.requestId });
      }
      this.endCallSession(false);
    },
    acceptIncomingCall: () => {
      if (this.state.call.status !== 'ringing') return;
      let peerId = this.state.call.incomingPeerId;
      if (!peerId) return;
      let requestId = this.state.call.incomingRequestId;
      this.state.call.requestId = requestId;
      this.state.call.activePeerId = peerId;
      this.sendCallSignal(peerId, { type: 'accept', requestId });
      this.beginCallMediaSession(peerId);
    },
    rejectIncomingCall: () => {
      if (this.state.call.status !== 'ringing') return;
      let peerId = this.state.call.incomingPeerId;
      if (!peerId) return;
      let requestId = this.state.call.incomingRequestId;
      this.sendCallSignal(peerId, { type: 'reject', requestId });
      this.endCallSession(false);
    },
    endActiveCall: () => {
      if (this.state.call.status === 'idle') return;
      let peerId = this.state.call.activePeerId;
      if (peerId) {
        let requestId = this.state.call.requestId || this.state.call.incomingRequestId;
        this.sendCallSignal(peerId, { type: 'end', requestId });
      }
      this.endCallSession(false);
    },
    toggleCallFullscreen: () => {
      this.state.call.fullscreen = !this.state.call.fullscreen;
    },
    bindLocalCallVideo: element => {
      this.bindLocalCallVideoElement(element);
    },
    unbindLocalCallVideo: element => {
      this.releaseLocalCallVideoElement(element);
    },
    bindRemoteCallVideo: element => {
      this.bindRemoteCallVideoElement(element);
    },
    unbindRemoteCallVideo: element => {
      this.releaseRemoteCallVideoElement(element);
    },
    clearCallError: () => {
      this.state.call.error = null;
    },
  };

  flushPendingPings = () => {
    if (!this.soundUnlocked) return;
    while (this.pendingPingCount > 0) {
      this.pendingPingCount -= 1;
      this.performPingPlayback();
    }
  };
};
