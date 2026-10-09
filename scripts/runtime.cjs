// Shared by all performance runners. No user-specific installation paths.
module.exports = require(process.env.PLAYWRIGHT_MODULE || "playwright");
