from pathlib import Path

from app.services.lid_reports import reports, with_lid_reports

INP = """[LID_USAGE]
;;Sub LID Number Area Width InitSat FromImp ToPerv RptFile
S1   RainGarden  20  200  0  0  20  0
S2   PermPave    1   8000 40 0  30
S3   BioCell     6   500  0  0  20  0  own.txt  *  0

[JUNCTIONS]
J1 100 8
"""


def test_adds_report_files_only_where_missing(tmp_path: Path) -> None:
    inp = tmp_path / "m.inp"
    inp.write_text(INP)
    text, changed = with_lid_reports(INP, inp)
    assert changed
    lines = [ln for ln in text.splitlines() if ln.startswith(("S1", "S2", "S3"))]
    assert '.m.lid' in lines[0] and lines[0].split()[:8] == ["S1", "RainGarden", "20", "200", "0", "0", "20", "0"]
    assert lines[1].split()[:8] == ["S2", "PermPave", "1", "8000", "40", "0", "30", "0"]
    assert "own.txt" in lines[2] and ".m.lid" not in lines[2]
    assert "[JUNCTIONS]" in text


def test_reports_reads_texts_and_notes_missing(tmp_path: Path) -> None:
    inp = tmp_path / "m.inp"
    inp.write_text(INP)
    with_lid_reports(INP, inp)
    (tmp_path / ".m.lid" / "000__S1__RainGarden.txt").write_text("SWMM5 LID Report File\n")
    (tmp_path / "own.txt").write_text("SWMM5 LID Report File\nmine\n")
    got = reports(inp)
    assert [r["lid"] for r in got] == ["RainGarden", "PermPave", "BioCell"]
    assert got[0]["text"].startswith("SWMM5")
    assert got[1]["text"] is None and "run" in got[1]["note"]
    assert "mine" in got[2]["text"]
