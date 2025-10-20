import { ModelObserver } from 'gameface:model';
import { ChromeDevtoolProtocol } from './ChromeDevtoolProtocol.ts'

type Model = {
  request: string | null;
  requestReceived: () => void;
  sendCommand: (params: { command: string }) => void;
}

const model = ModelObserver<Model>('WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW');

function initCdp() {
  return new ChromeDevtoolProtocol((command) => {
    model.model?.sendCommand({ command: JSON.stringify(command) });
  });
}

let cdp = initCdp();
let lastVisibleId = -1;
function modelUpdated() {

  if (model.model?.request === 'DISCONNECT') {
    cdp.dispose();
    cdp = initCdp();
    lastVisibleId = -1;
    return;
  }

  if (!model.model?.request) return;
  const { request, id } = JSON.parse(model.model.request);

  if (id <= lastVisibleId) return;
  lastVisibleId = id;

  model.model.requestReceived();

  for (const command of request) {
    cdp.onCommand(command);
  }
}

engine.whenReady.then(() => {
  model.onUpdate(() => modelUpdated());
  model.subscribe();
})