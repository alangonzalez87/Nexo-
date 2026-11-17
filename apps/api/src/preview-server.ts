// This entry point is exclusively for the isolated Railway test image.
// Set these before loading the server so deployment variables cannot enable
// the worker, live integrations or mutating API routes by accident.
process.env.NEXO_PREVIEW = "true";
process.env.NEXO_REQUIRE_PREVIEW = "true";
process.env.FORCE_SIMULATION = "true";
await import("./server.js");
