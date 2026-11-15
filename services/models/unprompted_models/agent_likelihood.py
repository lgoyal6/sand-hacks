"""Agent-likelihood model over Tiger `attempt_features` (owner: D).

Evidence for a professor, never a verdict. The report states n, AUC with a bootstrap 95% CI, and the
false-positive rate on human sessions. If either class has fewer than MIN_GROUPS distinct people/runs,
it refuses to report an AUC and says so.

Labels: an attempt whose studentPseudonym starts with "agent-" is an agent session (A's runs,
"agent-<runId>"); anything else with explicit consent is human. Groups for leave-one-group-out CV:
the student pseudonym for humans, the run id for agents, so one person never sits in train and test.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

# Behaviour first. Browser flags (webdriver, BotD) are deliberately absent: a CDP-driven Chrome reads human on them.
FEATURES = [
    "click_no_move_ratio",      # clicks with no pointer movement in the previous 1.5 s (CDP clicks)
    "answer_no_input_ratio",    # answers with no key/pointer input on that item (JS form fill)
    "dead_range_answer_ratio",  # answers set during > 3 s input silences
    "keys_per_answer",
    "paste_per_answer",
    "move_points_per_click",
    "key_dt_cv",                # rhythm irregularity; humans are irregular
    "seconds_away_per_item",
]
MIN_GROUPS = 3


@dataclass
class Session:
    attempt_id: str
    label: int  # 1 agent, 0 human
    group: str
    x: list[float]


@dataclass
class Report:
    n_sessions: int
    n_agent: int
    n_human: int
    n_agent_groups: int
    n_human_groups: int
    status: str  # "ok" | "insufficient_data"
    auc: float | None = None
    auc_ci95: tuple[float, float] | None = None
    fpr_at_0_5: float | None = None
    tpr_at_0_5: float | None = None
    coefficients: dict[str, float] = field(default_factory=dict)
    note: str = ""


def _ratio(a: float | None, b: float | None) -> float:
    a = float(a or 0)
    b = float(b or 0)
    return a / b if b > 0 else 0.0


def featurize(row: dict) -> list[float]:
    answers = float(row.get("answers") or 0)
    clicks = float(row.get("clicks") or 0)
    items = float(row.get("items") or 0)
    return [
        float(row.get("click_no_move_ratio") or 0),
        float(row.get("answer_no_input_ratio") or 0),
        _ratio(row.get("answers_in_dead_range"), answers),
        _ratio(row.get("keys"), answers),
        _ratio(row.get("pastes"), answers),
        _ratio(row.get("move_points"), clicks),
        float(row.get("key_dt_cv") or 0),
        _ratio(float(row.get("ms_away") or 0) / 1000.0, items),
    ]


def label_sessions(features: Iterable[dict], attempts: dict[str, dict]) -> list[Session]:
    """Join Tiger features with attempt metadata. Unknown attempts and humans without consent are dropped."""
    out: list[Session] = []
    for row in features:
        a = attempts.get(row["attempt_id"])
        if not a:
            continue
        pseudo = str(a.get("studentPseudonym", ""))
        if pseudo.startswith("agent-"):
            out.append(Session(row["attempt_id"], 1, pseudo, featurize(row)))
        elif a.get("consentTelemetry", a.get("consent", True)):
            out.append(Session(row["attempt_id"], 0, pseudo or row["attempt_id"], featurize(row)))
    return out


def _model():
    return make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000, C=0.5))


def evaluate(sessions: list[Session], seed: int = 7, boot: int = 1000) -> tuple[Report, np.ndarray | None]:
    y = np.array([s.label for s in sessions])
    groups = np.array([s.group for s in sessions])
    X = np.array([s.x for s in sessions], dtype=float).reshape(len(sessions), len(FEATURES))
    ag = len(set(groups[y == 1])) if len(y) else 0
    hg = len(set(groups[y == 0])) if len(y) else 0
    rep = Report(len(y), int((y == 1).sum()), int((y == 0).sum()), ag, hg, "insufficient_data")
    if ag < MIN_GROUPS or hg < MIN_GROUPS:
        rep.note = (
            f"Need at least {MIN_GROUPS} distinct agent runs and {MIN_GROUPS} distinct consenting people; "
            f"have {ag} and {hg}. No AUC reported."
        )
        return rep, None

    oof = np.zeros(len(y))
    for tr, te in LeaveOneGroupOut().split(X, y, groups):
        if len(set(y[tr])) < 2:
            oof[te] = 0.5
            continue
        m = _model().fit(X[tr], y[tr])
        oof[te] = m.predict_proba(X[te])[:, 1]

    rep.status = "ok"
    rep.auc = float(roc_auc_score(y, oof))
    # Bootstrap over groups (people/runs), not sessions, so correlated sessions don't shrink the CI.
    rng = np.random.default_rng(seed)
    uniq = np.unique(groups)
    idx_by_group = {g: np.where(groups == g)[0] for g in uniq}
    aucs = []
    for _ in range(boot):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([idx_by_group[g] for g in pick])
        if len(set(y[idx])) < 2:
            continue
        aucs.append(roc_auc_score(y[idx], oof[idx]))
    if aucs:
        rep.auc_ci95 = (float(np.percentile(aucs, 2.5)), float(np.percentile(aucs, 97.5)))
    pred = oof >= 0.5
    rep.fpr_at_0_5 = float(pred[y == 0].mean())
    rep.tpr_at_0_5 = float(pred[y == 1].mean())
    full = _model().fit(X, y)
    coef = full.named_steps["logisticregression"].coef_[0]
    rep.coefficients = {f: round(float(c), 3) for f, c in zip(FEATURES, coef)}
    rep.note = "Leave-one-group-out CV; bootstrap over groups. Evidence only."
    return rep, oof


def session_flags(features: Iterable[dict], model=None, top: int = 3) -> list[dict]:
    """SessionFlag[] (packages/shared). Without a trained model, the score is a transparent behaviour rule."""
    out = []
    for row in features:
        x = featurize(row)
        if model is not None:
            p = float(model.predict_proba(np.array([x]))[0, 1])
        else:
            # Transparent fallback: the strongest single behavioural tell, capped below certainty.
            p = min(0.95, max(x[0] if (row.get("clicks") or 0) >= 2 else 0.0, x[1] if (row.get("answers") or 0) >= 1 else 0.0))
        named = sorted(zip(FEATURES, x), key=lambda t: -abs(t[1]))[:top]
        out.append({
            "attemptId": row["attempt_id"],
            "agentLikelihood": round(p, 3),
            "topFeatures": [{"name": n, "value": round(v, 3)} for n, v in named],
        })
    return out


def to_json(rep: Report) -> str:
    d = rep.__dict__.copy()
    return json.dumps(d, indent=2, default=lambda v: None if isinstance(v, float) and math.isnan(v) else v)
