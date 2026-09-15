# Emergency contacts and shelter route display

The **Emergency contacts** button sits beside **Ask Nav AI** in the admin Overview, below the Nav AI card on citizen Home, and in the Nav AI toolbar. It opens a bundled directory that does not require a backend request to display its numbers.

## Area selection

The Riverside map selects Nepal/Kathmandu and labels that choice as the map area. **Use my location** requests a fresh device location and reverse-geocodes the country; it does not infer the country from language, phone locale, or a rough bounding box. **Use map area** resolves the journey origin in live mode. Users can explicitly choose Nepal, United States, Houston, or San Marcos. An unknown country or failed lookup does not default to 911. Geographic lookup requires network access; manual area selection works offline.

The directory is curated coverage for these areas, not a claim to list every local responder or current vehicle availability. Local websites supplement the national emergency numbers. It does not dispatch a vehicle. Calling requires explicit user action; simulator builds show an explanation instead of opening the telephone handler. Copy number and website/source links remain available.

## Sources checked September 15, 2026

| Area | Service | Number | Source |
| --- | --- | --- | --- |
| Nepal | Police | 100 | [Ncell emergency services](https://www.ncell.com.np/en/individual/emergency-services-information), [Nepal Police](https://www.nepalpolice.gov.np/) |
| Nepal | Fire | 101 | [Ncell emergency services](https://www.ncell.com.np/en/individual/emergency-services-information) |
| Nepal | Ambulance | 102 | [Ncell emergency services](https://www.ncell.com.np/en/individual/emergency-services-information), [US State Department Nepal information](https://travel.state.gov/en/international-travel/travel-advisories/nepal.html) |
| Nepal | Army search and rescue coordination | 1191 | [Ncell emergency services](https://www.ncell.com.np/en/individual/emergency-services-information) |
| Nepal | Bipad disaster helpline | 1234 | [Ncell emergency services](https://www.ncell.com.np/en/individual/emergency-services-information) |
| Nepal | Traffic support | 103 | [Ncell emergency services](https://www.ncell.com.np/en/individual/emergency-services-information) |
| United States | Police, fire, ambulance and emergency coordination | 911 | [National 911 Program](https://www.911.gov/calling-911/) |
| United States | Community resources, non-emergency | 211 | [United Way 211](https://www.211.org/) |

Local information pages: [San Marcos 911](https://www.sanmarcostx.gov/1472/9-1-1-What-to-do), [Houston 911](https://www.houstontx.gov/police/contact/911.htm). Texas air rescue information: [DPS Aircraft Operations Division](https://www.dps.texas.gov/section/aircraft-operations-division) and its [search and rescue information](https://www.dps.texas.gov/section/aircraft-operations-division/videos/dps-aircraft-operations-division-search-and-rescue).

The **Air / helicopter rescue** category directs people to emergency/search-and-rescue coordination. It does not advertise a dedicated helicopter hotline or promise an aircraft. Routing an inquiry through these coordination services is an application workflow decision; aircraft suitability and availability belong to responders.

## Green shelter route

**Route to shelter** stays on the map and frames the returned selected route. A thick green line with a white outline connects the starting point to the selected open shelter. The shelter name, distance and approximate time appear beneath the button. Alternative and excluded candidates are initially hidden; users can reveal them or open **Directions & alternatives**. Ordinary destination routes retain their existing color.

Green identifies the selected route to a recorded open shelter; it does not certify every road segment as safe. Flood/blocked-road observations are screened before selection. No green route is shown when the backend finds no reachable open shelter or fails to obtain directions. The backend rechecks shelter availability after route calculation to catch a concurrent closure or expiry.
