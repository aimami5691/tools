/* 라이프나침반 안심 웹 도구 공통 스크립트
   - 모든 처리는 이 브라우저 안에서만 이루어집니다. 네트워크로 파일을 보내지 않습니다. */
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }

  function bytes(n) {
    if (n === 0) return '0 B';
    if (!n && n !== 0) return '-';
    var k = 1024, units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(n) / Math.log(k));
    if (i < 0) i = 0;
    if (i > units.length - 1) i = units.length - 1;
    var v = n / Math.pow(k, i);
    var d = v >= 100 || i === 0 ? 0 : (v >= 10 ? 1 : 2);
    return v.toFixed(d) + ' ' + units[i];
  }

  function download(blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function baseName(name) {
    var s = String(name || 'file');
    var i = s.lastIndexOf('.');
    return i > 0 ? s.slice(0, i) : s;
  }
  function extName(name) {
    var s = String(name || '');
    var i = s.lastIndexOf('.');
    return i > 0 ? s.slice(i + 1).toLowerCase() : '';
  }
  function outName(name, suffix, ext) {
    var b = baseName(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    return b + (suffix || '') + '.' + ext;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ img: img, url: url, w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('이미지를 열 수 없습니다'));
      };
      img.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { resolve(b); }, type, quality);
      } else {
        var data = canvas.toDataURL(type, quality);
        var bin = atob(data.split(',')[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: type }));
      }
    });
  }

  function blobBuf(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /* ── ZIP (무압축 저장 방식) ─────────────────────────── */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    var time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    var date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time: time, date: date };
  }

  /* entries: [{name, data:Uint8Array}] → Blob(zip) */
  function zip(entries) {
    var enc = new TextEncoder();
    var now = dosTime(new Date());
    var parts = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (e) {
      var nameU8 = enc.encode(e.name);
      var data = e.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameU8.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);          // UTF-8 파일명
      dv.setUint16(8, 0, true);               // store
      dv.setUint16(10, now.time, true);
      dv.setUint16(12, now.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameU8.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameU8, 30);

      parts.push(local, data);

      var cd = new Uint8Array(46 + nameU8.length);
      var cdv = new DataView(cd.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, now.time, true);
      cdv.setUint16(14, now.date, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameU8.length, true);
      cdv.setUint32(42, offset, true);
      cd.set(nameU8, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  function uniqueName(used, name) {
    if (!used[name]) { used[name] = 1; return name; }
    var m = name.match(/^(.*?)(\.[^.]*)?$/);
    var stem = m[1], ext = m[2] || '';
    var i = 2;
    var cand;
    do { cand = stem + '_' + i + ext; i++; } while (used[cand]);
    used[cand] = 1;
    return cand;
  }

  function pickFiles(input) {
    return Array.prototype.slice.call(input.files || []);
  }

  function acceptImages(files) {
    return files.filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name); });
  }

  function tooBig(files, limitMB) {
    var lim = (limitMB || 24) * 1024 * 1024;
    var big = files.filter(function (f) { return f.size > lim; });
    return big;
  }

  function trigger(el, evt) {
    var e = document.createEvent('HTMLEvents');
    e.initEvent(evt, true, true);
    el.dispatchEvent(e);
  }

  function progress(text, id) {
    var el = $(id || 'progress-line');
    if (el) { el.textContent = text || ''; el.hidden = !text; }
  }

  global.Safe = {
    $: $, qsa: qsa, toast: toast, bytes: bytes, download: download,
    baseName: baseName, extName: extName, outName: outName,
    loadImage: loadImage, canvasBlob: canvasBlob, blobBuf: blobBuf,
    zip: zip, crc32: crc32, uniqueName: uniqueName,
    pickFiles: pickFiles, acceptImages: acceptImages, tooBig: tooBig,
    trigger: trigger, progress: progress
  };
})(window);
