import BaseDomain, { type Options } from "./BaseDomain";
import { isSideEffectFree } from "./utils/isSideEffectFree";
import type { RemoteObjectStorage } from "./utils/RemoteObjectStorage";

const nativeLog = window.console.log;
export class RuntimeDomain extends BaseDomain {

  private isEnable = false;
  private readonly storage: RemoteObjectStorage

  constructor(options: Options & { remoteObjectStorage: RemoteObjectStorage }) {
    super(options);
    this.storage = options.remoteObjectStorage;
    this.hookConsole();
    this.listenError();
  }

  enable() {
    this.isEnable = true;

    this.send({
      method: "Runtime.executionContextCreated",
      params: {
        context: {
          id: 1,
          name: 'top',
          origin: location.origin,
        }
      }
    });
  }

  dispose(): void {
    this.isEnable = false;
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
        result: this.storage.serialize(res, generatePreview ?? true),
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
    return this.storage.getProperties(params);
  }

  releaseObject(params: { objectId: string }) {
    this.storage.releaseObject(params.objectId)
  }

  // document.body.querySelector('.TruncateText_dcb41d92').innerHTML = 'Renou7777798987987897gvgvjhgvhjgvjhgvjhgvjhgvjhgvjgvjgvjhgvgjhgvjhvjhgv4567==='
  callFunctionOn(params: { functionDeclaration: string, objectId?: string, arguments?: any[], silent?: boolean }) {
    const { functionDeclaration, objectId, silent = false } = params;
    let { arguments: args = [] } = params;

    const fun = new Function(`return (${functionDeclaration});`)();
    if (Array.isArray(args)) {
      args = args.map(v => {
        if ('value' in v) return v.value;
        if ('objectId' in v) return this.storage.getObjectById(v.objectId);
        return undefined;
      });
    }

    if (silent === true) {
      try {
        const result = fun.apply(objectId ? this.storage.getObjectById(objectId) : null, args);
        return { result: this.storage.serialize(result) };
      } catch (error) {
        return {
          result: this.storage.serialize(error),
        }
      }
    } else {
      const result = fun.apply(objectId ? this.storage.getObjectById(objectId) : null, args);
      return { result: this.storage.serialize(result) };
    }
  }


  // https://github.com/stacktracejs/error-stack-parser/blob/9f33c224b5d7b607755eb277f9d51fcdb7287e24/error-stack-parser.js#L51
  private getCallFrames(error: Error = Error()) {

    if (!error.stack) return [];

    const filtered = error.stack.split('\n').filter(line => line.match(/^\s*at .*(\S+:\d+|\(native\))/m));

    const stack = filtered.map(line => {
      if (line.indexOf('(eval ') > -1)
        line = line.replace(/eval code/g, 'eval').replace(/(\(eval at [^()]*)|(,.*$)/g, '');

      const parts = /at (.*)\((.*:(\d*):(\d*)|<anonymous>|.*)\)/.exec(line.replace(/^\s+/, ''));

      return {
        functionName: parts && parts[1] ? parts[1].trim() : '<anonymous>',
        fileName: parts && parts[2] ? parts[2] : undefined,
        url: parts && parts[2] ? parts[2] : undefined,
        lineNumber: parts && parts[3] ? parseInt(parts[3], 10) : undefined,
        columnNumber: parts && parts[4] ? parseInt(parts[4], 10) : undefined,
        source: line
      }
    })

    stack.shift(); // remove this function from callframes

    return stack;
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
          method: "Runtime.consoleAPICalled",
          params: {
            type: methods[key],
            args: args.map(arg => this.storage.serialize(arg, true)),
            executionContextId: 1,
            timestamp: Date.now(),
            stackTrace: {
              callFrames: ['error', 'warn', 'trace', 'assert'].includes(key) ? this.getCallFrames() : [],
            }
          }
        };
        this.send(data);
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
        method: "Runtime.exceptionThrown",
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
              callFrames: this.getCallFrames(error),
            },
          }
        }
      };
      this.send(data);
    };

    window.addEventListener('error', e => exceptionThrown(e.error));
    window.addEventListener('unhandledrejection', e => exceptionThrown(e.reason));
  }
}