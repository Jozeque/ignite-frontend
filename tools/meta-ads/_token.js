'use strict';
// Returns the Meta access token: env var first, else the gitignored .token file.
const fs = require('fs');
const path = require('path');
module.exports = function loadToken() {
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN;
  try {
    return fs.readFileSync(path.join(__dirname, '.token'), 'utf8').trim();
  } catch (e) {
    return null;
  }
};
