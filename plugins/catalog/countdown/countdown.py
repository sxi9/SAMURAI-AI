"""SAMURAI marketplace plugin: days until a date. Installed by POST /plugins/install {url: "plugins/catalog/countdown"}."""
import datetime, re

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def parse_date(arg):
    s = (arg or "").lower().strip()
    today = datetime.date.today()
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?", s) or re.search(r"([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?", s)
    if m:
        a, b, y = m.group(1), m.group(2), m.group(3)
        day, mon = (int(a), MONTHS.get(b)) if a.isdigit() else (int(b), MONTHS.get(a))
        if not mon:
            return None
        d = datetime.date(int(y) if y else today.year, mon, day)
        if not y and d < today:
            d = d.replace(year=today.year + 1)
        return d
    return None


def days_until(arg):
    d = parse_date(arg)
    if not d:
        return "Tell me a date, like 25 December or 2027-01-01."
    n = (d - datetime.date.today()).days
    if n == 0:
        return f"That is today, {d:%d %B}."
    if n < 0:
        return f"{d:%d %B %Y} was {-n} days ago."
    return f"{n} day{'s' if n != 1 else ''} until {d:%d %B %Y}."


PLUGIN = {
    "name": "countdown",
    "description": "Days until a date.",
    "tools": [{"type": "days_until", "description": "count the days until a date; arg = the date (25 december, 2027-01-01)", "run": days_until}],
}
