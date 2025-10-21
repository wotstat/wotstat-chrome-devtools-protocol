
from .Logger import Logger, SimpleLoggerBackend
from .CDPServer import CDPServer
from gui.impl.pub import ViewImpl

try: 
  from .CDPView import CDPView
  from openwg_gameface import manager as resmap
except ImportError: pass

DEBUG_MODE = '{{DEBUG_MODE}}'
VERSION = '{{VERSION}}'

logger = Logger.instance()

_orig_onLoading = ViewImpl._onLoading

class WotstatChromeDevtoolsProtocol(object):
  
  def __init__(self):
    logger.info("Starting WotstatChromeDevtoolsProtocol v%s" % VERSION)
    logger.setup([
      SimpleLoggerBackend(prefix="[MOD_WOTSTAT_CDP]", minLevel="INFO" if not DEBUG_MODE else "DEBUG"),
    ])
    
    try:
      from openwg_gameface import ModDynAccessor, gf_mod_inject
    except ImportError:
      logger.error("openwg_gameface module is not available, cannot inject CDPView")
      return
    
    self.tabId = 0
    
    self.server = CDPServer(9222)
    
    def onLoading(obj, *args, **kwargs):
      # type: (ViewImpl, Any, Any) -> None
      result = _orig_onLoading(obj, *args, **kwargs)
      
      className = type(obj).__name__
      if not resmap.isResMapValidated:
        logger.error("Resource map is not validated, skipping CDPView injection")
        return result
      
      if className == 'CDPView': return result
      if className == 'MainView': return result
      if obj.getParentView() and type(obj.getParentView()).__name__ != 'MainView': return result
      
      print("Injecting CDPView into %s" % className)

      self.tabId += 1
      obj.setChildView(
        CDPView.viewLayoutID(),
        CDPView(self.server, className, '%s#%d' % (className, self.tabId))
      )
      
      return result
    
    ViewImpl._onLoading = onLoading

  def dispose(self):
    logger.info("Stopping WotstatChromeDevtoolsProtocol")
    self.server.dispose()