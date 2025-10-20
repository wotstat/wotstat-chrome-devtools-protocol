
from .Logger import Logger, SimpleLoggerBackend
from gui.impl.lobby.page.lobby_footer import LobbyFooter
from gui.impl.pub.view_component import ViewComponent
from .CDPView import CDPView
from .CDPServer import CDPServer
from .Patcher import install_initchildren_hook
from openwg_gameface import manager as resmap

  

DEBUG_MODE = '{{DEBUG_MODE}}'
VERSION = '{{VERSION}}'

logger = Logger.instance()

class WotstatChromeDevtoolsProtocol(object):
  
  def __init__(self):
    self.tabId = 0
    logger.info("Starting WotstatChromeDevtoolsProtocol v%s" % VERSION)
    logger.setup([
      SimpleLoggerBackend(prefix="[MOD_WOTSTAT_CDP]", minLevel="INFO" if not DEBUG_MODE else "DEBUG"),
    ])
    
    self.server = CDPServer(9222)
    
    def initChildren(obj):
      className = type(obj).__name__
      if not resmap.isResMapValidated:
        logger.error("Resource map is not validated, skipping CDPView injection")
        return res
      
      if className == 'CDPView': return
      
      self.tabId += 1
      obj.setChildView(
        CDPView.viewLayoutID(),
        CDPView(self.server, className, '%s#%d' % (className, self.tabId))
      )

    install_initchildren_hook(ViewComponent, before_fn=initChildren)

  def dispose(self):
    logger.info("Stopping WotstatChromeDevtoolsProtocol")
    self.server.dispose()