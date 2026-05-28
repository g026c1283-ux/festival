/* ========================================================
   体育祭 順番待ちシステム - 共通ロジック
   ======================================================== */

(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG || {};

  // ============================================================
  // ストレージ (1人あたり所要時間、本人特定情報など)
  // ============================================================
  const Storage = {
    getMinutesPerPerson: function () {
      const v = parseFloat(localStorage.getItem('minutesPerPerson'));
      return (isFinite(v) && v > 0) ? v : (CFG.defaultMinutesPerPerson || 3);
    },
    setMinutesPerPerson: function (v) {
      localStorage.setItem('minutesPerPerson', String(v));
    },
    getIdentity: function () {
      try {
        return JSON.parse(localStorage.getItem('identity') || 'null');
      } catch (e) { return null; }
    },
    setIdentity: function (obj) {
      if (obj && (obj.name || obj.studentId)) {
        localStorage.setItem('identity', JSON.stringify(obj));
      } else {
        localStorage.removeItem('identity');
      }
    }
  };

  // ============================================================
  // APIクライアント
  // 標準 fetch 方式 (通常デプロイはCORSヘッダ付きで返る)
  // ============================================================
  const Api = {
    isConfigured: function () {
      return !!(CFG.apiUrl && CFG.apiUrl.length > 0);
    },

    _call: function (action, params) {
      if (!Api.isConfigured()) {
        return Promise.reject(new Error('apiUrl が config.js に設定されていません'));
      }
      var url = CFG.apiUrl + '?action=' + encodeURIComponent(action);
      if (params) {
        Object.keys(params).forEach(function (k) {
          if (params[k] !== undefined && params[k] !== null) {
            url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
          }
        });
      }
      url += '&_=' + Date.now(); // キャッシュ回避

      return fetch(url, { redirect: 'follow' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (json && json.ok === false) {
            throw new Error(json.error || 'API error');
          }
          return json;
        });
    },

    list:     function ()    { return Api._call('list'); },
    call:     function (row) { return Api._call('call',     { row: row }); },
    complete: function (row) { return Api._call('complete', { row: row }); },
    cancel:   function (row) { return Api._call('cancel',   { row: row }); },
    reset:    function (row) { return Api._call('reset',    { row: row }); },
    register: function (data) { return Api._call('register', data); }
  };

  // ============================================================
  // クライアント側バージョン計算 (変更検知用)
  // サーバーにversion機能がなくても動作する
  // ============================================================
  function computeClientVersion(entries) {
    if (!entries || entries.length === 0) return 'empty';
    return entries.map(function (e) {
      return [e.row, e.status || '', e.calledAt || '', e.doneAt || '', e.timestamp || ''].join(',');
    }).join('|');
  }

  // ============================================================
  // 変更検知付きポーリング
  // changedCallback: データに変化があった時のみ呼ばれる
  // tickCallback   : 毎回呼ばれる (接続状態表示用、任意)
  // ============================================================
  function startWatcher(opts) {
    const interval = (opts && opts.interval) || CFG.pollIntervalMs || 4000;
    const onChange = opts && opts.onChange;
    const onError = opts && opts.onError;
    const onTick = opts && opts.onTick;
    let lastVersion = null;
    let timer = null;
    let inflight = false;

    function poll() {
      if (inflight) return;
      inflight = true;
      if (onTick) onTick({ phase: 'start' });
      Api.list().then(function (res) {
        inflight = false;
        var entries = res && res.entries || [];
        var v = computeClientVersion(entries);
        if (v !== lastVersion) {
          lastVersion = v;
          if (onChange) onChange(res);
          if (onTick) onTick({ phase: 'changed', version: v });
        } else {
          if (onTick) onTick({ phase: 'unchanged', version: v });
        }
      }).catch(function (err) {
        inflight = false;
        if (onError) onError(err);
        if (onTick) onTick({ phase: 'error', error: err });
      });
    }

    poll(); // 初回即実行
    timer = setInterval(poll, interval);

    return {
      stop: function () { if (timer) { clearInterval(timer); timer = null; } },
      forceRefresh: function () { lastVersion = null; poll(); },
      pollNow: poll
    };
  }

  // ============================================================
  // 本人特定: 学籍番号 / 名前 / メール のいずれかでマッチ
  // ============================================================
  function findEntriesByIdentity(entries, identity) {
    if (!identity) return [];
    const sid = (identity.studentId || '').trim().toLowerCase();
    const nm  = (identity.name || '').trim().toLowerCase();
    const em  = (identity.email || '').trim().toLowerCase();
    if (!sid && !nm && !em) return [];
    return entries.filter(function (e) {
      if (sid && (e.studentId || '').toLowerCase() === sid) return true;
      if (em  && (e.email || '').toLowerCase() === em)  return true;
      if (nm  && (e.name || '').toLowerCase() === nm)   return true;
      return false;
    });
  }
  // ============================================================
  // データ整形ロジック
  // entries (全件) → 種目ごとのキュー
  // ============================================================
  function buildQueues(entries) {
    const result = {};
    (CFG.events || []).forEach(function (ev) {
      result[ev.name] = {
        config: ev,
        all: [],
        calling: null,
        waiting: [],
        done: [],
        canceled: []
      };
    });

    // 時系列順 (古い順)
    const sorted = entries.slice().sort(function (a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });

    sorted.forEach(function (e) {
      if (!result[e.event]) return; // 未定義の種目はスキップ
      const bucket = result[e.event];
      bucket.all.push(e);
      if (e.status === '完了') {
        bucket.done.push(e);
      } else if (e.status === 'キャンセル') {
        bucket.canceled.push(e);
      } else if (e.status === '呼出中') {
        bucket.calling = e;
      } else {
        bucket.waiting.push(e);
      }
    });

    // 待ち番号 (種目内で1から振り直し: 待機+呼出中+完了の総数で順位を決める)
    Object.keys(result).forEach(function (k) {
      const b = result[k];
      // 「全エントリ中の何番目か」を種目別に付与
      b.all.forEach(function (e, i) { e.queueNumber = i + 1; });
    });

    return result;
  }

  // ============================================================
  // ユーティリティ
  // ============================================================
  function formatJpDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatHm(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 設定未完了アラート
  function renderConfigAlertIfNeeded(containerSelector) {
    if (Api.isConfigured()) return false;
    const el = document.querySelector(containerSelector);
    if (!el) return true;
    el.innerHTML =
      '<div class="config-alert">' +
      '<strong>初期設定が必要です。</strong><br>' +
      '<code>config.js</code> の <code>apiUrl</code> に、デプロイした Apps Script のウェブアプリURLを設定してください。' +
      '<br>詳しい手順は <a href="SETUP.md" target="_blank">SETUP.md</a> を参照してください。' +
      '</div>';
    return true;
  }

  // 公開
  global.APP = {
    config: CFG,
    Storage: Storage,
    Api: Api,
    startWatcher: startWatcher,
    findEntriesByIdentity: findEntriesByIdentity,
    buildQueues: buildQueues,
    formatJpDateTime: formatJpDateTime,
    formatHm: formatHm,
    escapeHtml: escapeHtml,
    renderConfigAlertIfNeeded: renderConfigAlertIfNeeded,

    // 隠しコマンド: 'a'を3回押すと admin.html に遷移
    initHiddenAdminAccess: function () {
      var count = 0;
      var timer = null;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'a' || e.key === 'A') {
          count++;
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { count = 0; }, 1500);
          if (count >= 3) {
            count = 0;
            location.href = 'admin.html';
          }
        } else {
          count = 0;
        }
      });
    }
  };
})(window);
