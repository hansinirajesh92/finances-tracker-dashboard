import csv
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# ----------------------------
# Paths (auto-detected)
# ----------------------------
# This file lives in: <project_root>/etl/etl_chase_to_normalized.py
# So project_root is one folder up from this script's directory.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
OUT_DIR = PROJECT_ROOT / "data" / "sample"

# ----------------------------
# Config: map each raw file to account_id + "source" type
# ----------------------------
RAW_SOURCES = [
    {"path": RAW_DIR / "chase_checking_raw.csv", "account_id": "acc_checking", "kind": "checking"},
    {"path": RAW_DIR / "chase_savings_raw.csv", "account_id": "acc_savings", "kind": "savings"},
    {"path": RAW_DIR / "chase_credit_card_raw.csv", "account_id": "acc_cc1", "kind": "credit_card"},
]

# ----------------------------
# Simple categorization rules (expand later / load from rules.csv)
# ----------------------------
RULES: List[Tuple[str, str, Optional[str]]] = [
    (r"SUNRISE APTS|RENT", "cat_housing", "cat_rent"),
    (r"CITY ELECTRIC", "cat_housing", "cat_utilities"),
    (r"NETWAVE INTERNET", "cat_housing", "cat_internet"),
    (r"FRESHMART|SUPERSAVER", "cat_food", "cat_groceries"),
    (r"BELLA PIZZA|SUSHI YAMA|COFFEE CORNER", "cat_food", "cat_dining"),
    (r"METROCARD|TRANSIT", "cat_transport", "cat_transit"),
    (r"QUICKFUEL", "cat_transport", "cat_gas"),
    (r"AUTOCARE", "cat_transport", "cat_auto"),
    (r"PHARMAPLUS", "cat_health", "cat_pharmacy"),
    (r"HLTH INS|INS PREMIUM", "cat_health", "cat_insurance"),
    (r"STREAMFLIX", "cat_entertainment", "cat_streaming"),
    (r"MOVIEHOUSE", "cat_entertainment", "cat_events"),
    (r"STYLEHUB", "cat_shopping", "cat_clothes"),
    (r"HOMEGOODS", "cat_shopping", "cat_homegoods"),
    (r"PAYROLL", "cat_income", None),
    (r"MONTHLY SERVICE FEE|FOREIGN TRANSACTION FEE", "cat_fees", None),
    (r"SAVINGS INTEREST", "cat_interest", None),
    (r"ONLINE TRANSFER|CREDIT CARD PAYMENT", "cat_transfers", None),
    (r"CLDBOX|CLOUDBOX|STORAGE PLAN", "cat_entertainment", "cat_streaming"),
]

TRANSFER_PAT = re.compile(r"ONLINE TRANSFER|CREDIT CARD PAYMENT", re.IGNORECASE)

def parse_mmddyyyy(s: str) -> str:
    """Convert '01/02/2026' -> '2026-01-02'"""
    dt = datetime.strptime(s.strip(), "%m/%d/%Y")
    return dt.strftime("%Y-%m-%d")

def detect_payment_method(kind: str, description: str) -> str:
    desc = description.upper()
    if "PAYROLL" in desc:
        return "direct_deposit"
    if "BILLPAY" in desc or "ACH" in desc or "AUTOPAY" in desc:
        return "ach"
    if TRANSFER_PAT.search(desc):
        return "transfer"
    if kind == "credit_card":
        return "card"
    return "unknown"

def categorize(description: str) -> Tuple[str, str]:
    desc = description.upper()
    for pat, cat, subcat in RULES:
        if re.search(pat, desc):
            return cat, (subcat or "")
    return "cat_uncategorized", ""

def merchant_from_description(description: str) -> str:
    """Basic cleanup: later you can replace with a better merchant-normalizer."""
    d = description.strip()

    replacements = [
        (r"^ACME PAYROLL DIRECT DEP$", "Acme Payroll"),
        (r"ACH RENT SUNRISE APTS", "Sunrise Apartments"),
        (r"CHASE ONLINE BILLPAY CITY ELECTRIC", "City Electric"),
        (r"CHASE AUTOPAY NETWAVE INTERNET", "NetWave Internet"),
        (r"CHASE ONLINE TRANSFER.*", "Chase Online Transfer"),
        (r"CHASE CREDIT CARD PAYMENT", "Chase Credit Card Payment"),
        (r"CHASE MONTHLY SERVICE FEE", "Chase Service Fee"),
        (r"CHASE FOREIGN TRANSACTION FEE", "Chase Fee"),
        (r"CHASE SAVINGS INTEREST", "Chase Savings Interest"),
    ]
    for pat, merch in replacements:
        if re.search(pat, d, re.IGNORECASE):
            return merch

    return d.title()

def normalize_row(kind: str, account_id: str, row: Dict[str, str]) -> Dict[str, str]:
    # All three raw formats in this demo share these columns:
    # Transaction Date, Post Date, Description, Amount (+ optional Memo)
    date = parse_mmddyyyy(row["Transaction Date"])
    posted = parse_mmddyyyy(row["Post Date"])
    description = row["Description"].strip()
    amount = float(row["Amount"])

    is_transfer = bool(TRANSFER_PAT.search(description))
    category_id, subcategory_id = categorize(description)
    merchant = merchant_from_description(description)
    payment_method = detect_payment_method(kind, description)

    return {
        "date": date,
        "posted_date": posted,
        "account_id": account_id,
        "amount": f"{amount:.2f}",
        "merchant": merchant,
        "description": description,
        "category_id": category_id,
        "subcategory_id": subcategory_id,
        "payment_method": payment_method,
        "is_transfer": "true" if is_transfer else "false",
        "notes": row.get("Memo", "").strip(),
    }

def load_csv(path: Path) -> List[Dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def make_transaction_id(i: int) -> str:
    return f"tx_raw_{i:05d}"

def main():
    print(f"PROJECT_ROOT: {PROJECT_ROOT}")
    print(f"RAW_DIR:      {RAW_DIR}")
    print(f"OUT_DIR:      {OUT_DIR}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rows_out: List[Dict[str, str]] = []
    unmatched: List[Dict[str, str]] = []

    for src in RAW_SOURCES:
        p: Path = src["path"]
        if not p.exists():
            raise FileNotFoundError(
                f"Missing file: {p}\n"
                f"Make sure the filename matches exactly and it's inside: {RAW_DIR}"
            )

        raw_rows = load_csv(p)
        for r in raw_rows:
            norm = normalize_row(src["kind"], src["account_id"], r)

            if norm["category_id"] == "cat_uncategorized":
                unmatched.append({"source_file": str(p), **norm})

            rows_out.append(norm)

    rows_out.sort(key=lambda x: (x["date"], x["posted_date"], x["account_id"]))

    out_path = OUT_DIR / "transactions.csv"
    unmatched_path = OUT_DIR / "transactions_unmatched.csv"

    fields = [
        "transaction_id",
        "date",
        "posted_date",
        "account_id",
        "amount",
        "merchant",
        "description",
        "category_id",
        "subcategory_id",
        "payment_method",
        "is_transfer",
        "notes",
    ]

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for i, row in enumerate(rows_out, start=1):
            w.writerow({"transaction_id": make_transaction_id(i), **row})

    # Write unmatched (helpful when your real data comes in)
    if unmatched:
        with open(unmatched_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["source_file"] + fields[1:])  # no transaction_id here
            w.writeheader()
        for row in unmatched:
            w.writerow(row)
        print(f"⚠️  Wrote {unmatched_path} ({len(unmatched)} rows)")
    else:
        # Remove stale unmatched file from previous runs
        if unmatched_path.exists():
            unmatched_path.unlink()

    print(f"\n✅ Wrote {out_path} ({len(rows_out)} rows)")
    if unmatched:
        print(f"⚠️  Wrote {unmatched_path} ({len(unmatched)} rows)")

if __name__ == "__main__":
    main()