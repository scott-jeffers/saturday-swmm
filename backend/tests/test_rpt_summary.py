from pathlib import Path

from app.services.rpt_service import parse_report

RPT = (Path(__file__).parent / "fixtures" / "sample_report.txt").read_text()


def test_summary_numbers():
    d = parse_report(RPT)
    assert d["runoff_continuity_pct"] == -0.005
    assert d["routing_continuity_pct"] == 0.11
    assert d["flooded_nodes"] == 1 and d["flood_volume"] == 0.143
    assert d["flood_volume_units"] == "10^6 gal"
    assert d["surcharged_conduits"] == 0


def test_tables_have_columns_units_and_object_kind():
    t = {x["title"]: x for x in parse_report(RPT)["tables"]}
    depth = t["Node Depth Summary"]
    assert depth["object"] == "node"
    assert depth["columns"][3] == "Maximum Depth" and depth["units"][3] == "Feet"
    assert depth["rows"][0][:4] == ["J1", "JUNCTION", 0.19, 0.45]
    link = t["Link Flow Summary"]
    assert link["object"] == "link" and link["units"][5] == "ft/sec"
