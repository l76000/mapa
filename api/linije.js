export default function handler(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Linije</title>
 
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 
    <style>
        body { margin: 0; padding: 0; font-family: sans-serif; overflow: hidden; background: #eee; }
        #map { height: 100vh; width: 100%; z-index: 1; }
 
        .controls {
            position: absolute; top: 10px; right: 10px; z-index: 1000;
            background: rgba(255, 255, 255, 0.98); padding: 15px;
            border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            width: 260px; max-height: 70vh; overflow-y: auto;
        }
 
        h3 { margin: 0 0 10px 0; color: #333; font-size: 16px; display:flex; justify-content:space-between; }
        .badge { background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
 
        .input-group { display: flex; gap: 5px; margin-bottom: 10px; }
        input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; font-size: 16px; }
        button#addBtn { padding: 0 15px; background: #2980b9; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 18px; }
 
        #activeLines { list-style: none; padding: 0; margin: 0; }
        .line-item {
            background: #f8f9fa; margin-bottom: 6px; padding: 8px 12px; border-radius: 6px;
            border-left: 5px solid #95a5a6; 
            display: flex; justify-content: space-between; align-items: center; 
            font-weight: 600; font-size: 14px;
        }
        .remove-btn { color: #e74c3c; font-size: 20px; line-height: 1; padding-left: 10px; cursor: pointer; }
 
        .status-bar { margin-top: 10px; font-size: 11px; color: #666; border-top: 1px solid #eee; padding-top: 8px; }
 
        .bus-icon-container { background: none; border: none; }
        .bus-wrapper { position: relative; width: 50px; height: 56px; transition: all 0.3s ease; }
 
        .bus-circle {
            width: 32px; height: 32px; border-radius: 50%; 
            color: white; 
            display: flex; justify-content: center; align-items: center;
            font-weight: bold; font-size: 13px;
            border: 2px solid white; box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            position: absolute; top: 0; left: 50%; transform: translateX(-50%);
            z-index: 20;
        }
        
        .bus-garage-label {
            position: absolute; 
            top: 36px; 
            left: 50%; 
            transform: translateX(-50%);
            font-size: 9px;
            font-weight: bold;
            color: white;
            background: rgba(0, 0, 0, 0.7);
            padding: 2px 5px;
            border-radius: 3px;
            white-space: nowrap;
            z-index: 19;
        }
 
        .bus-arrow {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;
            transition: transform 0.5s linear;
        }
        .arrow-head {
            width: 0; height: 0; 
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-bottom: 12px solid #333;
            position: absolute; top: 0px; left: 50%; transform: translateX(-50%);
        }
 
        .popup-content { font-size: 13px; line-height: 1.4; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { font-weight: bold; color: #555; }

        .stop-marker-inner {
            width: 8px; height: 8px;
            background: white;
            border-radius: 50%;
            border: 2px solid #333;
        }
 
    </style>
</head>
<body>
 
    <div class="controls">
        <h3>Sva Vozila i Trase</h3>
 
        <div class="input-group">
            <input type="text" id="lineInput" placeholder="Linija (npr. 31, 860MV)" onkeypress="handleEnter(event)">
            <button id="addBtn" onclick="dodajLiniju()">+</button>
        </div>
 
        <ul id="activeLines"></ul>
 
        <div class="status-bar">
            Osvežavanje za: <b><span id="countdown">--</span>s</b><br>
            <span id="statusText">Učitavam podatke...</span>
        </div>
    </div>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>

        const map = L.map('map', { zoomControl: false }).setView([44.8125, 20.4612], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO'
        }).addTo(map);
 
        L.control.zoom({ position: 'bottomright' }).addTo(map);
 
        const routeLayer = L.layerGroup().addTo(map);
        const stopsLayer = L.layerGroup().addTo(map);
        const busLayer = L.layerGroup().addTo(map);
 
        let izabraneLinije = [];
        let timerId = null;
        let countdownId = null;
        let refreshTime = 5; 
        let timeLeft = 0;
        let vehicleHistory = {};
        
        // GTFS DATA HOLDERS
        let routeMappingData = {};
        let routeNamesMap = {};
        
        let shapesData = { normal: {}, gradske: {} };
        let tripsData = { normal: [], gradske: [] };
        let stopsData = { normal: {}, gradske: {} };
        let stopTimesData = { normal: {}, gradske: {} };
        let stationsMap = {}; 

        let lineColors = {}; 

        const colors = [
            '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', 
            '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
            '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
        ];

        function parseCSV(text) {
            if (!text || text.trim().startsWith('http')) return []; 
            const lines = text.split('\\n');
            const headers = lines[0].trim().split(',').map(h => h.trim().replace(/"/g, ''));
            const result = [];
            for(let i=1; i<lines.length; i++) {
                const line = lines[i].trim();
                if(!line) continue;
                // Basic CSV parsing handling quotes
                const row = {};
                let current = '';
                let inQuote = false;
                let colIndex = 0;
                
                for(let c=0; c<line.length; c++) {
                    const char = line[c];
                    if(char === '"') { inQuote = !inQuote; }
                    else if(char === ',' && !inQuote) {
                        row[headers[colIndex]] = current.trim();
                        current = '';
                        colIndex++;
                    } else {
                        current += char;
                    }
                }
                row[headers[colIndex]] = current.trim();
                result.push(row);
            }
            return result;
        }

        function parseShapesFile(text) {
            const lines = text.split('\\n');
            const shapes = {};
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const parts = line.split(',');
                if (parts.length < 4) continue;
                const shapeId = parts[0].trim();
                const lat = parseFloat(parts[1]);
                const lon = parseFloat(parts[2]);
                const sequence = parseInt(parts[3]);
                if (isNaN(lat) || isNaN(lon)) continue;
                if (!shapes[shapeId]) shapes[shapeId] = [];
                shapes[shapeId].push({ lat, lon, sequence });
            }
            Object.keys(shapes).forEach(k => shapes[k].sort((a,b) => a.sequence - b.sequence));
            return shapes;
        }

        async function loadAllGTFS() {
            try {
                // Route Mapping
                const mappingRes = await fetch('/route-mapping.json');
                routeMappingData = await mappingRes.json();
                routeNamesMap = routeMappingData;

                // Stations (API - fallback)
                try {
                    const stRes = await fetch('/api/stations');
                    stationsMap = await stRes.json();
                } catch(e) { console.log("Stations API fail"); }

                // SHAPES
                const s1 = fetch('/api/shapes.txt').then(r => r.text()).then(t => shapesData.normal = parseShapesFile(t));
                const s2 = fetch('/api/shapes_gradske.txt').then(r => r.text()).then(t => shapesData.gradske = parseShapesFile(t));

                // TRIPS
                const t1 = fetch('/api/trips.txt').then(r => r.text()).then(t => tripsData.normal = parseCSV(t));
                const t2 = fetch('/api/trips_gradske.txt').then(r => r.text()).then(t => tripsData.gradske = parseCSV(t));

                // STOPS
                const st1 = fetch('/api/stops.txt').then(r => r.text()).then(t => {
                    const rows = parseCSV(t);
                    rows.forEach(r => stopsData.normal[r.stop_id] = r);
                });
                const st2 = fetch('/api/stops_gradske.txt').then(r => r.text()).then(t => {
                    const rows = parseCSV(t);
                    rows.forEach(r => stopsData.gradske[r.stop_id] = r);
                });

                // STOP TIMES (Može biti veliko ili link)
                const stt1 = fetch('/api/stop_times.txt').then(r => r.text()).then(t => {
                    const rows = parseCSV(t);
                    rows.forEach(r => {
                        if(!stopTimesData.normal[r.trip_id]) stopTimesData.normal[r.trip_id] = [];
                        stopTimesData.normal[r.trip_id].push(r);
                    });
                });
                // Pokušaj za gradske stop_times
                const stt2 = fetch('/api/stop_times_gradske').then(r => r.text()).then(t => {
                    if(!t.trim().startsWith('http')) {
                         const rows = parseCSV(t);
                         rows.forEach(r => {
                            if(!stopTimesData.gradske[r.trip_id]) stopTimesData.gradske[r.trip_id] = [];
                            stopTimesData.gradske[r.trip_id].push(r);
                        });
                    }
                });

                await Promise.all([s1, s2, t1, t2, st1, st2, stt1, stt2]);
                console.log('GTFS Podaci učitani.');
                document.getElementById('statusText').innerText = 'Podaci spremni. Unesi liniju.';
            } catch (e) {
                console.error("Greška pri učitavanju GTFS:", e);
            }
        }

        function getShape(shapeId) {
            if (shapesData.gradske[shapeId]) return shapesData.gradske[shapeId];
            if (shapesData.normal[shapeId]) return shapesData.normal[shapeId];
            return null;
        }

        function getTripsForRoute(routeId) {
            // First check gradske
            let relevantTrips = tripsData.gradske.filter(t => t.route_id === routeId);
            let source = 'gradske';
            if (relevantTrips.length === 0) {
                relevantTrips = tripsData.normal.filter(t => t.route_id === routeId);
                source = 'normal';
            }
            return { trips: relevantTrips, source: source };
        }

        function getStopInfo(stopId, source) {
            if (source === 'gradske' && stopsData.gradske[stopId]) return stopsData.gradske[stopId];
            if (stopsData.normal[stopId]) return stopsData.normal[stopId];
            if (stopsData.gradske[stopId]) return stopsData.gradske[stopId];
            return null;
        }

        function getStopTimes(tripId, source) {
            if (source === 'gradske' && stopTimesData.gradske[tripId]) return stopTimesData.gradske[tripId];
            if (stopTimesData.normal[tripId]) return stopTimesData.normal[tripId];
            return [];
        }

        function dodajLiniju() {
            const input = document.getElementById('lineInput');
            const val = input.value.trim().toUpperCase();
            if (!val) return;
            
            if (izabraneLinije.some(l => l.userInput === val)) return;
            if (izabraneLinije.length >= 5) { alert("Max 5 linija!"); return; }

            let routeId = null;
            // Pokušaj mapiranje preko route-mapping
            for (const [key, value] of Object.entries(routeNamesMap)) {
                if (value.toUpperCase() === val || key.toString() === val) {
                    routeId = key;
                    break;
                }
            }
            if(!routeId) routeId = val; // Fallback

            // Dodeljivanje boja za smerove
            const colorIdx1 = (izabraneLinije.length * 2) % colors.length;
            const colorIdx2 = (izabraneLinije.length * 2 + 1) % colors.length;
            
            const lineObj = {
                id: routeId,
                userInput: val,
                colorDir0: colors[colorIdx1],
                colorDir1: colors[colorIdx2]
            };

            izabraneLinije.push(lineObj);
            
            nacrtajTrasuIStanice(lineObj);
            azurirajListu();
            osveziPodatke();
            input.value = '';
        }

        function nacrtajTrasuIStanice(lineObj) {
            const routeId = lineObj.id;
            const { trips, source } = getTripsForRoute(routeId);
            
            if(trips.length === 0) {
                console.log("Nema trips podataka za liniju", routeId);
                return;
            }

            // Nadji najčešći shape_id za direction_id 0 i 1
            const shapesByDir = { '0': {}, '1': {} };
            const representativeTrip = { '0': null, '1': null };

            trips.forEach(t => {
                const dir = t.direction_id || '0';
                const shape = t.shape_id;
                if(!shape) return;
                if(!shapesByDir[dir][shape]) shapesByDir[dir][shape] = 0;
                shapesByDir[dir][shape]++;
                // Save one trip ID to fetch stops later
                if(!representativeTrip[dir]) representativeTrip[dir] = t.trip_id; 
            });

            ['0', '1'].forEach(dir => {
                let bestShape = null;
                let maxCount = 0;
                for(const [sId, count] of Object.entries(shapesByDir[dir])) {
                    if(count > maxCount) { maxCount = count; bestShape = sId; }
                }

                const color = dir === '0' ? lineObj.colorDir0 : lineObj.colorDir1;

                // Draw Shape
                if(bestShape) {
                    const shapePoints = getShape(bestShape);
                    if(shapePoints) {
                        const latlngs = shapePoints.map(p => [p.lat, p.lon]);
                        L.polyline(latlngs, { color: color, weight: 4, opacity: 0.7 }).addTo(routeLayer);
                    }
                }

                // Draw Stops
                const tripId = representativeTrip[dir];
                if(tripId) {
                    const stopTimes = getStopTimes(tripId, source);
                    // Sort by stop_sequence
                    stopTimes.sort((a,b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
                    
                    stopTimes.forEach(st => {
                        const stopInfo = getStopInfo(st.stop_id, source);
                        if(stopInfo) {
                            const lat = parseFloat(stopInfo.stop_lat);
                            const lon = parseFloat(stopInfo.stop_lon);
                            
                            const marker = L.circleMarker([lat, lon], {
                                radius: 5,
                                fillColor: color,
                                color: '#fff',
                                weight: 1,
                                opacity: 1,
                                fillOpacity: 0.9
                            }).addTo(stopsLayer);

                            marker.bindPopup(`
                                <div class="popup-content">
                                    <div class="popup-row"><b>${stopInfo.stop_name}</b></div>
                                    <div class="popup-row">Smer: ${dir === '0' ? 'A' : 'B'}</div>
                                    <div class="popup-row">ID: ${stopInfo.stop_id}</div>
                                </div>
                            `);
                        }
                    });
                }
            });
        }

        function ukloniLiniju(routeId) {
            izabraneLinije = izabraneLinije.filter(l => l.id !== routeId);
            // Redraw everything simple approach: clear all and redraw remaining
            routeLayer.clearLayers();
            stopsLayer.clearLayers();
            busLayer.clearLayers();
            
            izabraneLinije.forEach(l => nacrtajTrasuIStanice(l));
            
            azurirajListu();
            osveziPodatke();
        }

        function azurirajListu() {
            const ul = document.getElementById('activeLines');
            ul.innerHTML = '';
            izabraneLinije.forEach((l) => {
                let displayName = routeMappingData[l.id] || l.userInput;
                // Try reverse mapping if needed
                for(let [k,v] of Object.entries(routeMappingData)) {
                    if(v === l.id) displayName = k;
                }

                ul.innerHTML += `
                    <li class="line-item" style="border-left: 5px solid ${l.colorDir0};">
                        <span>
                           Linija ${l.userInput} 
                           <span style="font-size:10px; color:${l.colorDir0}">●</span>
                           <span style="font-size:10px; color:${l.colorDir1}">●</span>
                        </span>
                        <span class="remove-btn" onclick="ukloniLiniju('${l.id}')">&times;</span>
                    </li>`;
            });
        }

        function calculateVehicleSpeed(vehicleId, currentPosition) {
            const now = Date.now();
            if (!vehicleHistory[vehicleId]) {
                vehicleHistory[vehicleId] = { position: currentPosition, timestamp: now, speed: null };
                return null;
            }
            const prev = vehicleHistory[vehicleId];
            const timeDiff = (now - prev.timestamp) / 1000;
            
            if (timeDiff < 2) return prev.speed; // Too fast update

            const R = 6371000;
            const dLat = (currentPosition.lat - prev.position.lat) * Math.PI / 180;
            const dLon = (currentPosition.lon - prev.position.lon) * Math.PI / 180;
            const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(prev.position.lat*Math.PI/180)*Math.cos(currentPosition.lat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c;

            const speedKmh = (distance / timeDiff) * 3.6;
            
            vehicleHistory[vehicleId] = { position: currentPosition, timestamp: now, speed: speedKmh < 100 ? Math.round(speedKmh) : 0 };
            return vehicleHistory[vehicleId].speed;
        }

        async function osveziPodatke() {
            if (izabraneLinije.length === 0) {
                startTimer(0);
                return;
            }

            document.getElementById('statusText').innerText = "Preuzimam vozila...";
            
            try {
                const response = await fetch('/api/vehicles', { cache: 'no-store' });
                if (!response.ok) throw new Error("Network");
                const data = await response.json();

                if (data && data.vehicles) {
                    crtajVozila(data.vehicles, data.tripUpdates || []);
                    const timeStr = new Date().toLocaleTimeString();
                    document.getElementById('statusText').innerHTML = `Ažurirano: <b>${timeStr}</b>`;
                }
            } catch (error) {
                document.getElementById('statusText').innerText = "Greška u osvežavanju.";
            }
            startTimer(refreshTime);
        }

        function crtajVozila(vehicles, tripUpdates) {
            busLayer.clearLayers();
            
            // Map trip updates to vehicles for destination info (optional)
            const updatesMap = {};
            tripUpdates.forEach(u => updatesMap[u.vehicleId] = u);

            const relevantVehicles = vehicles.filter(v => {
                 // Check if vehicle route matches any selected line
                 return izabraneLinije.some(l => {
                     // loose match because GTFS IDs can vary
                     return l.id === v.routeId || l.id === v.routeId.replace(/^0+/, ''); 
                 });
            });

            relevantVehicles.forEach(v => {
                // Find Line Object
                const lineObj = izabraneLinije.find(l => l.id === v.routeId || l.id === v.routeId.replace(/^0+/, ''));
                if(!lineObj) return;

                // Determine direction to pick color
                let color = '#333';
                // Most GTFS-RT feeds provide directionId (0 or 1)
                if(v.directionId === 0 || v.directionId === '0') color = lineObj.colorDir0;
                else if(v.directionId === 1 || v.directionId === '1') color = lineObj.colorDir1;
                else color = lineObj.colorDir0; // Default

                const speed = calculateVehicleSpeed(v.id, { lat: v.lat, lon: v.lon });
                let rotation = 0; // If api provides bearing use it, else calculate from history?
                // Using simple logic, if we have bearing in GTFS-RT use it (often field is 'bearing')
                if(v.bearing) rotation = v.bearing;

                const iconHtml = `
                    <div class="bus-wrapper">
                        <div class="bus-arrow" style="transform: rotate(${rotation}deg);">
                            <div class="arrow-head" style="border-bottom-color: ${color};"></div>
                        </div>
                        <div class="bus-circle" style="background: ${color};">
                            ${lineObj.userInput}
                        </div>
                        <div class="bus-garage-label">${v.label}</div>
                    </div>
                `;

                const icon = L.divIcon({
                    className: 'bus-icon-container',
                    html: iconHtml,
                    iconSize: [50, 56],
                    iconAnchor: [25, 28]
                });

                const popup = `
                    <div class="popup-content">
                        <div class="popup-row"><span class="popup-label">Linija:</span> <b>${lineObj.userInput}</b></div>
                        <div class="popup-row"><span class="popup-label">Garažni:</span> ${v.label}</div>
                        <div class="popup-row"><span class="popup-label">Brzina:</span> ${speed !== null ? speed + ' km/h' : '?'}</div>
                    </div>
                `;

                L.marker([v.lat, v.lon], {icon: icon}).bindPopup(popup).addTo(busLayer);
            });
        }

        function startTimer(seconds) {
            if (timerId) clearTimeout(timerId);
            if (countdownId) clearInterval(countdownId);
            if (seconds === 0) return;
            timeLeft = seconds;
            document.getElementById('countdown').innerText = timeLeft;
            countdownId = setInterval(() => {
                timeLeft--;
                if (timeLeft < 0) timeLeft = 0;
                document.getElementById('countdown').innerText = timeLeft;
            }, 1000);
            timerId = setTimeout(osveziPodatke, seconds * 1000);
        }

        function handleEnter(e) { if (e.key === 'Enter') dodajLiniju(); }

        // Start
        loadAllGTFS();

    </script>
</body>
</html>
  `;
 
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
