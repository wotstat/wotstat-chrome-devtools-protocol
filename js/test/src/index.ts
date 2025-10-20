import example1 from "./example1/index.html";
import { serve } from "bun";

const PORT = 3000;

serve({
  port: PORT,
  development: {
    hmr: false,
    console: false,
  },

  routes: {
    "/example1": example1,
  },

  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Upgrade failed", { status: 500 });
  },

  websocket: {
    open(ws) {
      ws.subscribe('messages');
    },
    message(ws, message) {
      ws.publish('messages', message);
    },
  },
});

console.log(`Open example http://localhost:${PORT}/example1`);
console.log(`Open example devtools://devtools/bundled/inspector.html?ws=localhost:3000/devtools`);
