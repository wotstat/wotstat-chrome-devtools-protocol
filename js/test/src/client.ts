
import { ChromeDevtoolProtocol } from '../../src/ChromeDevtoolProtocol'

function send(command: any) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(command));
}

let cdp: ChromeDevtoolProtocol | null = null;

const ws = new WebSocket('ws://localhost:3000/devtools');
ws.onopen = () => {
  cdp = new ChromeDevtoolProtocol(send);
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  cdp?.onCommand(message);
}
ws.onclose = () => {
  cdp?.dispose();
  cdp = null;
}