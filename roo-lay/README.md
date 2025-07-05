npm run esbuild-prod
vsce package

powershell -Command "Stop-Process -Name node -Force"