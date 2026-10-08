export const RECONNECT_HINT = "Reload this page to reconnect Xivary.";

/** A dead content-script context cannot reconnect until the document reloads. */
export function isInvalidatedContext(error) {
  return /\bextension context invalidated\b/i.test(error?.message ?? "");
}

export function contentConnection(runtime, onUnavailable) {
  let available = true;
  return {
    get available() { return available; },
    async sendMessage(message) {
      if (!available) throw new Error(RECONNECT_HINT);
      try { return await runtime.sendMessage(message); }
      catch (error) {
        if (!isInvalidatedContext(error)) throw error;
        if (available) {
          available = false;
          console.warn("Xivary content context is unavailable; reload the page.", error);
          onUnavailable();
        }
        throw new Error(RECONNECT_HINT);
      }
    },
  };
}
