/* eslint-disable no-undef */
var VERSION = new URL(self.location).searchParams.get("v") || "dev";
importScripts("/sw-strategy.js?v=" + VERSION);

var STATIC_CACHE = "cix-static-" + VERSION;
var PAGES_CACHE = "cix-pages-" + VERSION;
// 字体故意不带版本号——字体文件几年不变，每次部署清空是对用户流量的浪费，
// 在东南亚移动网络下这个浪费是有感的
var FONTS_CACHE = "cix-fonts";

var LOCALES = ["zh-CN", "en-US", "ms-MY"];
var PRECACHE = LOCALES.map(function (l) {
  return "/" + l + "/offline";
}).concat(["/icons/icon-192.png", "/icons/icon-512.png"]);

self.addEventListener("install", function (event) {
  // 只预缓存一小组已知固定 URL。不做构建产物清单：用户必须先访问过网站
  // 才可能安装它，届时运行时缓存已经是热的。
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

self.addEventListener("activate", function (event) {
  var keep = [STATIC_CACHE, PAGES_CACHE, FONTS_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (name.indexOf("cix-") === 0 && keep.indexOf(name) === -1) {
              return caches.delete(name);
            }
            return null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "PURGE_PAGES") {
    // 登出时清掉渲染好的 HTML——仪表盘、订单页含用户数据，
    // 共用手机的场景下这是实际的隐私问题
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var strategy = self.shouldCache(request.url, request.mode, self.location.origin);

  if (strategy === "never" || strategy === "passthrough") return;

  if (strategy === "static" || strategy === "fonts-cache") {
    event.respondWith(
      cacheFirst(request, strategy === "static" ? STATIC_CACHE : FONTS_CACHE)
    );
    return;
  }

  if (strategy === "fonts-swr") {
    event.respondWith(staleWhileRevalidate(request, FONTS_CACHE));
    return;
  }

  if (strategy === "pages") {
    event.respondWith(networkFirst(request));
  }
});

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(cacheName).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.match(request).then(function (hit) {
    var network = fetch(request)
      .then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(cacheName).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return hit;
      });
    return hit || network;
  });
}

function networkFirst(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(PAGES_CACHE).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        return caches.match(offlineUrlFor(request.url)).then(function (fallback) {
          return (
            fallback ||
            new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        });
      });
    });
}

function offlineUrlFor(rawUrl) {
  var segments = new URL(rawUrl).pathname.split("/").filter(Boolean);
  var locale = LOCALES.indexOf(segments[0]) !== -1 ? segments[0] : "en-US";
  return "/" + locale + "/offline";
}
