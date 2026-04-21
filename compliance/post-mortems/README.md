# Post-mortems Index

This folder stores blameless post-mortems for every declared security or operational incident (SEV-0 / SEV-1 always, SEV-2 when lessons are material, SEV-3 at the responder's discretion).

## Filing rule

Within 10 business days of incident close, publish `INC-<id>.md` here. Missing a deadline is itself a finding to track.

## Template

```
# Post-mortem INC-<id>

- Severity: SEV-N
- Declared (UTC): 
- Mitigated (UTC): 
- Closed (UTC): 
- Incident commander: 
- Authors: 

## Summary

## Timeline (UTC)

| Time | Event |

## What went well

## What went poorly

## Root cause

## Contributing factors

## Regulatory filings

| Authority | Filing | Due | Submitted |

## Action items

| # | Description | Owner | Due | Status |

## Review

- [ ] Reviewed by Security Lead
- [ ] Reviewed by Engineering Lead
- [ ] Reviewed by DPO (if personal data involved)
```

## Entries

_No post-mortems filed. If you are reading this section after a real incident, the responder should have opened a PR adding `INC-<id>.md` alongside the evidence pack._
