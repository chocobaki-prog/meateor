import LoveEngine from '../other/LoveEngine.js';
import RadarEngine from '../other/RadarEngine.js';

export default class App {
  profileFields = ['displayName', 'vibe', 'age', 'tribe', 'role', 'tagline', 'lookingFor', 'radius', 'photoUrl'];

  state = {
    profileCollapsed: false,
    chat: {
      openPeerId: null,
      messages: {},
      drafts: {},
      unread: {},
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

  updateCollapsedFromProfile = () => {
    this.state.profileCollapsed = this.isProfileComplete(this.state.me);
  };

  ensureChatContainers = peerId => {
    if (!peerId) return;
    if (!this.state.chat.messages[peerId]) this.state.chat.messages[peerId] = [];
    if (this.state.chat.drafts[peerId] === undefined) this.state.chat.drafts[peerId] = '';
    if (this.state.chat.unread[peerId] === undefined) this.state.chat.unread[peerId] = 0;
  };

  appendChatMessage = (peerId, message) => {
    if (!peerId || !message) return;
    this.ensureChatContainers(peerId);
    this.state.chat.messages[peerId].push(message);
  };

  handleIncomingChat = (peerId, payload) => {
    if (!peerId || !payload) return;
    let text = typeof payload.text === 'string' ? payload.text : '';
    if (!text.trim()) return;
    let timestamp = payload.timestamp || Date.now();
    this.appendChatMessage(peerId, { direction: 'in', text, timestamp });
    if (this.state.chat.openPeerId !== peerId) {
      let currentUnread = this.state.chat.unread[peerId] || 0;
      this.state.chat.unread[peerId] = currentUnread + 1;
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
      this.updateCollapsedFromProfile();
      this.state.initialized = true;
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
      this.appendChatMessage(peerId, { direction: 'out', text, timestamp });
      this.state.chat.drafts[peerId] = '';
      if (this.state.love && this.state.love.sendDirectMessage) {
        this.state.love.sendDirectMessage({ text, timestamp }, peerId);
      }
    },
    closeChat: () => {
      this.state.chat.openPeerId = null;
    },
  };
}
