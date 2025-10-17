

import json
from gui import InputHandler
from .Logger import Logger
from frameworks.wulf import ViewModel
from gui.impl.pub.view_component import ViewComponent
from openwg_gameface import ModDynAccessor, gf_mod_inject

import typing
if typing.TYPE_CHECKING:
  from .CDPServer import CDPServer

WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW = 'WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW'

logger = Logger.instance()

class CDPModel(ViewModel):
  
  def __init__(self, properties=1, commands=3):
    # type: (int, int) -> None
    super(CDPModel, self).__init__(properties=properties, commands=commands)
    
    self.requestsQueue = []
    self.callbacks = {}
    self.requestId = 0
    self.lastRequestReceived = True
  
  def _initialize(self):
    # type: () -> None
    super(CDPModel, self)._initialize()
    
    self._addStringProperty('request', '')
    self.response = self._addCommand('response')
    self.requestReceived = self._addCommand('requestReceived')
    self.sendCommand = self._addCommand('sendCommand')
    
    self.requestReceived += self.__onRequestReceived
    self.response += self.__onResponse
    
    gf_mod_inject(self, WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW, modules=[
      'coui://gui/gameface/mods/wotstat_cdp/index.js'
    ])
    
  def _finalize(self):
    self.requestReceived -= self.__onRequestReceived
    self.response -= self.__onResponse
    self.requestsQueue = None
    self.callbacks = None
    return super(CDPModel, self)._finalize()
  
  def sendRequest(self, request, callback=None):
    if self.requestsQueue is None: self.requestsQueue = []
    self.requestId += 1
    self.requestsQueue.append((self.requestId, request, callback))
    
    self.__processNextRequest()
    
  def __processNextRequest(self):
    if len(self.requestsQueue) == 0: return
    if not self.lastRequestReceived: return
    self.lastRequestReceived = False
    
    requestId, request, callback = self.requestsQueue.pop(0)
    if callback is not None: self.callbacks[requestId] = callback
    self.__setRequest(json.dumps({
      'id': requestId,
      'request': request
    }))

  def __onRequestReceived(self, args={}):
    # type: (dict) -> None
    self.lastRequestReceived = True
    self.__processNextRequest()
  
  def __onResponse(self, args={}):
    # type: (dict) -> None
    try:
      response = json.loads(args.get('response', '{}'))
      requestId = response.get('id', None)
      result = response.get('result', None)
      if requestId is not None and requestId in self.callbacks:
        callback = self.callbacks.pop(requestId)
        callback(result)
    except Exception as e:
      logger.error("CDPView __onResponse error: %s" % e)

  def __setRequest(self, value):
    # type: (str) -> None
    self._setString(0, value)
    
class CDPView(ViewComponent[CDPModel]):
  
  viewLayoutID = ModDynAccessor(WOTSTAT_CHROME_DEVTOOLS_PROTOCOL_VIEW)
  
  def __init__(self, server, pageName='', pageId=''):
    # type: (CDPServer, str, str) -> None
    super(CDPView, self).__init__(
      layoutID=CDPView.viewLayoutID(),
      model=CDPModel
    )
    
    self.viewModel.sendCommand += self.onSendCommand
    
    self.pageName = pageName
    self.pageId = pageId
    self.server = server
    
    self.server.viewPopulate(self)
    
    
  @property
  def viewModel(self):
    # type: () -> CDPModel
    return super(CDPView, self).getViewModel()
  
  def onSendCommand(self, args):
    # type: (dict) -> None
    command = args.get('command', None)
    if command is None:
      logger.error("CDPView onSendCommand: command is None")
      return
    self.server.sendViewCommand(self.pageId, command)
  
  def commandReceived(self, command):
    self.viewModel.sendRequest(command)
    
  def _finalize(self):
    # type: () -> None
    super(CDPView, self)._finalize()
    
    self.server.viewDispose(self)