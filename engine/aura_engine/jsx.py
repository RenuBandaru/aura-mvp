"""Small helpers that reproduce JavaScript behavior the engine depends on.

The Python engine must give exactly the same results as the build 27 JavaScript engine, down to
the characters in an email and the bytes that go into an audit hash. Python and JavaScript differ
in a handful of quiet ways, so every place the engine relies on one of them goes through a helper
here. Each helper says which JavaScript behavior it copies.

The most important differences:

* Truthiness. In JavaScript an empty list ``[]`` and an empty object ``{}`` count as true. In
  Python they count as false. Use :func:`truthy` and :func:`js_or` wherever the JavaScript used
  ``if (x)``, ``!x`` or ``a || b`` on something that could be a list or an object.
* Numbers. JavaScript has one number type, so ``5`` and ``5.0`` print the same ("5"). Python keeps
  ints and floats apart. Use :func:`js_str` to turn a number into text and :func:`js_json` to
  write JSON.
* Rounding. ``Math.round`` rounds halves up (2.5 to 3, -2.5 to -2). Python's ``round`` rounds
  halves to even. Use :func:`js_round`.
* Missing versus null. JavaScript has both ``undefined`` (no value) and ``null``. In stored case
  data they look the same after a JSON round trip, so the engine mostly treats a missing key and
  ``None`` alike. Where JavaScript left a key out of an object on purpose, the Python code uses
  :data:`UNDEF`, which :func:`js_json` drops.
* Dates. The engine writes some dates as text (for example "Sun Nov 08 2026"). JavaScript uses
  the computer's time zone for this. The port fixes the zone to America/New_York, which is
  Bradford White's head office, so the text is the same on every server.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable
from zoneinfo import ZoneInfo

# The time zone used whenever the engine turns a timestamp into text.
ENGINE_TZ = ZoneInfo("America/New_York")


class _Undefined:
    """Marker for "no value at all", like JavaScript ``undefined``.

    :func:`js_json` leaves out object keys whose value is UNDEF, the way ``JSON.stringify`` leaves
    out keys whose value is ``undefined``.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return "UNDEF"


UNDEF = _Undefined()


# ---------------------------------------------------------------------------
# Truthiness
# ---------------------------------------------------------------------------

def truthy(v: Any) -> bool:
    """JavaScript truthiness.

    False for ``None``, UNDEF, ``False``, ``0``, ``NaN`` and the empty string. True for everything
    else, including empty lists and empty dicts (unlike Python).
    """
    if v is None or v is UNDEF or v is False:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True


def js_or(*values: Any) -> Any:
    """JavaScript ``a || b || c``: the first truthy value, or the last value if none is truthy."""
    for v in values[:-1]:
        if truthy(v):
            return v
    return values[-1]


def nullish(v: Any) -> bool:
    """JavaScript ``v == null``: true for ``null`` and ``undefined`` only."""
    return v is None or v is UNDEF


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

NAN = float("nan")
_NUM_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def to_num(v: Any) -> float | int:
    """JavaScript unary plus (``+v``), which turns a value into a number.

    ``+''`` is 0, ``+'  12 '`` is 12, ``+'abc'`` is NaN, ``+null`` is 0, ``+undefined`` is NaN,
    ``+true`` is 1, ``+[]`` is 0 and ``+[7]`` is 7.
    """
    if v is UNDEF:
        return NAN
    if v is None or v is False:
        return 0
    if v is True:
        return 1
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0
        if _NUM_RE.match(s):
            f = float(s)
            return int(f) if f.is_integer() and abs(f) < 2**53 else f
        low = s.lower()
        if low.startswith(("0x", "0o", "0b")) and len(s) > 2:
            try:
                return int(s, 0)
            except ValueError:
                return NAN
        if s in ("Infinity", "+Infinity"):
            return math.inf
        if s == "-Infinity":
            return -math.inf
        return NAN
    if isinstance(v, list):
        if not v:
            return 0
        if len(v) == 1:
            return to_num(js_str(v[0]))
        return NAN
    return NAN


def is_nan(v: Any) -> bool:
    """JavaScript ``isNaN(v)``: true when ``+v`` is not a number."""
    n = to_num(v)
    return isinstance(n, float) and math.isnan(n)


def num_or_zero(v: Any) -> float | int:
    """JavaScript ``+v || 0``: the number, or 0 when it is 0 or NaN."""
    n = to_num(v)
    return n if truthy(n) else 0


def js_round(x: float | int) -> float | int:
    """JavaScript ``Math.round``: halves round up, toward positive infinity."""
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return x
    return math.floor(x + 0.5)


def _num_text(n: float | int) -> str:
    """How JavaScript prints a number: 5 not 5.0, 0.1 not 0.1000, NaN and Infinity by name."""
    if isinstance(n, bool):
        return "true" if n else "false"
    if isinstance(n, int):
        return str(n)
    if math.isnan(n):
        return "NaN"
    if math.isinf(n):
        return "Infinity" if n > 0 else "-Infinity"
    if n.is_integer() and abs(n) < 1e21:
        return str(int(n))
    text = repr(n)
    # Python writes 1e-07 where JavaScript writes 1e-7.
    if "e" in text:
        mant, exp = text.split("e")
        sign = "-" if exp.startswith("-") else "+"
        text = f"{mant}e{sign}{exp.lstrip('+-').lstrip('0') or '0'}"
    return text


def js_str(v: Any) -> str:
    """JavaScript ``String(v)`` and string concatenation (``'a' + v``)."""
    if v is None:
        return "null"
    if v is UNDEF:
        return "undefined"
    if isinstance(v, str):
        return v
    if isinstance(v, (bool, int, float)):
        return _num_text(v)
    if isinstance(v, list):
        return ",".join("" if nullish(x) else js_str(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def to_locale(n: float | int) -> str:
    """JavaScript ``n.toLocaleString('en-US')`` for a number: thousands commas, at most 3 decimals."""
    if isinstance(n, float) and (math.isnan(n) or math.isinf(n)):
        return "NaN" if math.isnan(n) else ("∞" if n > 0 else "-∞")
    d = Decimal(repr(n) if isinstance(n, float) else n).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    sign = "-" if d < 0 else ""
    whole, _, frac = f"{abs(d):f}".partition(".")
    frac = frac.rstrip("0")
    text = f"{int(whole):,}"
    if sign and (int(whole) or frac):
        text = sign + text
    return text + ("." + frac if frac else "")


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def _plain(v: Any) -> Any:
    """Turn a value into what ``JSON.stringify`` would write, ready for :mod:`json`.

    Whole-number floats become ints (JavaScript does not tell them apart), NaN and Infinity become
    null, and object keys whose value is UNDEF are dropped. In lists, UNDEF becomes null.
    """
    if v is UNDEF:
        return None
    if isinstance(v, bool) or v is None or isinstance(v, (str, int)):
        return v
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return int(v) if v.is_integer() and abs(v) < 2**63 else v
    if isinstance(v, dict):
        return {str(k): _plain(x) for k, x in v.items() if x is not UNDEF}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return {}
    raise TypeError(f"Cannot write {type(v).__name__} as JSON")


def js_json(v: Any) -> str:
    """JavaScript ``JSON.stringify(v)``, byte for byte (keys stay in insertion order)."""
    if v is UNDEF:
        return "undefined"
    return json.dumps(_plain(v), separators=(",", ":"), ensure_ascii=False)


def clone(v: Any) -> Any:
    """The engine's ``clone``: a deep copy made by a JSON round trip, with the same side effects."""
    return json.loads(js_json(v))


def same_json(a: Any, b: Any) -> bool:
    """JavaScript ``JSON.stringify(a) === JSON.stringify(b)``."""
    return js_json(a) == js_json(b)


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _local(ts: Any) -> datetime | None:
    n = to_num(ts) if not isinstance(ts, (int, float)) else ts
    if isinstance(n, float) and (math.isnan(n) or math.isinf(n)):
        return None
    return datetime.fromtimestamp(n / 1000, tz=timezone.utc).astimezone(ENGINE_TZ)


def date_string(ts: Any) -> str:
    """JavaScript ``new Date(ts).toDateString()``, for example "Sun Nov 08 2026"."""
    d = _local(ts)
    if d is None:
        return "Invalid Date"
    return f"{_DAYS[d.weekday()]} {_MONTHS[d.month - 1]} {d.day:02d} {d.year}"


def short_date(ts: Any) -> str:
    """JavaScript ``toLocaleDateString('en-US', { month: 'short', day: 'numeric' })``, e.g. "Nov 8"."""
    d = _local(ts)
    if d is None:
        return "Invalid Date"
    return f"{_MONTHS[d.month - 1]} {d.day}"


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------

def unique(items: Iterable[Any]) -> list[Any]:
    """Keep the first of each repeated item, in order (JavaScript ``[...new Set(items)]``)."""
    out: list[Any] = []
    for x in items:
        if x not in out:
            out.append(x)
    return out


def trim(v: Any) -> str:
    """JavaScript ``String(v).trim()``."""
    return js_str(v).strip()


def text_or_blank(v: Any) -> str:
    """JavaScript ``String(v || '').trim()``, the engine's usual way to read a typed text field."""
    return js_str(js_or(v, "")).strip()


def strip_end(s: str, pattern: str) -> str:
    """JavaScript ``s.replace(/pattern$/, '')``: remove one match at the very end of the text."""
    return re.sub(pattern + r"\Z", "", s, count=1)
