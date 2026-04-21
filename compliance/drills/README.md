# Drills Index

This folder records the outcomes of scheduled security and resilience drills.

## Cadence

- **Quarterly kill-switch live-fire** (NIS2 Art. 21(2)(f) + DORA Art. 11(6)).
- **Semi-annual incident tabletop** (ISO 27001 A.5.24).
- **Annual full-restoration drill** (BC policy §4).

## File naming

`YYYY-QN-<drill-type>.md` (e.g., `2026-Q2-kill-switch.md`).

## Template

```
# Drill <drill-type> — <quarter>

- Date (UTC): 
- Participants: 
- Scope: 
- Objective: 
- Pre-conditions: 
- Start (UTC): 
- End (UTC): 

## Timeline

| T+ | Actor | Action | Result |

## Measurements

| Metric | Target | Observed |
|---|---|---|
| Time to fire | < 1 ms (local) | |
| Time to mesh-wide acknowledge | < 100 ms | |
| Ledger entry `kill_fired` present | yes | |

## Findings

- 

## Action items

- [ ] 

## Sign-off

- Incident commander: 
- Observer: 
```

## Entries

_No drills recorded yet. First live-fire scheduled for 2026-Q2._
