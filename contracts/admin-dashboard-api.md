# Admin Dashboard API contract

The frontend calls these endpoints first and falls back to the hybrid Texas demo dataset only when they are unavailable.

## GET /admin/dashboard/overview

Returns:

```json
{
  "source": "live",
  "updatedAt": "2026-09-12T15:00:00Z",
  "criticalDistricts": 1,
  "activeIncidents": 3,
  "peopleAtRisk": 17,
  "activeResponders": 2,
  "districts": [
    {
      "id": "harris",
      "name": "Harris County",
      "shortName": "Harris",
      "riskScore": 86,
      "riskBand": "critical",
      "incidentCount": 6,
      "peopleAtRisk": 412,
      "activeResponders": 12,
      "safeZoneLoad": 64,
      "center": { "lat": 29.7604, "lng": -95.3698 }
    }
  ],
  "riskTrend": [{ "label": "-4h", "value": 44 }, { "label": "now", "value": 79 }],
  "safeZoneCapacity": { "total": 3860, "assigned": 977, "available": 2883, "loadPercent": 25 }
}
```

## GET /admin/dashboard/districts/{district_id}

Supported demo county IDs:

- `harris`
- `fort_bend`
- `brazoria`
- `galveston`

Returns the selected county summary plus `factors`, `incidents`, `safeZones`, and `responders`. Incident records should be sourced from the same emergency records used by `/emergencies`; safe-zone capacity and county risk may remain modeled until official feeds are connected.

## Trust rules

- Never label modeled county risk or modeled safe-zone capacity as official/live.
- Live SOS/responder state comes from backend emergency records.
- Unknown/failed feeds must degrade to `source: "hybrid"`, not fabricated live data.
- Admin authorization must be enforced server-side for `/admin/*` routes.
