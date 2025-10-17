# -*- coding: utf-8 -*-
from functools import wraps

def install_initchildren_hook(ViewComponent, before_fn=None, after_fn=None):
    """
    Intercept ANY call to _initChildren on instances of ViewComponent or its subclasses,
    even if subclasses override _initChildren and don't call super().
    """
    if getattr(ViewComponent, '__vc_hook_installed__', False):
        return  # already installed

    orig_getattribute = ViewComponent.__getattribute__

    def _find_attr_func(cls, name):
        # Find the first implementation in the MRO *without* triggering __getattribute__
        for c in cls.__mro__:
            if name in c.__dict__:
                return c.__dict__[name]
        return None  # not found

    def _patched_getattribute(self, name):
        if name != '_initChildren':
            return orig_getattribute(self, name)

        # Resolve the method that *would* have been called originally
        func = _find_attr_func(type(self), '_initChildren')
        if func is None:
            # Defer to normal lookup if nothing found in the MRO
            return orig_getattribute(self, name)

        bound_orig = func.__get__(self, type(self))  # bind to this instance

        @wraps(func)
        def _wrapped(*args, **kwargs):
            if before_fn:
                before_fn(self)
            try:
                return bound_orig(*args, **kwargs)
            finally:
                if after_fn:
                    after_fn(self)

        return _wrapped

    # Install + keep handle to restore
    ViewComponent.__orig_getattribute__ = orig_getattribute
    ViewComponent.__getattribute__ = _patched_getattribute
    ViewComponent.__vc_hook_installed__ = True


def uninstall_initchildren_hook(ViewComponent):
    if getattr(ViewComponent, '__vc_hook_installed__', False):
        ViewComponent.__getattribute__ = ViewComponent.__orig_getattribute__
        del ViewComponent.__orig_getattribute__
        ViewComponent.__vc_hook_installed__ = False

