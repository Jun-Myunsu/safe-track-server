const SafeTrackServer = require('./app');

const server = new SafeTrackServer();
server.start().catch(console.error);