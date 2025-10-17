import type BaseDomain from "./domain/BaseDomain";
import { DOMDomain } from "./domain/Dom";
import { OverlayDomain } from "./domain/Overlay";
import { RuntimeDomain } from "./domain/Runtime";

type Message = { id: number; method: string; params: any }
function isMessage(obj: any): obj is Message {
  return obj && typeof obj.id === 'number' && typeof obj.method === 'string' && 'params' in obj;
}

export class ChromeDevtoolProtocol {

  readonly domains: { [key: string]: BaseDomain } = {}

  constructor(private sendCommand: (command: any) => void) {
    this.domains = {
      'Runtime': new RuntimeDomain({ sendCommand }),
      'DOM': new DOMDomain({ sendCommand }),
      'Overlay': new OverlayDomain({ sendCommand }),
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
}