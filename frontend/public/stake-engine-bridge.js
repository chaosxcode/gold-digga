/**
 * Stake Engine RGS bridge — vanilla IIFE, loaded BEFORE the game module.
 *
 * Reads `sessionID` + `rgs_url` from the launch query string.
 *  - Both present  -> Stake-launch mode: authenticates against the RGS.
 *  - Either absent -> local-preview mode: the game runs on its own mock math.
 *
 * FAIL CLOSED: in Stake-launch mode a failed authenticate must surface an error
 * and block entry — never silently fall back to preview.
 *
 * Money moves in MICRO-units on the wire (display value x 1e6).
 * The wire `payoutMultiplier` is a DIRECT multiplier (already /100 vs the books).
 */
(function () {
  'use strict';

  var qs = new URLSearchParams(window.location.search);
  var sessionID = qs.get('sessionID');
  var rgsUrl = qs.get('rgs_url'); // MUST be read from the query every launch
  var isStake = !!(sessionID && rgsUrl);

  function base() {
    var u = rgsUrl || '';
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '');
  }

  function post(path, body) {
    return fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ sessionID: sessionID }, body || {})),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) {
          var err = new Error((j && j.message) || 'RGS error');
          err.code = j && j.error;
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  var readyResolve, readyReject;
  var ready = new Promise(function (res, rej) {
    readyResolve = res;
    readyReject = rej;
  });

  var bridge = {
    isStake: isStake,
    sessionID: sessionID,
    rgsUrl: rgsUrl,
    query: qs,
    ready: ready,
    auth: null,

    authenticate: function () {
      var lang = qs.get('lang') || 'en';
      if (lang === 'br') lang = 'pt';
      return post('/wallet/authenticate', { language: lang }).then(function (j) {
        bridge.auth = j;
        return j;
      });
    },

    /**
     * amount: BASE bet in micro-units (the RGS applies the mode's cost multiplier).
     * mode: EXACT UPPERCASE mode name from the published math package.
     * Canonical endpoint first; fall back to bare /play ONLY on a definitive 404.
     */
    play: function (amount, mode) {
      return post('/wallet/play', { amount: amount, mode: mode }).catch(function (e) {
        if (e && e.status === 404) return post('/play', { amount: amount, mode: mode });
        throw e;
      });
    },

    endRound: function () {
      return post('/wallet/end-round', {});
    },

    balance: function () {
      return post('/wallet/balance', {});
    },

    /** Mid-round replay checkpoint (resume-at-the-right-point on disconnect). */
    event: function (name) {
      return post('/bet/event', { event: name });
    },

    /** Public GET, no auth — the mandatory replay-URL feature. */
    fetchReplay: function (game, version, mode, eventId) {
      return fetch(
        base() + '/bet/replay/' + game + '/' + version + '/' + mode + '/' + eventId
      ).then(function (r) {
        if (!r.ok) throw new Error('Replay fetch failed: ' + r.status);
        return r.json();
      });
    },
  };

  // Replay links are public and session-free: even if a stray sessionID rides
  // the URL, a replay launch must make ZERO session calls.
  var isReplay = (qs.get('replay') || '').toLowerCase() === 'true';

  if (isStake && !isReplay) {
    bridge
      .authenticate()
      .then(function (j) {
        readyResolve(j);
        window.dispatchEvent(new CustomEvent('stake:authenticated', { detail: j }));
      })
      .catch(function (e) {
        readyReject(e);
        window.dispatchEvent(new CustomEvent('stake:auth-failed', { detail: e }));
      });
  } else {
    readyResolve(null);
  }

  window.StakeEngineBridge = bridge;
})();
