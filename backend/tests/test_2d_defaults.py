from app.services.inp_model_service import (
    fast_2d_solver_defaults,
    length_unit_from_flow_units,
    length_unit_from_proj4,
)


def test_length_unit_from_flow_units():
    assert length_unit_from_flow_units("CFS") == "ft"
    assert length_unit_from_flow_units("GPM") == "ft"
    assert length_unit_from_flow_units("CMS") == "m"
    assert length_unit_from_flow_units("LPS") == "m"
    assert length_unit_from_flow_units(None) is None


def test_length_unit_from_proj4():
    assert length_unit_from_proj4("+proj=lcc +units=us-ft +no_defs") == "ft"
    assert length_unit_from_proj4("+proj=utm +units=m +no_defs") == "m"
    assert length_unit_from_proj4(None) is None


def test_fast_defaults_metric_vs_us():
    m = fast_2d_solver_defaults("m")
    ft = fast_2d_solver_defaults("ft")
    assert m["dry_depth"] == 0.001
    assert ft["dry_depth"] == 0.003
    assert ft["abs_tolerance"] > m["abs_tolerance"]
    assert m["max_timestep"] == 10.0
    assert m["rel_tolerance"] == 0.005
    assert m["min_timestep"] == 0.001
