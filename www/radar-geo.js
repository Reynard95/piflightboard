/* radar-geo.js — geographic data for the PPI radar
 * Keep RECEIVER in sync with config/readsb.conf --lat / --lon.
 */

const RECEIVER = { lat: 52.0116, lon: 4.7683 };

const KM_PER_LAT = 111.32;
const KM_PER_LON = 111.32 * Math.cos(RECEIVER.lat * Math.PI / 180); // ≈ 68.55

/**
 * Convert a geographic coordinate to canvas (x, y).
 * @param {number} lat
 * @param {number} lon
 * @param {number} cx   canvas centre x
 * @param {number} cy   canvas centre y
 * @param {number} r    inner radar circle radius in pixels
 * @param {number} rangeKm  current range in km (full radius = this many km)
 */
function geoToXY(lat, lon, cx, cy, r, rangeKm) {
  const dx = (lon - RECEIVER.lon) * KM_PER_LON;
  const dy = (lat - RECEIVER.lat) * KM_PER_LAT;
  return [cx + (dx / rangeKm) * r, cy - (dy / rangeKm) * r];
}

/* ── Country outlines ───────────────────────────────────────────────────────
 * Each entry is an array of [lat, lon] pairs forming a closed polygon.
 * Covers the area visible within ~250 km of the receiver.
 * ─────────────────────────────────────────────────────────────────────────── */
const GEO_POLYGONS = [
  // Netherlands
  [[51.37,3.36],[51.48,3.82],[51.65,3.86],[51.80,3.83],[52.02,3.94],
   [52.31,4.08],[52.54,4.22],[52.76,4.74],[53.00,4.78],[53.22,4.94],
   [53.47,5.42],[53.46,6.15],[53.35,7.20],[52.54,7.05],[52.38,7.07],
   [52.24,6.97],[51.98,6.85],[51.84,6.42],[51.68,6.20],[51.54,6.22],
   [51.50,6.09],[51.26,5.69],[51.25,5.03],[51.26,4.77],[51.38,4.65],
   [51.37,4.23],[51.37,3.36]],
  // Belgium
  [[51.37,3.36],[51.05,2.56],[50.83,2.88],[50.65,3.54],[50.73,3.86],
   [50.34,4.86],[50.14,4.87],[50.15,5.83],[49.55,5.82],[49.47,5.99],
   [50.13,6.30],[50.75,6.10],[51.19,6.05],[51.20,5.02],[51.26,4.77],
   [51.38,4.65],[51.37,4.23],[51.37,3.36]],
  // Luxembourg
  [[49.47,5.99],[49.80,6.52],[50.13,6.30],[49.47,5.99]],
  // N France
  [[51.05,2.56],[50.96,1.86],[50.55,1.62],[50.25,1.78],[50.00,1.98],
   [49.75,3.10],[50.00,3.08],[50.14,3.50],[50.14,4.87],[50.65,3.54],
   [50.83,2.88],[51.05,2.56]],
  // W Germany
  [[53.35,7.20],[53.60,7.80],[53.86,8.80],[54.05,9.50],[54.20,9.80],
   [54.18,10.20],[53.80,10.50],[53.55,10.00],[53.00,9.50],[52.50,8.80],
   [52.00,8.40],[51.60,7.60],[51.20,6.85],[50.75,6.10],[50.13,6.30],
   [49.47,5.99],[49.80,6.52],[50.13,6.30],[51.19,6.05],[51.50,6.09],
   [51.68,6.20],[51.84,6.42],[51.98,6.85],[52.38,7.07],[52.54,7.05],
   [53.35,7.20]],
  // SE England (visible at 250 km)
  [[51.35,1.45],[51.15,1.42],[51.00,1.10],[50.88,0.95],[50.77,0.30],
   [50.84,-0.10],[51.15,0.00],[51.48,0.12],[51.75,1.20],[51.35,1.45]],
];

/* ── Airports ───────────────────────────────────────────────────────────────
 * Major airports within ~250 km of the receiver.
 * ─────────────────────────────────────────────────────────────────────────── */
const GEO_AIRPORTS = [
  { iata:'AMS', lat:52.308, lon:4.764  },
  { iata:'RTM', lat:51.957, lon:4.437  },
  { iata:'EIN', lat:51.450, lon:5.374  },
  { iata:'MST', lat:50.911, lon:5.770  },
  { iata:'LGG', lat:50.637, lon:5.443  },
  { iata:'ANR', lat:51.189, lon:4.460  },
  { iata:'DUS', lat:51.289, lon:6.767  },
  { iata:'CGN', lat:50.866, lon:7.142  },
  { iata:'BRU', lat:50.901, lon:4.484  },
  { iata:'BRE', lat:53.048, lon:8.787  },
  { iata:'HAM', lat:53.630, lon:10.006 },
  { iata:'LGW', lat:51.148, lon:-0.190 },
  { iata:'LHR', lat:51.477, lon:-0.461 },
];
