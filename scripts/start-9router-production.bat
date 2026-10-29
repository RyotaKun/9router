@echo off
setlocal
set "PORT=20128"
set "HOSTNAME=127.0.0.1"
set "NODE_ENV=production"
set "ENABLE_REQUEST_LOGS=false"
set "OBSERVABILITY_ENABLED=false"
cd /d "C:\repos\ryo_claude\ryo-9router\9router"
node --dns-result-order=ipv4first --max-old-space-size=512 --env-file=.env .next-image-ui\standalone\custom-server.js
