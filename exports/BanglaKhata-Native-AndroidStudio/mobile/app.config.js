// Public-only build configuration; Expo bundles these values into the APK.
// No server-side credentials, session tokens or signing material belong here.
const config = require('./public-build.json');
for (const [key, value] of Object.entries(config)) {
  if (!process.env[key]) process.env[key] = value;
}
module.exports = require('./app.json');