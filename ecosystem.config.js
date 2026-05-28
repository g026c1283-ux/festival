module.exports = {
  apps: [{
    name: 'festival',
    script: 'server/server.js',
    env: {
      PORT: '8000'
    },
    autorestart: true,
    max_restarts: 5,
    restart_delay: 3000
  }]
};
