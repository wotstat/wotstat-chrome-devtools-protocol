try:
  import openwg_gameface
except ImportError:
  import logging
  logger = logging.getLogger()
  logger.error('\n' +
                  '!!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!\n'
                  '!!!\n'
                  '!!!   WotStat Chrome DevTools Protocol mod requires the openwg_gameface module to function.\n'
                  '!!!   Without it, this and other GF UI mods will not work correctly.\n'
                  '!!!   Please download and install it from: https://gitlab.com/openwg/wot.gameface/-/releases/\n'
                  '!!!\n'
                  '!!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!   !!!\n')

  import sys
  sys.exit()
  
from .wotstat_cdp.WotstatChromeDevtoolsProtocol import WotstatChromeDevtoolsProtocol

wotstatCDP = WotstatChromeDevtoolsProtocol()

def fini():
  wotstatCDP.dispose()