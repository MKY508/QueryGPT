import { vi } from "vitest";

// Only models native open/close state. Real focus/inertness needs browser checks.
export function mockSemanticDialogs() {
  const methods = ["show", "showModal", "close"] as const;
  const descriptors = methods.map(method => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method));
  for (const method of methods) Object.defineProperty(HTMLDialogElement.prototype, method, {
    configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = method !== "close"; }),
  });
  return () => methods.forEach((method, index) => {
    const descriptor = descriptors[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  });
}

export function mockSemanticWidth(initial: boolean) {
  let wide = initial;
  const listeners = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({
    get matches() { return wide; }, media: query, onchange: null,
    addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
  return { set: (value: boolean) => { wide = value; listeners.forEach(notify => notify()); }, listeners };
}
