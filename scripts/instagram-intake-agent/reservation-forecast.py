"""Read observed intake budget inputs as JSON and print the earliest forecast refusal(s)."""
import json
import sys
from datetime import date, timedelta
from decimal import Decimal

DAY = timedelta(days=1)


def dollars(value):
    if type(value) not in (int, Decimal) or not Decimal(value).is_finite() or value < 0:
        raise ValueError("expected nonnegative USD")
    return Decimal(value)


def forecast(today, run_cap_usd, recent_charges_usd, intake=None, apify=None):
    reservation = dollars(run_cap_usd)
    if len(recent_charges_usd) > 7:
        raise ValueError("expected up to seven recent runs")
    charges = [dollars(charge) for charge in recent_charges_usd if charge is not None]
    projected = sum(charges) / len(charges) if charges else None
    tomorrow = today + DAY
    next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    refusals = []
    for name, budget, reset, required in (
        ("intake", intake, next_month, reservation - Decimal("0.000000001")),
        ("apify", apify, date.fromisoformat(apify["reset_date"]) if apify and apify.get("reset_date")
         else tomorrow + 3 * DAY, reservation + Decimal("0.02")),
    ):
        if budget is None:
            continue
        limit, usage = dollars(budget["limit_usd"]), dollars(budget["usage_usd"])
        balance = limit - usage
        run_date = tomorrow
        while run_date < reset:
            if balance < required:
                refusals.append({"budget": name, "run_date": run_date.isoformat(), "usage_usd": float(usage),
                                 "limit_usd": float(limit), "reservation_usd": float(reservation)})
                break
            if projected is None:
                break
            balance -= projected
            run_date += DAY
    first_date = min((refusal["run_date"] for refusal in refusals), default=None)
    return [refusal for refusal in refusals if refusal["run_date"] == first_date]


if __name__ == "__main__":
    inputs = json.load(sys.stdin, parse_float=Decimal)
    inputs["today"] = date.fromisoformat(inputs["today"])
    print(json.dumps(forecast(**inputs)))
