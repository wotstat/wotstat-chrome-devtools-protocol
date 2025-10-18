
import { ChromeDevtoolProtocol } from '../../src/ChromeDevtoolProtocol'

function send(command: any) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(command));
}

const cdp = new ChromeDevtoolProtocol(send)

const ws = new WebSocket('ws://localhost:3000/devtools');
ws.onopen = () => {
  console.log('WebSocket connection established with devtools server');
  ws.send('Hello from client');
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  cdp.onCommand(message);
};