
from typing import List
from .Logger import Logger
from .simple_websocket_server import WebSocket, WebSocketServer
from threading import Thread, Lock
import json

import typing
if typing.TYPE_CHECKING:
  from .CDPView import CDPView

logger = Logger.instance()
clients = {}  # type: dict[str, WebSocket]
instance = None # type: CDPServer

class WSClient(WebSocket):
  
  def handle_http_request(self, request):
    if request.command == 'GET':
      if request.path == '/json/version':
        body = b'''{
          "Browser": "WotstatCDP/1.0",
          "Protocol-Version": "1.3",
          "User-Agent": "WotstatCDP/1.0",
          "V8-Version": "9.0.257.25",
          "WebKit-Version": "537.36 (@181352)",
          "webSocketDebuggerUrl": "ws://localhost:%d/ws"
        }''' % (self.server.port)
        return (200, [('Content-Type', 'application/json')], body)
      elif request.path == '/json/list':
        
        items = []
        port = self.server.port
        
        for view in instance.views.values():
          items.append('''
            {
              "devtoolsFrontendUrl": "devtools://devtools/bundled/inspector.html?ws=localhost:%d/ws/%s",
              "id": "%s",
              "title": "%s",
              "type": "page",
              "url": "wot://wotstat-cdp-%s",
              "webSocketDebuggerUrl": "ws://localhost:%d/ws/%s"
            }
          ''' % (port, view.pageId, view.pageId, view.pageName, view.pageId, port, view.pageId))
        
        body = ('[%s]' % ','.join(items)).encode('utf-8')
    
        return (200, [('Content-Type', 'application/json')], body)
    
    return (404, [('Content-Type', 'text/plain; charset=utf-8')], b'Not Found')
  
  def handle(self):
    if instance is None: return
    if self.viewId is None: return
    if self.viewId not in instance.views: return
  
    try:
      command = json.loads(self.data)
    except Exception as e:
      logger.error("Invalid command JSON: %s" % e)
      return
    
    instance.onViewCommand(self.viewId, command)
    
  def connected(self):
    logger.info("Connected %s; path=%s" % (str(self.address), self.request.path))
    clients[self.viewId] = self

  def handle_close(self):
    logger.info("Disconnected %s; path=%s" % (str(self.address), self.request.path))
    clients.pop(self.viewId, None)
  
  @property
  def viewId(self):
    # type: () -> str
    path = self.request.path
    if path.startswith('/ws/'):
      return path[4:]
    return None

class CDPServer(object):
    
  def __init__(self, port):
    global instance
    instance = self
    
    self.enabled = True
    
    self.server = WebSocketServer('', port, WSClient)
    
    self.serverThread = Thread(target=self._requestLoop, args=(self.server,))
    self.serverThread.daemon = True
    self.serverThread.start()
    
    self.views = {} # type: typing.Dict[str, CDPView]
    
  def _requestLoop(self, server):
    # type: (WebSocketServer) -> None
    while self.enabled or len(server.connections.items()) != 0:
      try:
        server.handle_request()
      except Exception as e:
        logger.error("Error in requestLoop: %s" % e)
  
  def viewPopulate(self, view):
    # type: (CDPView) -> None
    self.views[view.pageId] = view
  
  def viewDispose(self, view):
    # type: (CDPView) -> None
    if view.pageId in self.views:
      del self.views[view.pageId]
    
  def onViewCommand(self, viewId, command):
    # type: (str, str, typing.Optional[typing.Callable[[typing.Any], None]]) -> None
    if viewId not in self.views:
      logger.error("viewCommand: viewId %s not found" % viewId)
      return
    view = self.views[viewId]
    view.commandReceived(command)
    
  def sendViewCommand(self, viewId, command):
    # type: (str, str) -> None
    global clients
    if viewId not in clients:
      logger.error("sendViewCommand: viewId %s not connected" % viewId)
      return
    
    client = clients[viewId]
    try: client.send_message_text(command)
    except Exception as e: logger.error("sendViewCommand error: %s" % e)
  
  def dispose(self):
    # type: () -> None
    global instance
    instance = None
    
    self.enabled = False
    
    if self.server is not None:
      self.server.close()
      self.server = None
      
    if self.serverThread is not None:
      self.serverThread.join()
    
    logger.info("WebSocketDataProvider stopped")