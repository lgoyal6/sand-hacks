"""Code-path tests only. These rows are hand-written test inputs, not data, and are never reported."""
from unprompted_models.agent_likelihood import Session, evaluate, label_sessions, session_flags


def row(aid, **kw):
    base = dict(attempt_id=aid, items=5, keys=0, pastes=0, clicks=0, move_points=0, click_no_move_ratio=None,
                answers=5, answers_without_item_input=0, answer_no_input_ratio=0, answers_in_dead_range=0,
                key_dt_cv=None, ms_away=0)
    base.update(kw)
    return base


def test_labels_agents_by_pseudonym_and_drops_unknown():
    feats = [row("a1"), row("h1"), row("zz")]
    attempts = {"a1": {"studentPseudonym": "agent-run-1"}, "h1": {"studentPseudonym": "student-x"}}
    s = label_sessions(feats, attempts)
    assert [(x.attempt_id, x.label, x.group) for x in s] == [("a1", 1, "agent-run-1"), ("h1", 0, "student-x")]


def test_refuses_auc_with_too_few_groups():
    s = [Session("a", 1, "agent-1", [0] * 8), Session("h", 0, "p1", [1] * 8)]
    rep, oof = evaluate(s)
    assert rep.status == "insufficient_data" and rep.auc is None and oof is None


def test_separable_toy_case_runs_cv():
    s = [Session(f"a{i}", 1, f"agent-{i}", [1, 1, 1, 0, 0, 0, 0, 0]) for i in range(4)]
    s += [Session(f"h{i}", 0, f"p{i}", [0, 0, 0, 20 + i, 0, 30, 0.6, 2]) for i in range(4)]
    rep, _ = evaluate(s, boot=50)
    assert rep.status == "ok" and rep.auc == 1.0 and rep.fpr_at_0_5 == 0.0


def test_rule_flags_without_model():
    flags = session_flags([row("x", clicks=4, click_no_move_ratio=1.0), row("y", keys=40, clicks=3, click_no_move_ratio=0.0, move_points=90)])
    assert flags[0]["agentLikelihood"] == 0.95 and flags[1]["agentLikelihood"] == 0.0
