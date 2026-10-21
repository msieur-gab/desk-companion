// What the phone keeps (IndexedDB): articles, waiting links, files shared to the desk, decks (previews and
// notes), voice memos, and a few settings. Opened by the page (app.js) and by the service worker (sw.js),
// which catches the files shared from other apps: the two must agree on the stores, so they live here once.
const db = new Promise((ok, no) => {
  const r = indexedDB.open("desk", 4);
  r.onupgradeneeded = () => {
    const have = r.result.objectStoreNames, make = (name, how) => have.contains(name) || r.result.createObjectStore(name, how);
    make("articles", { keyPath: "file" });
    make("waiting", { keyPath: "url" });
    make("settings");
    make("decks", { keyPath: "name" });
    make("memos", { keyPath: "at" }); // { at: when it began (ms), seconds, blob, keep: for the desk, why: refused by it }
    make("files", { keyPath: "id" }); // { id, name, type, size, modified (ms), blob, at: when shared, why: refused by the desk }
  };
  r.onsuccess = () => {
    r.result.onversionchange = () => r.result.close(); // a newer companion opened it: let it upgrade
    ok(r.result);
  };
  r.onerror = () => no(r.error);
});
const store = async (name, mode, work) => {
  const t = (await db).transaction(name, mode), asked = work(t.objectStore(name));
  return new Promise((ok, no) => { t.oncomplete = () => ok(asked?.result); t.onerror = () => no(t.error); });
};
const all = name => store(name, "readonly", s => s.getAll());
const put = (name, value, key) => store(name, "readwrite", s => s.put(value, key));
const drop = (name, key) => store(name, "readwrite", s => s.delete(key));
const setting = key => store("settings", "readonly", s => s.get(key));
