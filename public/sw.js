const APP_VERSION = "v5.5.0";
const CACHE_NAME = `pencil-room-app-${APP_VERSION}`;
const SHARE_CACHE = "pencil-room-shared-v5";
const APP_CACHE_PREFIX = "pencil-room-app-";
const LEGACY_APP_CACHES = new Set([
  "pencil-room-v1",
  "pencil-room-v2",
  "pencil-room-v3",
  "pencil-room-v4",
  "pencil-room-v5",
  "pencil-room-app-v5.2.0",
  "pencil-room-app-v5.3.0",
  "pencil-room-app-v5.4.0"
]);

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/version.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.map((name) => {
            const isOldVersionedAppCache = name.startsWith(APP_CACHE_PREFIX) && name !== CACHE_NAME;
            const isLegacyAppCache = LEGACY_APP_CACHES.has(name);
            if (isOldVersionedAppCache || isLegacyAppCache) return caches.delete(name);
            return Promise.resolve(false);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (url.pathname === "/shared/latest") {
    event.respondWith(readSharedLatest());
    return;
  }

  if (url.pathname.startsWith("/shared/file/")) {
    event.respondWith(readSharedFile(url.pathname));
    return;
  }

  if (url.pathname === "/version.json") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(
        () => new Response(JSON.stringify({ version: APP_VERSION, offline: true }), { headers: { "Content-Type": "application/json" } })
      )
    );
    return;
  }

  if (event.request.method !== "GET") return;

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("/index.html");
    throw error;
  }
}

async function handleShareTarget(request) {
  const formData = await request.formData();
  const files = formData.getAll("images").filter((item) => item && item.name && item.type && item.type.startsWith("image/"));
  const cache = await caches.open(SHARE_CACHE);
  const entries = [];

  for (const file of files.slice(0, 4)) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "shared-image.png";
    const path = `/shared/file/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
    await cache.put(path, new Response(file, { headers: { "Content-Type": file.type || "image/png" } }));
    entries.push({ url: path, name: safeName, type: file.type || "image/png" });
  }

  await cache.put(
    "/shared/latest",
    new Response(JSON.stringify({ createdAt: Date.now(), entries }), {
      headers: { "Content-Type": "application/json" },
    })
  );

  return Response.redirect("/?shared=1", 303);
}

async function readSharedLatest() {
  const cache = await caches.open(SHARE_CACHE);
  const response = await cache.match("/shared/latest");
  return response || new Response(JSON.stringify({ entries: [] }), { headers: { "Content-Type": "application/json" } });
}

async function readSharedFile(pathname) {
  const cache = await caches.open(SHARE_CACHE);
  const response = await cache.match(pathname);
  return response || new Response("Not found", { status: 404 });
}
