/**
 * Browser-side incremental slices for the gateway replacement bundle.
 *
 * Inlined into the built `lib/client.js` by `scripts/build-client.mjs`
 * (self-maintained bundle build). The official
 * `@deepseek-ai/dsh-api-gateway` browser module is inlined verbatim (never
 * hand-modified) and re-registered; this module wraps its exports and exposes
 * a `ctx.sessionChannel` channel client helper that invokes channel methods
 * over the connection RPC carrier (`/channel`). Client side only re-validates
 * shapes; it never performs redaction.
 *
 * @module
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-plugin-api-session-channel-gateway',
  factory: (require) => {
    var official = require('@deepseek-ai/dsh-api-gateway');
    var module = { exports: {} };
    var exports = module.exports;

    var CHANNEL_METHODS = ['open', 'subscribe', 'ack', 'resume', 'revoke'];

    function createChannelClient(connection) {
      return Object.freeze({
        call: function (method, args, signal) {
          return Promise.resolve().then(function () {
            if (CHANNEL_METHODS.indexOf(method) < 0) {
              return { ok: false, error: { code: 'invalid-input', message: 'unknown channel method: ' + method, details: {} } };
            }
            if (!connection || typeof connection.rpc.call !== 'function') {
              return { ok: false, error: { code: 'transport-unavailable', message: 'connection carrier is unavailable', details: {} } };
            }
            return connection.rpc.call('/channel', 'sessionChannel/' + method, { args: args || {} }, signal);
          });
        },
      });
    }

    exports.apply = function (ctx) {
      official.apply(ctx);
      try {
        var connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection;
        var channelClient = createChannelClient(connection);
        Object.defineProperty(ctx, 'sessionChannel', { value: channelClient, enumerable: false, configurable: true });
      } catch (_) {
        // The channel client is best-effort; the official remote surface stays intact.
      }
    };
    exports.inject = official.inject;
    return module.exports;
  },
});