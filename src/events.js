const EventEmitter = require('events');

class AppEvents extends EventEmitter {}
const appEvents = new AppEvents();

// Naikkan limit listener agar tidak ada memory leak warning saat banyak admin terkoneksi
appEvents.setMaxListeners(100);

module.exports = appEvents;
