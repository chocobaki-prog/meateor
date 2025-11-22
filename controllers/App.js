import Engine from '../other/engine.js';

export default class App {
  state = {
    me: {
      displayName: 'You',
      vibe: 'Online',
      age: 27,
      tribe: 'Geek',
      role: 'Bottom',
      tagline: `Your cute tranny succubus!`,
      lookingFor: `FUUUUCCCCKKK!!!`,
      location: 'Somewhere',
    },
  };

  actions = {
    init: async () => {
      this.state.eng = new Engine('lobby', { appId: 'meateor2' });
      post('app.beacon');
    },

    beacon: () => {
      this.state.eng.setProfile(this.state.me);
      setTimeout(() => post('app.beacon'), 2000);
    },

    useGeolocation: async () => {
      let res = await this.state.eng.requestLocationPermission();
      if (!res) throw new Error(`Failed to setup GPS`);
    },
  };
}
