@echo off
setlocal
cd /d "C:\repos\ryo_claude\ryo-9router\9router"
call npm run dev -- -p 20128 -H 127.0.0.1
