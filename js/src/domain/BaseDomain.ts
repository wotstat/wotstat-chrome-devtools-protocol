export type Options = {
  sendCommand: (command: any) => void
}


export default class BaseDomain {
  private sendCommand: (command: any) => void;

  constructor(options: Options) {
    this.sendCommand = options.sendCommand;
  }

  enable() { }

  send(data: any) {
    this.sendCommand(data);
  }

  dispose() { }
}