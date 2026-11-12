"""SAMURAI meter: per-provider token and cost counter with a monthly budget. Mounted into the add-ons sidecar (:9500).

POST /meter {provider, model, input, output, cost_usd?, kind?}   -> {"ok", "month": {...}}  (the HUD reports every reply, fire and forget)
GET  /meter[?period=day|month|all]                               -> {"ok", "period", "total_usd", "tokens", "calls", "by_provider": {...},
                                                                     "budget_usd", "over_budget", "warning", "spoken": "..."}
Config: meter.monthly_budget_usd (0 = no budget). Log: data/meter.jsonl (one line per call). Prices are approximate list prices per
million tokens (PRICES below); a call that carries its own cost_usd (Claude Code reports one) is logged as is. Local and headless
providers (ollama, lmstudio, llamacpp, geminicli) cost nothing. A warning is raised at 80 % of the budget, over_budget past it."""
import json, os, threading, time

from samurai_common import DATA, load_config

METER_PATH = os.path.join(DATA, "meter.jsonl")
LOCK = threading.Lock()
# USD per million tokens (input, output), approximate list prices; unknown models fall back to the provider's default row
PRICES = {
    "openai": {"gpt-4o-mini": (0.15, 0.6), "gpt-4o": (2.5, 10), "gpt-4.1": (2, 8), "gpt-4.1-mini": (0.4, 1.6), "o3-mini": (1.1, 4.4), "*": (2.5, 10)},
    "claude": {"claude-haiku": (1, 5), "claude-sonnet": (3, 15), "claude-opus": (15, 75), "claude-fable": (15, 75), "*": (3, 15)},
    "claudecode": {"claude-haiku": (1, 5), "claude-sonnet": (3, 15), "claude-opus": (15, 75), "claude-fable": (15, 75), "*": (3, 15)},
    "gemini": {"gemini-2.0-flash": (0.1, 0.4), "gemini-2.5-flash": (0.3, 2.5), "gemini-2.5-pro": (1.25, 10), "*": (0.3, 2.5)},
    "openrouter": {"*": (1, 3)}, "groq": {"*": (0.59, 0.79)}, "mistral": {"mistral-small": (0.1, 0.3), "mistral-large": (2, 6), "*": (0.4, 2)},
    "deepseek": {"*": (0.27, 1.1)}, "xai": {"grok-3-mini": (0.3, 0.5), "*": (3, 15)}, "perplexity": {"*": (1, 1)}, "together": {"*": (0.88, 0.88)},
    "huggingface": {"*": (0.5, 0.5)}, "azure": {"*": (2.5, 10)}, "custom": {"*": (0, 0)},
    "ollama": {"*": (0, 0)}, "lmstudio": {"*": (0, 0)}, "llamacpp": {"*": (0, 0)}, "geminicli": {"*": (0, 0)},
}
TTS_PRICES = {"elevenlabs": 0.00018, "openai": 0.000015, "cartesia": 0.00005, "azure": 0.000016}      # USD per character, approximate


def price(provider, model):
    table = PRICES.get(provider) or {"*": (1, 3)}
    model = (model or "").lower()
    for key, row in table.items():
        if key != "*" and key in model:
            return row
    return table["*"]


def estimate(provider, model, n_in, n_out):
    pi, po = price(provider, model)
    return round((n_in * pi + n_out * po) / 1e6, 6)


def budget():
    try:
        return float((load_config().get("meter") or {}).get("monthly_budget_usd") or 0)
    except (TypeError, ValueError):
        return 0.0


def append(entry):
    os.makedirs(DATA, exist_ok=True)
    with LOCK, open(METER_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def entries(since):
    out = []
    if not os.path.exists(METER_PATH):
        return out
    with LOCK, open(METER_PATH, encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("t", 0) >= since:
                out.append(e)
    return out


def period_start(period):
    now = time.localtime()
    if period == "day":
        return time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, 0, 0, -1))
    if period == "all":
        return 0
    return time.mktime((now.tm_year, now.tm_mon, 1, 0, 0, 0, 0, 0, -1))


def summary(period="month"):
    period = period if period in ("day", "month", "all") else "month"
    by, total, tokens, calls = {}, 0.0, 0, 0
    for e in entries(period_start(period)):
        p = by.setdefault(e.get("provider", "?"), {"usd": 0.0, "input": 0, "output": 0, "calls": 0})
        p["usd"] += e.get("usd", 0); p["input"] += e.get("input", 0); p["output"] += e.get("output", 0); p["calls"] += 1
        total += e.get("usd", 0); tokens += e.get("input", 0) + e.get("output", 0); calls += 1
    for p in by.values():
        p["usd"] = round(p["usd"], 4)
    b = budget()
    over, warn = (b > 0 and total >= b), (b > 0 and total >= 0.8 * b)
    spoken = f"{'About ' if total else ''}{total:.2f} dollars this {period if period != 'all' else 'lifetime'} over {calls} calls"
    if b > 0:
        spoken += f", {'over' if over else 'of'} your {b:.0f} dollar budget" + (" - you are over budget." if over else (" - nearly there." if warn else "."))
    else:
        spoken += "."
    return {"ok": True, "period": period, "total_usd": round(total, 4), "tokens": tokens, "calls": calls, "by_provider": by,
            "budget_usd": b, "over_budget": over, "warning": warn, "spoken": spoken}


def post_meter(h, q, b):
    provider = (b.get("provider") or "").strip()[:40]
    if not provider:
        raise ValueError("provider required")
    n_in, n_out = int(b.get("input") or 0), int(b.get("output") or 0)
    kind = (b.get("kind") or "chat")[:20]
    if b.get("cost_usd") not in (None, ""):
        usd = float(b.get("cost_usd") or 0)
    elif kind == "tts":
        usd = round(TTS_PRICES.get(provider, 0) * int(b.get("chars") or 0), 6)
    else:
        usd = estimate(provider, b.get("model"), n_in, n_out)
    append({"t": time.time(), "provider": provider, "model": (b.get("model") or "")[:60], "kind": kind, "input": n_in, "output": n_out, "usd": usd})
    s = summary("month")
    return {"ok": True, "usd": usd, "month": {k: s[k] for k in ("total_usd", "budget_usd", "over_budget", "warning", "spoken")}}


def get_meter(h, q, b):
    return summary(q.get("period") or "month")


ROUTES = {("POST", "/meter"): post_meter, ("GET", "/meter"): get_meter}


def start_threads():
    pass
