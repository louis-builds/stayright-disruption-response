"""Offline batch refit for SystemSettings.UnresolvedTurnThreshold.

Two independent, opposite-direction signals feed this, since either one
alone is blind to the other's failure mode:

1. Raise signal -- coordinator escalation reviews (Case.EscalationReviewedAsReasonable)
   scoped to Case.EscalationTrigger = 'unresolved_turns'. A reviewed-unreasonable
   case means the turn-count rule fired too early at that guest-turn count --
   evidence the threshold is too LOW.
2. Lower signal -- coordinator "missed escalation" reviews on disliked AI replies
   that never escalated (Message.Vote = 'dislike', Escalated = false,
   MissedEscalationConfirmed = true). A confirmed-missed case means a guest got
   that many turns in without ever reaching the turn-count trigger -- evidence
   the threshold is too HIGH.

Each direction has its own minimum-sample gate and its own +-1-per-run step
clamp, and each is reported independently -- never netted against the other,
since they come from different populations (cases that did escalate vs. ones
that didn't) and conflating them would hide which signal is actually driving
a suggested change. Never writes to the database -- a human reads the report
and updates SystemSettings by hand if they agree.

Usage:
    python -m scripts.refit_turn_threshold
"""

from __future__ import annotations

from src.identify.db import get_connection

MIN_SAMPLES = 30
MAX_STEP_PER_RUN = 1

_FETCH_REVIEWED_TURN_ESCALATIONS = """
    SELECT
        c.escalation_reviewed_as_reasonable,
        (
            SELECT count(*)
            FROM messages m
            WHERE m.case_id = c.id
              AND m.thread = 'ai'
              AND m.sender_role = 'guest'
              AND m.created_at <= (
                  SELECT min(m2.created_at)
                  FROM messages m2
                  WHERE m2.case_id = c.id
                    AND m2.thread = 'ai'
                    AND m2.escalated = true
              )
        ) AS guest_turns_at_escalation
    FROM cases c
    WHERE c.escalation_trigger = 'unresolved_turns'
      AND c.escalation_reviewed_as_reasonable IS NOT NULL
"""

_FETCH_CONFIRMED_MISSED_ESCALATIONS = """
    SELECT (
        SELECT count(*)
        FROM messages g
        WHERE g.case_id = m.case_id
          AND g.thread = 'ai'
          AND g.sender_role = 'guest'
          AND g.created_at <= m.created_at
    ) AS guest_turns_at_dislike
    FROM messages m
    WHERE m.sender_role = 'ai'
      AND m.vote = 'dislike'
      AND m.escalated = false
      AND m.missed_escalation_confirmed = true
"""

_FETCH_CURRENT_THRESHOLD = "SELECT unresolved_turn_threshold FROM system_settings LIMIT 1"


def suggest_raise(current: int, rows: list[tuple[bool, int]]) -> int:
    """Suggest a raised threshold from (was_reasonable, turns_at_escalation) rows.

    Unnecessary escalations (was_reasonable=False) at low turn counts are
    the signal that the threshold fires too early -- the suggestion is the
    smallest turn count among those, so raising the threshold to that
    would have avoided them. If no unreasonable escalations exist, there
    is nothing to fix; keep the current value.
    """
    unreasonable_turns = [turns for reasonable, turns in rows if not reasonable]
    if not unreasonable_turns:
        return current
    return max(current, min(unreasonable_turns) + 1)


def suggest_lower(current: int, missed_turns: list[int]) -> int:
    """Suggest a lowered threshold from confirmed-missed-escalation turn counts.

    Each entry is how many guest turns had already happened when a reply
    that should have escalated got disliked. The smallest such count is the
    new ceiling: setting the threshold at or below it would have caught
    every observed miss (larger counts trigger too, once the smallest does).
    """
    if not missed_turns:
        return current
    return min(current, min(missed_turns))


def clamp_step(current: int, suggested: int, max_step: int = MAX_STEP_PER_RUN) -> int:
    diff = suggested - current
    step = max(-max_step, min(max_step, diff))
    return current + step


def main() -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(_FETCH_CURRENT_THRESHOLD)
        row = cur.fetchone()
        if row is None:
            print("SystemSettings row not found -- nothing to refit.")
            return
        current = row[0]

        cur.execute(_FETCH_REVIEWED_TURN_ESCALATIONS)
        escalation_rows = list(cur.fetchall())

        cur.execute(_FETCH_CONFIRMED_MISSED_ESCALATIONS)
        missed_turns = [turns for (turns,) in cur.fetchall()]

    print(f"当前值={current}")

    raise_n = len(escalation_rows)
    if raise_n < MIN_SAMPLES:
        print(f"【上调信号】样本不足：{raise_n}条已复核的 unresolved_turns 转人工案例（需要 >= {MIN_SAMPLES}），跳过。")
    else:
        raised = suggest_raise(current, escalation_rows)
        clamped = clamp_step(current, raised)
        print(f"【上调信号】本次样本={raise_n}条，建议值={raised}，限步长后={clamped}")

    lower_n = len(missed_turns)
    if lower_n < MIN_SAMPLES:
        print(f"【下调信号】样本不足：{lower_n}条已确认漏转的差评案例（需要 >= {MIN_SAMPLES}），跳过。")
    else:
        lowered = suggest_lower(current, missed_turns)
        clamped = clamp_step(current, lowered)
        print(f"【下调信号】本次样本={lower_n}条，建议值={lowered}，限步长后={clamped}")

    print("以上建议均不会自动生效，需要人工确认后手动更新 SystemSettings.UnresolvedTurnThreshold。")


if __name__ == "__main__":
    main()
