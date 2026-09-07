// Shared, side-effect-free code used by both apps.
//
// Keep every module
// here pure or clearly I/O-shaped (adapters only) so the filter, scoring and
// classification layers stay unit-testable.
export { loadRootEnv, parseEnv } from "./env.ts";
export * from "./adapters/index.ts";
export * from "./filter/rules.ts";
export * from "./classify/index.ts";
export * from "./scoring.ts";
export * from "./digest/index.ts";
