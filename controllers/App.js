import LoveEngine from '../other/LoveEngine.js';
import RadarEngine from '../other/RadarEngine.js';

export default class App {
  state = {
    get roster() { return state.app.love.peers.filter(x => state.app.radar.distance(x.location) <= Number(this.me.radius)) },
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
