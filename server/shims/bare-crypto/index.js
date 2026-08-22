// wdk-secret-manager@1.0.0-beta.3 requires `bare-crypto`, which only loads
// inside the Bare runtime (its binding chain calls require.addon). The one
// function the secret manager uses is pbkdf2Sync, and node:crypto's is
// signature-compatible — so under Node we alias the whole module to it.
module.exports = require('node:crypto')
