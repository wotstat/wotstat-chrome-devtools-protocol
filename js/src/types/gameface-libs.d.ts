declare module 'gameface:common' {
  /**
   * Converts pixels to rem units
   * @param value - Value in pixels
   * @returns Value in rem units
   */
  export function pxToRem(value: number): number;

  /**
   * Converts rem units to pixels
   * @param value - Value in rem units
   * @returns Value in pixels
   */
  export function remToPx(value: number): number;

  /**
   * Gets the current scale factor
   * @returns Current scale factor
   */
  export function getScale(): number;

  /**
   * Gets the current display size.
   * @param type - The unit type for the returned size. Defaults to 'px'.
   * @returns An object containing the width and height.
   */
  export function getSize(type?: 'px' | 'rem'): { width: number; height: number };

}

declare module 'gameface:debug' {
  /**
   * Options for the debugObject function.
   */
  export interface DebugOptions {
    /** The number of spaces for indentation (default: 2). */
    indentSize?: number;
    /** The maximum depth of recursion (default: 10). */
    maxDepth?: number;
    /** Whether to display array indices (default: true). */
    showArrayIndex?: boolean;
  }

  /**
   * Recursively logs the structure of an object for debugging purposes.
   * @param obj - The object to be logged.
   * @param options - Formatting options.
   * @param currentDepth - The current recursion depth (for internal use).
   * @param prefix - The prefix for the current line (for internal use).
   */
  export function debugObject(
    obj: unknown,
    options?: DebugOptions,
    currentDepth?: number,
    prefix?: string
  ): void;

  /**
   * Represents a debug tree node for a DOM element.
   */
  export interface DebugTreeNode {
    /** Tag name of the element. */
    tag: string;
    /** Element attributes as key-value pairs. */
    attributes: Record<string, string>;
    /** Inline styles as key-value pairs. */
    styles: Record<string, string>;
    /** Shortened text content. */
    content: string | null;
    /** Depth of the node in the tree. */
    depth: number;
    /** Child nodes. */
    children: DebugTreeNode[];
    /** Bounding rectangle information. */
    rect?: {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  }

  /**
   * Builds a debug tree from a DOM element.
   * @param element - The DOM element to analyze.
   * @param depth - The current depth in the tree (for internal use).
   * @param maxDepth - The maximum depth to traverse.
   * @returns A tree structure representing the element, or null if the element is invalid.
   */
  export function buildDebugTree(
    element: Element,
    depth?: number,
    maxDepth?: number
  ): DebugTreeNode | null;

  /**
   * Debugs a DOM element by logging its structure in chunks.
   * @param element - The DOM element to debug.
   * @param chunkSize - The size of JSON chunks to log, which helps avoid console limitations.
   */
  export function debugElement(element: Element, chunkSize?: number): void;

}

declare module 'gameface:media' {
  /**
   * Represents a responsive breakpoint definition.
   */
  export interface Breakpoint {
    weight: number;
    className: string;
    width: number;
    height: number;
  }

  /**
   * A map of predefined responsive breakpoints.
   */
  export const breakpoints: Record<string, Breakpoint>;

  /**
   * Media properties used to update the wrapper.
   */
  export interface MediaProperties {
    width: number;
    height: number;
    scale: number;
  }

  /**
   * Updates the CSS classes of the '.media-wrapper' element based on screen dimensions and scale.
   * @param media - The media context object.
   */
  export function updateWrapper(media: MediaProperties): void;

  /**
   * Represents an instance of a media context.
   */
  export interface MediaContextInstance {
    /** Current screen width. */
    width: number;
    /** Current screen height. */
    height: number;
    /** Current scale factor. */
    scale: number;
    /** Whether automatic wrapper updates are enabled. */
    autoUpdateWrapper: boolean;
    /** Internal list of registered update callbacks. */
    onUpdateCallbacks: Array<(media: MediaProperties) => void>;

    /**
     * Subscribes to engine resize and scale update events.
     */
    subscribe(): void;

    /**
     * Unsubscribes from engine resize and scale update events.
     */
    unsubscribe(): void;

    /**
     * Handles client resize events.
     * @param actualWidth - The new width.
     * @param actualHeight - The new height.
     */
    onClientResized(actualWidth: number, actualHeight: number): void;

    /**
     * Handles scale update events.
     * @param actualScale - The new scale factor.
     */
    onScaleUpdated(actualScale: number): void;

    /**
     * Registers a callback for media updates.
     * @param callback - The function to call when media changes.
     */
    onUpdate(callback: (media: MediaProperties) => void): void;

    /**
     * Notifies all registered callbacks about media changes.
     */
    notifyUpdate(): void;
  }

  /**
   * Creates a media context for handling screen size and scale changes.
   * @param autoUpdateWrapper - If true, automatically updates the '.media-wrapper' element with CSS classes.
   * @returns The media context instance.
   */
  export function MediaContext(autoUpdateWrapper?: boolean): MediaContextInstance;

}

declare module 'gameface:model' {
  /**
   * Represents an observer instance for a specific model within subViews.
   */
  export interface ModelObserverInstance<Model> {
    /** The resource ID of the observed model (0 for root model). */
    resId: number | null;

    /** The currently observed model object, or null if unavailable. */
    readonly model: Model | null;

    /** Internal ID of the registered data change callback (if any). */
    callbackId: number | null;

    /** Internal list of update callbacks. */
    onUpdateCallbacks: Array<(model: Model | null) => void>;

    /**
     * Subscribes to model change events in the game engine.
     */
    subscribe(): void;

    /**
     * Unsubscribes from model change events in the game engine.
     */
    unsubscribe(): void;

    /**
     * Registers a callback that fires when the model changes.
     * @param callback - The function to call with the updated model.
     */
    onUpdate(callback: (model: Model | null) => void): void;

    /**
     * Notifies all registered callbacks with the current model.
     * @internal
     */
    notifyUpdate(): void;
  }

  /**
   * Creates an observer for a specific model within subViews.
   * This observer provides a subscription mechanism for data change notifications.
   *
   * @param featureName - The name of the feature model to observe. 
   * If not provided, the observer will target the main window model.
   * @returns The created model observer instance.
   */
  export function ModelObserver<Model>(featureName?: string): ModelObserverInstance<Model>;

}

declare module 'gameface:sound' {
  /**
   * Plays a sound effect.
   * @param name - The name of the sound to be played.
   */
  export function playSound(name: string): void;
}

declare module 'gameface:views' {

  /**
   * Enumeration of view event types.
   */
  export const ViewEventTypes: {
    tooltip: number;
    popover: number;
    contextMenu: number;
  };

  /**
   * Represents a serialized event argument for the view system.
   */
  export type SerializedEventArgument =
    | { number: number }
    | { bool: boolean }
    | { string: string };

  /**
   * Serializes event arguments for the view system.
   * @param value - The value to be serialized.
   * @returns The serialized value object, or undefined if unsupported.
   */
  export function serializeEventArgument(
    value: unknown
  ): SerializedEventArgument | undefined;

  /**
   * Creates formatted arguments for view events.
   * @param args - Key-value pairs of arguments.
   * @returns An array of formatted argument objects.
   */
  export function createViewEventArguments(
    args: Record<string, unknown>
  ): Array<{
    __Type: "GFValueProxy";
    name: string;
  } & SerializedEventArgument>;

  /**
   * Sends a view event to the game interface.
   * @param type - The event type from `ViewEventTypes`.
   * @param options - Event options, including arguments.
   * @returns The result of the view event handling.
   */
  export function sendViewEvent(
    type: number,
    options?: {
      contentID?: string;
      decoratorID?: string;
      targetID?: number;
      on?: boolean;
      isMouseEvent?: boolean;
      direction?: number;
      bbox?: SerializedBoundingBox;
      args?: Record<string, unknown>;
      [key: string]: unknown;
    }
  ): unknown;

  /**
   * Represents a serialized bounding box for view events.
   */
  export interface SerializedBoundingBox {
    __Type: "GFBoundingBox";
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /**
   * Serializes a DOM element's bounding box for the view system.
   * @param e - The DOMRect object from `getBoundingClientRect()`.
   * @returns The serialized bounding box object.
   */
  export function serializeGlobalBoundingBox(e: DOMRect): SerializedBoundingBox;

  /**
   * Gets the global position of the view.
   * @param unit - The unit for the result (`'rem'` or `'px'`). Defaults to `'rem'`.
   * @returns The position object with x and y coordinates.
   */
  export function getViewGlobalPosition(
    unit?: "rem" | "px"
  ): { x: number; y: number };

  /**
   * Shows a tooltip with the specified content.
   * @param header - The header text for the tooltip.
   * @param body - The body text for the tooltip.
   * @param contentID - The ID of the tooltip content.
   * @param decoratorID - The ID of the tooltip decorator.
   */
  export function showTooltip(
    header?: string,
    body?: string,
    contentID?: string,
    decoratorID?: string
  ): void;

  /**
   * Hides a tooltip.
   * @param contentID - The ID of the tooltip content.
   * @param decoratorID - The ID of the tooltip decorator.
   */
  export function hideTooltip(
    contentID?: string,
    decoratorID?: string
  ): void;

  /**
   * Shows a popover element at the specified position.
   * @param caller - The element that triggered the popover.
   * @param alias - The popover's alias or identifier.
   * @param contentID - The ID of the popover content.
   * @param decoratorID - The ID of the popover decorator.
   */
  export function showPopover(
    caller: HTMLElement,
    alias: string,
    contentID?: string,
    decoratorID?: string
  ): void;

}
