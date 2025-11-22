import LoveEngine from '../other/LoveEngine.js';
import RadarEngine from '../other/RadarEngine.js';

export default class App {
  state = {
    get roster() {
      return state.app.love.peers
        .filter(x => !x.location || state.app.radar.distance(x.location) <= Number(this.me.radius))
        .sort((a, b) => {
          if (!a.location && !b.location) return 0;
          if (!a.location) return 1;
          if (!b.location) return -1;
          return state.app.radar.distance(a.location) - state.app.radar.distance(b.location);
        });
    },
  };

  actions = {
    init: async () => {
      this.state.love = new LoveEngine({ appId: 'meateor2' }, 'gaybar');
      this.state.radar = new RadarEngine();
      setInterval(() => this.state.me.location = this.state.radar.location, 1000);
      this.state.me = this.state.love.me;
      Object.assign(this.state.me, {
        displayName: 'You',
        vibe: 'Online',
        age: 18,
        tribe: 'Geek',
        role: 'Vers',
        tagline: `Let's chat!`,
        lookingFor: `Friends & chill`,
        radius: 100,
      });
    },
  };
}
