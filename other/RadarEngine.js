export default class RadarEngine {
  async start() {
    await new Promise((pres, prej) => navigator.geolocation.getCurrentPosition(pres, prej, { enableHighAccuracy: true }));
    this.interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        pos => { this.location = pos; d.update() },
        () => { this.location = null; d.update() },
        { enableHighAccuracy: true },
      );
    }, 1000);
  }

  stop() {
    clearInterval(this.interval);
    this.location = null;
    d.update();
  }

  distance(other) {
    if (!this.location || !other) return null;
    const lat1 = this.location.coords.latitude;
    const lon1 = this.location.coords.longitude;
    const lat2 = other.coords.latitude;
    const lon2 = other.coords.longitude;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
};
