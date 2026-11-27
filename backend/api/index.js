// Vercel entry point: every request to /api/* is routed here (see ../vercel.json),
// and Vercel treats this file's default export as the serverless function. Exporting
// the Express app directly works because Express apps are callable as
// `(req, res) => {...}`, which is exactly what Vercel's Node runtime expects.
module.exports = require('../server.js');
