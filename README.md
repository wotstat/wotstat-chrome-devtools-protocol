# [POC] Chrome Devtools Protocol (CDP) implementation for World of Tanks Gameface

![](https://github.com/user-attachments/assets/785d0b52-c704-4458-8afa-c7c7295a791a)

> **POC – Proof of Concept may not work perfectly and can contain bugs.**

This project implements support for the Chrome Devtools Protocol (CDP) for the Gameface part of the World of Tanks game, allowing the use of Chrome Devtools to inspect and debug the game’s and mods’ UI.

## Usage
1. Install [wot.gameface](https://gitlab.com/openwg/wot.gameface).
   - For `Lesta` download `wot.gameface` from the releases of this repository (patched version for Lesta)
2. Install [wotstat.chrome-devtools-protocol](https://github.com/wotstat/wotstat-chrome-devtools-protocol/releases/latest) from the releases
3. Launch the game
4. Open `chrome://inspect` in Chrome
5. Click `Configure...` and add `localhost:9222` if it’s not there
6. Wait for the list of targets to appear
7. Click `inspect` next to the desired target
8. Use Devtools as usual

## Features
Only minimal CDP functionality for working with DOM, CSS, and Runtime is implemented.

- DOM:
  - Lazy DOM tree viewing, loads only the required nodes
  - View all element attributes
  - Edit element attributes
  - Edit node text
  - View as `edit as HTML`
  - Copy and paste nodes
  - Move nodes
- Overlay:
  - Highlight elements when hovered in the tree
  - Display element sizes and paddings
  - Show proper overlays when hovering styles
  - Element picker for selecting an element on the page (click directly in the game)
- CSS:
  - View and **edit** element styles
  - View element style hierarchy (see which styles apply and from where)
  - View computed styles
  - Edit `custom.css` style via the Sources tab
- Runtime:
  - Execute JS code in the page context
  - View objects and their properties

## Known limitations
- DOM:
  - Pseudo-elements `::before` and `::after` are not supported
  - Attributes update every 300ms (throttle)
  - `setInnerHTML` doesn’t work properly — theoretically it should, but something breaks in Gameface
  - `appendChild` works only for new elements; when moving existing ones, they don’t appear in the tree — you must restart Devtools
- CSS:
  - Inline styles can be disabled, but Gameface removes `/* style */` definitions, so disabled styles are moved into the `_style` attribute
  - Pseudo-elements `::before` and `::after` are not supported
  - State overrides (`:hover`, `:active`, `:focus`, etc.) are not supported
  - Gameface expands shorthand properties into full ones — to see changes in Devtools, toggle the selected element in the tree
  - Editing `custom.css` can only set values; if you delete a line, Gameface still caches the style. For example, if you set the color to `red` and then delete that line, the color remains `red`.
- Runtime:
  - `const` and `let` are not supported; use simple declarations like `foo = 123`
  - Code suggestions work partially, since side-effect-free properties can’t always be determined
  - Object previews sometimes don’t appear (showing `{}` as empty); expand the object in the console to see its properties

## Development
The mod starts an HTTP + WebSocket server on port 9222.  
It hooks into `ViewComponent.initChildren` and injects `CDPView`, which is attached to every Gameface component.

`CDPView` injects a JS script responsible for implementing the protocol.

### Communication between Python and JS
Commands `Devtools -> Python -> JS` are handled by writing into a reactive `CDPModel` field, and responses `JS -> Python -> Devtools` are sent via `_addCommand`.  
Before sending the next command, `CDPModel` waits for confirmation of the previous one.

Commands `Python -> JS` are batched into arrays every `1/30` second to reduce the number of transmissions.

> [!IMPORTANT]
> If you know how to implement explicit `Python -> JS` communication, please do it. The current approach is hacky and may cause bugs.

### JS
Written in `TypeScript`, bundled into a single file using `vite`.  
About 60% of it is AI-generated nonsense. Needs refactoring.

A test server is available for use outside the game. Keep in mind that the Gameface runtime differs from a regular browser.

It’s helpful to enable the `Protocol Monitor` tab in Devtools for debugging.

## Useful links
- [Chrome Devtools Protocol](https://chromedevtools.github.io/devtools-protocol/) – official CDP documentation  
- [Devtools Remote Debugger](https://github.com/Nice-PLQ/devtools-remote-debugger) – browser-based CDP implementation for remote debugging
