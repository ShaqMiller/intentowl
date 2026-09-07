// Shared, side-effect-free code used by both apps.
//
// M2 adds filter/ + classify/ + scoring.ts, M3 adds digest/. Keep every module
// here pure or clearly I/O-shaped (adapters only) so the filter, scoring and
// classification layers stay unit-testable.
export { loadRootEnv, parseEnv } from "./env.ts";
export * from "./adapters/index.ts";
