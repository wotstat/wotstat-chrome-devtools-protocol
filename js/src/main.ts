import { ModelObserver } from 'gameface:model';
import { ChromeDevtoolProtocol } from './ChromeDevtoolProtocol.ts'

type Model = {
  request: string | null;
  requestReceived: () => void;
  sendCommand: (params: { command: string }) => void;
}

const model = ModelObserver<Model>('WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW');

let cdp: ChromeDevtoolProtocol | null = null;
function initCdp() {
  return new ChromeDevtoolProtocol((command) => {
    model.model?.sendCommand({ command: JSON.stringify(command) });
  });
}

let lastVisibleId = -1;
function modelUpdated() {

  if (!model.model?.request) return;
  model.model.requestReceived();


  const { request, id } = JSON.parse(model.model.request);

  if (request === 'DISCONNECT') {
    cdp?.dispose();
    cdp = null
    lastVisibleId = -1;
    return;
  }

  if (cdp === null) cdp = initCdp();

  if (id <= lastVisibleId) return;
  lastVisibleId = id;

  for (const command of request) {
    cdp?.onCommand(command);
  }
}

engine.whenReady.then(() => {
  model.onUpdate(() => modelUpdated());
  model.subscribe();
})