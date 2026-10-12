@echo off
echo ========================================
echo Starting Fabric Fault Detection System
echo ========================================
echo.

echo Starting FastAPI Backend...
start cmd /k "cd backend && python run.py"

timeout /t 3 /nobreak >nul

echo Starting React Frontend...
start cmd /k "cd frontend && npm start"

echo.
echo ========================================
echo Both servers are starting...
echo Backend: http://localhost:5000
echo Frontend: http://localhost:3000
echo ========================================
