"""The one error type the engine raises on purpose."""


class EngineError(ValueError):
    """A rule stopped the action, with a message written for the person using the app.

    Build 27 threw ``new Error('...')`` with the same messages. The API returns these to the
    browser as HTTP 400 with the message, so the person sees exactly what to fix.
    """

    @property
    def message(self) -> str:
        return str(self.args[0]) if self.args else ""
