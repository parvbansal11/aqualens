import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverMock,
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () =>
    new Proxy(
      {
        measureText: () => ({ width: 20 }),
      },
      {
        get(target, property) {
          if (property in target) return target[property as keyof typeof target];
          return () => undefined;
        },
        set() {
          return true;
        },
      },
    ),
});

/* jsdom under recent Node can expose a `localStorage` global that throws unless
 * the runtime was started with --localstorage-file. The app already treats
 * storage as optional (see readStored/writeStored), but the reconnect tests
 * need a working store, so a memory-backed one is installed when the real one
 * is unusable. */
function installMemoryStorage() {
  const store = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", { value: memory, configurable: true, writable: true });
}

try {
  const probe = "__sagardrishti_storage_probe__";
  window.localStorage.setItem(probe, "1");
  window.localStorage.removeItem(probe);
} catch {
  installMemoryStorage();
}
if (!window.localStorage) installMemoryStorage();

/* vitest runs without `globals`, so Testing Library's automatic cleanup does not
 * install itself. Without this, one test's DOM leaks into the next and role
 * queries start matching two shells. */
afterEach(() => {
  cleanup();
});
