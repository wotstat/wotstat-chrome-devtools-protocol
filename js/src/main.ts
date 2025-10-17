import { ModelObserver } from 'gameface:model';
import { ChromeDevtoolProtocol } from './ChromeDevtoolProtocol.ts'

type Model = {
  request: string | null;
  requestReceived: () => void;
  sendCommand: (params: { command: string }) => void;
}

const model = ModelObserver<Model>('WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW');

console.error("ModelObserver created", model)

const cdp = new ChromeDevtoolProtocol((command) => {
  model.model?.sendCommand({ command: JSON.stringify(command) });
});

function modelUpdated() {
  if (!model.model?.request) return;
  const { request } = JSON.parse(model.model.request);

  model.model.requestReceived();
  cdp.onCommand(request);
}

engine.whenReady.then(() => {
  model.onUpdate(() => modelUpdated());
  model.subscribe();
})