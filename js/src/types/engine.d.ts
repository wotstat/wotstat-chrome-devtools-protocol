export { };

declare global {
  interface Engine {
    whenReady: Promise<void>;
    call: (method: string, ...args) => Promise<any>;
    on: (event: string, callback: (...args) => void) => void;
    off: (event: string, callback: (...args) => void) => void;
  }

  interface Window {
    engine: Engine;
  }

  const engine: Engine;
}