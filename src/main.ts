/**
 * Mirror Trace — entry point
 *
 * Imports the main application class and boots it when the DOM is ready.
 * This file is kept intentionally thin; all application logic lives in
 * src/app.ts and its supporting modules.
 */

import { MirrorTraceApp } from './app';

/* Boot */
document.addEventListener('DOMContentLoaded', () => {
  const app = new MirrorTraceApp();

  /* Expose newCurve() to dev-tools / future UI button */
  (window as unknown as Record<string, unknown>).__mirrorTrace = app;
});
