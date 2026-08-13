module.exports = {
  apps: [
    {
      name: 'rebazaar-api',
      script: './backend/src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      log_file: './logs/pm2-api.log',
      out_file: './logs/pm2-api-out.log',
      error_file: './logs/pm2-api-err.log',
      merge_logs: true,
      time: true,
      max_memory_restart: '512M',
      restart_delay: 3000,
      min_uptime: '10s',
      max_restarts: 5,
    },
  ],
}
