import BigWorld

from threading import Thread, Lock
from Event import Event

from .simple_websocket_server import WebSocket, WebSocketServer

from typing import List
from .Logger import ILogger


logger = None # type: ILogger
clients = [] # type: List[WebSocket]
enabled = True
instance = None # type: WebSocketDataProvider

class WSClient(WebSocket):
  def handle(self):
    logger.debug("Received message: %s" % str(self.data))
    
  def connected(self):
    logger.info("Connected %s" % str(self.address))
    clients.append(self)
    instance.onClientConnected(self)

  def handle_close(self):
    logger.info("Disconnected %s"% str(self.address))
    clients.remove(self)


class WebSocketDataProvider(object):

  def __init__(self, loggerInstance):
    
    global logger, instance
    logger = loggerInstance
    instance = self    
    self.onClientConnected = Event()
    self.server = None
    self.serverThread = None
    
  def setup(self):    
    self.server = WebSocketServer('', 38200, WSClient)
    
    self.serverThread = Thread(target=self._requestLoop, args=(self.server,))
    self.serverThread.daemon = True
    self.serverThread.start()
    
    logger.info("WebSocket started")
    
  def _requestLoop(self, server):
    # type: (WebSocketServer) -> None
    while enabled or len(server.connections.items()) != 0:
      try:
        server.handle_request()
      except Exception as e:
        logger.error("Error in requestLoop: %s" % e)
        
  def sendMessage(self, message):
    # type: (str) -> None
    logger.debug("Sending message to %s clients: %s" % (len(clients), message))
    for client in clients:
      client.send_message_text(message)
      
  def dispose(self):
    # type: () -> None
    global enabled
    enabled = False
    
    if self.server is not None:
      self.server.close()
      self.server = None
      
    if self.serverThread is not None:
      self.serverThread.join()
    
    logger.info("WebSocketDataProvider stopped")
