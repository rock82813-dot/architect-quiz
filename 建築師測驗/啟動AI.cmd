@echo off
setlocal
cd /d "%~dp0"
set "QUIZ_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%QUIZ_NODE%" set "QUIZ_NODE=node.exe"
set "ARCHITECT_QUIZ_PORT=8765"
echo Keep this window open while using AI question generation.
echo Open http://127.0.0.1:8765/ in your browser.
"%QUIZ_NODE%" "%~dp0server.cjs"
pause
