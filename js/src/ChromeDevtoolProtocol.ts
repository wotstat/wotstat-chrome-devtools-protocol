import type BaseDomain from "./domain/BaseDomain";
import { CSSDomain } from "./domain/CSS";
import { DOMDomain } from "./domain/Dom";
import { OverlayDomain } from "./domain/Overlay";
import { RuntimeDomain } from "./domain/Runtime";
import DomStorage from "./domain/utils/DomStorage";
import { RemoteObjectStorage } from "./domain/utils/RemoteObjectStorage";

type Message = { id: number; method: string; params: any }
function isMessage(obj: any): obj is Message {
  return obj && typeof obj.id === 'number' && typeof obj.method === 'string' && 'params' in obj;
}

export class ChromeDevtoolProtocol {

  readonly domains: { [key: string]: BaseDomain } = {}

  private readonly domStorage = new DomStorage();
  private readonly remoteObjectStorage = new RemoteObjectStorage();

  constructor(private sendCommand: (command: any) => void) {
    const domDomain = new DOMDomain({ sendCommand, domStorage: this.domStorage, remoteObjectStorage: this.remoteObjectStorage });
    this.domains = {
      'Runtime': new RuntimeDomain({ sendCommand, remoteObjectStorage: this.remoteObjectStorage }),
      'DOM': domDomain,
      'Overlay': new OverlayDomain({ sendCommand, dom: domDomain, domStorage: this.domStorage }),
      'CSS': new CSSDomain({ sendCommand, domStorage: this.domStorage }),
    }
  }

  private execute(message: Message) {
    const { id, method, params } = message;
    const [domainName, action] = method.split('.');
    const domain = this.domains[domainName];

    if (!domain) return { id, result: {} }

    if (typeof (domain as any)[action] === 'function') {
      const result = (domain as any)[action](params);
      if (result !== null) return { id, result: result || {} };
      return null;
    }

    return { id, result: {} };
  }

  onCommand(message: unknown) {
    if (!isMessage(message)) {
      console.error("Invalid message", message);
      return;
    }

    const response = this.execute(message);
    if (response) this.sendCommand(response);
  }

  dispose() {
    Object.values(this.domains).forEach(domain => domain.dispose());
    this.domStorage.dispose();
    this.remoteObjectStorage.dispose();
  }
}