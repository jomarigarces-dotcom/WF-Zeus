/**
 * convex-client.js
 * Initializes the Convex client for WF Zeus Transition.
 * 
 * HOW TO CONFIGURE:
 * 1. Run `npx convex dev` from the Transition folder
 * 2. Copy the deployment URL shown (e.g. https://xxxx.convex.cloud)
 * 3. Replace CONVEX_URL below with your actual deployment URL
 */

// ============================================================
// CONFIGURE THIS: Paste your Convex deployment URL here
// ============================================================
const CONVEX_URL = "https://joyous-ant-26.convex.cloud";
// ============================================================

import { ConvexClient } from "https://cdn.jsdelivr.net/npm/convex@1.13.0/browser/+esm";

export const convex = new ConvexClient(CONVEX_URL);

/**
 * Helper: Run a Convex query and return the result as a Promise.
 * Use for one-time data fetches (equivalent to google.script.run.withSuccessHandler).
 */
export async function runQuery(queryFn, args = {}) {
  return await convex.query(queryFn, args);
}

/**
 * Helper: Run a Convex mutation and return the result.
 */
export async function runMutation(mutationFn, args = {}) {
  return await convex.mutation(mutationFn, args);
}

/**
 * Helper: Watch a Convex query for changes.
 * Returns an unsubscribe function.
 */
export function watchQuery(queryFn, args = {}, onUpdate, onError) {
  return convex.onUpdate(queryFn, args, onUpdate, onError);
}
/**
 * Helper: Run a Convex action and return the result.
 */
export async function runAction(actionFn, args = {}) {
  return await convex.action(actionFn, args);
}
