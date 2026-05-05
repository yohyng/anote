const CACHE_NAME = "pencil-room-v2";
const SHARE_CACHE = "pencil-room-shared-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((response) => response || caches.match("/index.html")))
  );
});

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
