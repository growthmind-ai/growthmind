/**
 * @growthmind/sdk-js, the event package.
 *
 * This package will own capture, masking, and exclusion, in that order of importance
 * (product decisions):
 *
 * Capture: auto-derived events tied to a line of code, described in plain English,
 *  never a hand-maintained tracking plan.
 * Masking: recordings are masked DOM reconstructions, masked at capture, before
 *  anything leaves the browser. No PII in the stream, provably.
 * Exclusion: internal accounts, bots, E2E runs, staging, and coding agents browsing the
 *  app are excluded automatically and retroactively.
 *
 * Nothing is implemented yet. The package exists so the workspace, docker, and CI shape
 * are proven against the real repo layout before feature code lands. See docs/stack.md,
 * Phase 0.
 */

export const SDK_NAME = "@growthmind/sdk-js";
