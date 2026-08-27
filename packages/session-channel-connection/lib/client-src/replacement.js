/**
 * Browser-side incremental slices for the connection replacement bundle.
 *
 * Inlined into the built `lib/client.js` by `scripts/build-client.mjs`
 * (self-maintained bundle build). The official
 * `@deepseek-ai/dsh-client-connection` browser module is inlined verbatim
 * (never hand-modified) and re-registered; this module wraps its exports and
 * attaches the transport negotiation, connection-layer channel fencing, and
 * carrier resume re-attach slices to the provided connection service.
 *
 * @module
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-plugin-api-session-channel-connection',
  factory: (require) => {
    var official = require('@deepseek-ai/dsh-client-connection');
    var module = { exports: {} };
    var exports = module.exports;

    var TRANSPORTS = ['websocket', 'sse', 'polling', 'loopback'];

    function isTransport(value) {
      return TRANSPORTS.indexOf(value) >= 0;
    }

    function createTransportNegotiation(advertised, authorized) {
      var advertisedSet = {};
      var authorizedSet = {};
      for (var i = 0; i < advertised.length; i += 1) {
        if (isTransport(advertised[i])) advertisedSet[advertised[i]] = true;
      }
      for (var j = 0; j < authorized.length; j += 1) {
        if (isTransport(authorized[j])) authorizedSet[authorized[j]] = true;
      }
      function negotiated() {
        return TRANSPORTS.filter(function (name) {
          return advertisedSet[name] === true && authorizedSet[name] === true;
        });
      }
      return Object.freeze({
        advertised: function () { return TRANSPORTS.filter(function (name) { return advertisedSet[name] === true; }); },
        authorized: function () { return TRANSPORTS.filter(function (name) { return authorizedSet[name] === true; }); },
        negotiated: negotiated,
        canNegotiate: function (transport) { return isTransport(transport) && negotiated().indexOf(transport) >= 0; },
      });
    }

    function createFencingTable() {
      var bindings = {};
      return Object.freeze({
        bind: function (channelId, generation) {
          if (typeof channelId !== 'string' || channelId.length === 0) return false;
          if (typeof generation !== 'string' || generation.length === 0) return false;
          bindings[channelId] = { generation: generation };
          return true;
        },
        isCurrent: function (channelId, generation) {
          var binding = bindings[channelId];
          if (!binding) return false;
          return binding.generation === generation;
        },
        drop: function (channelId) { return delete bindings[channelId]; },
        snapshot: function () {
          var out = {};
          var keys = Object.keys(bindings);
          for (var i = 0; i < keys.length && i < 1000; i += 1) {
            out[keys[i]] = bindings[keys[i]].generation;
          }
          return out;
        },
      });
    }

    function createResumePrimitive() {
      return Object.freeze({
        reattach: function (connectionGeneration, signal) {
          return Promise.resolve().then(function () {
            if (typeof connectionGeneration !== 'string' || connectionGeneration.length === 0) {
              return { ok: false, error: { code: 'invalid-input', message: 'connection generation must be a non-empty string', details: {} } };
            }
            if (signal && signal.aborted === true) {
              return { ok: false, error: { code: 'aborted', message: 'reattach aborted by caller', details: {} } };
            }
            return { ok: true, carrier: { connectionGeneration: connectionGeneration } };
          });
        },
      });
    }

    function readConfig(ctx) {
      try {
        var entry = ctx && ctx.fiber && ctx.fiber.entry;
        return (entry && entry.options && entry.options.config) || {};
      } catch (_) {
        return {};
      }
    }

    exports.AbstractApiClient = official.AbstractApiClient;
    exports.RpcId = official.RpcId;
    exports.inject = official.inject;
    exports.transportError = official.transportError;
    exports.apply = function (ctx) {
      official.apply(ctx);
      try {
        var connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection;
        if (connection) {
          var config = readConfig(ctx);
          var transport = createTransportNegotiation(
            config.advertisedTransports || TRANSPORTS,
            config.authorizedTransports || [],
          );
          var fencing = createFencingTable();
          var resume = createResumePrimitive();
          Object.defineProperty(connection, 'transport', { value: transport, enumerable: false, configurable: false });
          Object.defineProperty(connection, 'fencing', { value: fencing, enumerable: false, configurable: false });
          Object.defineProperty(connection, 'resume', { value: resume, enumerable: false, configurable: false });
        }
      } catch (_) {
        // Slices are best-effort on the browser side; the official surface stays intact.
      }
    };
    return module.exports;
  },
});