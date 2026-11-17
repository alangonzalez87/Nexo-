// This entry point is exclusively for the isolated Railway test image.
// Set these before loading the server so deployment variables cannot enable
// the worker, payments or message processing by accident. The optional
// OpenWA setup mode is separately guarded to QR and status-only operations.
process.env.NEXO_PREVIEW = "true";
process.env.NEXO_REQUIRE_PREVIEW = "true";
process.env.FORCE_SIMULATION = "true";
await import("./server.js");
