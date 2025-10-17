from .wotstat_cdp.WotstatChromeDevtoolsProtocol import WotstatChromeDevtoolsProtocol

wotstatCDP = WotstatChromeDevtoolsProtocol()

def fini():
  wotstatCDP.dispose()