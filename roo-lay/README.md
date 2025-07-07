npm install

npm run esbuild-prod
vsce package

# install vsce
npm install -g vsce

# stop bot
powershell -Command "Stop-Process -Name node -Force"

# deploy commands
npm run deploy