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
  };
}
