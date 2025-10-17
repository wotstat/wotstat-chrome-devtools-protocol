import BaseDomain from "./BaseDomain";
import { isSideEffectFree } from "./utils/isSideEffectFree";
import { Event } from "./utils/protocol";
import { remoteObjectSerializer as serializer } from "./utils/RemoteObject";

export class RuntimeDomain extends BaseDomain {

  private isEnable = false;
  private cacheConsole: { method: string; params: any }[] = [];
  private cacheError: { method: string; params: any }[] = [];

  constructor(options: { sendCommand: (command: any) => void }) {
    super(options);
    this.hookConsole();
    this.listenError();
  }

  enable() {
    this.isEnable = true;
    this.cacheConsole.forEach(data => this.send(data));
    this.cacheError.forEach(data => this.send(data));

    this.send({
      method: Event.executionContextCreated,
      params: {
        context: {
          id: 1,
          name: 'top',
          origin: location.origin,
        }
      }
    });
  }

  evaluate({ expression, generatePreview, throwOnSideEffect }: { expression: string, generatePreview?: boolean, throwOnSideEffect?: boolean }) {

    if (throwOnSideEffect && isSideEffectFree(expression) === false) {
      return {
        result: {},
        exceptionDetails: { text: 'EvalError: Possible side-effect in debug-evaluate' }
      }
    }

    try {
      // eslint-disable-next-line no-eval
      const res = window.eval(expression);
      return {
        result: serializer.serialize(res, generatePreview ?? true),
      };
    } catch (error) {
      return {
        result: {},
        exceptionDetails: { text: error ? error.toString() : 'Unknown error' }
      }
    }
  }

  getProperties(params: {
    accessorPropertiesOnly?: boolean,
    generatePreview?: boolean,
    objectId: string,
    ownProperties?: boolean
  }) {
    return serializer.getProperties(params);
  }

  releaseObject(params: { objectId: string }) {
    serializer.releaseObject(params.objectId)
  }

  // document.body.querySelector('.TruncateText_dcb41d92').innerHTML = 'Renou7777798987987897gvgvjhgvhjgvjhgvjhgvjhgvjhgvjgvjgvjhgvgjhgvjhvjhgv4567==='
  callFunctionOn(params: { functionDeclaration: string, objectId?: string, arguments?: any[], silent?: boolean }) {
    const { functionDeclaration, objectId, silent = false } = params;
    let { arguments: args = [] } = params;

    const fun = new Function(`return (${functionDeclaration});`)();
    if (Array.isArray(args)) {
      args = args.map(v => {
        if ('value' in v) return v.value;
        if ('objectId' in v) return serializer.getObjectById(v.objectId);
        return undefined;
      });
    }

    if (silent === true) {
      try {
        const result = fun.apply(objectId ? serializer.getObjectById(objectId) : null, args);
        return { result: serializer.serialize(result) };
      } catch (error) {
        return {
          result: serializer.serialize(error),
        }
      }
    } else {
      const result = fun.apply(objectId ? serializer.getObjectById(objectId) : null, args);
      return { result: serializer.serialize(result) };
    }
  }

  private processConsoleLog(type: 'console' | 'error', data: { method: string; params: any }) {
    if (this.isEnable) {
      this.send(data);
    } else {
      if (type === 'console') this.cacheConsole.push(data)
      else if (type === 'error') this.cacheError.push(data)
    }
  }

  private hookConsole() {
    const methods = {
      log: 'log',
      debug: 'debug',
      info: 'info',
      error: 'error',
      warn: 'warning',
      dir: 'dir',
      dirxml: 'dirxml',
      table: 'table',
      trace: 'trace',
      clear: 'clear',
      group: 'startGroup',
      groupCollapsed: 'startGroupCollapsed',
      groupEnd: 'endGroup',
    } as const;

    for (const key of Object.keys(methods) as (keyof typeof methods)[]) {
      const nativeConsoleFunc = window.console[key];
      window.console[key] = (...args) => {
        nativeConsoleFunc?.(...args);
        const data = {
          method: Event.consoleAPICalled,
          params: {
            type: methods[key],
            args: args.map(arg => serializer.serialize(arg, true)),
            executionContextId: 1,
            timestamp: Date.now(),
            stackTrace: {
              callFrames: ['error', 'warn', 'trace', 'assert'].includes(key) ? [] : [],
            }
          }
        };
        this.processConsoleLog('console', data);
      };
    };
  }

  private listenError() {
    const exceptionThrown = (error: any) => {
      let desc = error ? error.stack : 'Script error.';

      if (error) {
        desc = `${error.name}: ${error.message}\n    at (${error.sourceURL}:${error.line}:${error.column})`;
      }

      const data = {
        method: Event.exceptionThrown,
        params: {
          timestamp: Date.now(),
          exceptionDetails: {
            text: 'Uncaught',
            exception: {
              type: 'object',
              subtype: 'error',
              className: error ? error.name : 'Error',
              description: desc,
            },
            stackTrace: {
              callFrames: []
            },
          }
        }
      };
      this.processConsoleLog('error', data);
    };

    window.addEventListener('error', e => exceptionThrown(e.error));
    window.addEventListener('unhandledrejection', e => exceptionThrown(e.reason));
  }
}