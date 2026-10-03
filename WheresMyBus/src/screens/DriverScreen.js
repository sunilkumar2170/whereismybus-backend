import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ScrollView, Modal,
  Dimensions, StatusBar, AppState,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { io } from 'socket.io-client';
import { SOCKET_URL, logout, getToken, getRouteByBus } from '../services/api';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import axios from 'axios';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const LOCATION_TASK = 'BUS_BG_LOCATION_TASK';
const API = 'https://whereismybus-backend.onrender.com';

let _bgSocket = null;
// ── module-level busId ref — TaskManager.defineTask runs OUTSIDE the
// component so it can't read component state. We keep the current
// driver's busId here and update it whenever the driver logs in / trip
// starts, so the background task always sends the correct bus's GPS.
let _bgBusId = null;

// ─── BACKGROUND TASK ───
// Yeh tab bhi chalega jab app bilkul band ho
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) { console.log('[BG ERR]', error.message); return; }
  if (!data?.locations?.length) return;
  if (!_bgBusId) { console.log('[BG] Skipped — no busId assigned'); return; }
  const loc = data.locations[0];
  const { latitude, longitude, speed, heading } = loc.coords;
  const kmh = speed != null && speed >= 0 ? Math.round(speed * 3.6) : 0;
  const busId = _bgBusId;

  if (_bgSocket?.connected) {
    _bgSocket.emit('sendLocation', {
      busId, lat: latitude, lng: longitude, speed: kmh, heading,
    });
    console.log('[BG] Sent:', busId, latitude, longitude, kmh + 'km/h');
  } else {
    try {
      await axios.post(`${API}/api/buses/location`, {
        busId, lat: latitude, lng: longitude, speed: kmh, heading,
      });
      console.log('[BG HTTP] Sent:', busId, latitude, longitude);
    } catch (e) {
      console.log('[BG HTTP] Failed:', e.message);
    }
  }
});

// ─── MAP HTML ───
const DRIVER_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=10.0,minimum-scale=0.5,user-scalable=yes">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;width:100%;overflow:hidden;background:#e8eaf0;-webkit-user-select:none;user-select:none}
#map{position:absolute;top:0;left:0;right:0;bottom:0;touch-action:pan-x pan-y pinch-zoom;will-change:transform}
.leaflet-bottom.leaflet-left{bottom:80px!important;left:12px!important}
.leaflet-control-zoom{border:none!important;box-shadow:0 3px 18px rgba(0,0,0,0.22)!important;border-radius:16px!important;margin:0!important;overflow:hidden}
.leaflet-control-zoom-in,.leaflet-control-zoom-out{width:56px!important;height:56px!important;line-height:56px!important;font-size:32px!important;color:#444!important;background:#fff!important;border:none!important;display:block!important;text-align:center!important}
.leaflet-control-zoom-in:active,.leaflet-control-zoom-out:active{background:#f0fff4!important}
.leaflet-control-zoom-in{border-bottom:1px solid #eee!important}
.leaflet-control-attribution{font-size:8px!important;opacity:0.2}
.leaflet-popup-content-wrapper{border-radius:12px!important;border:none!important;padding:0!important}
.leaflet-popup-content{margin:0!important}
.leaflet-popup-tip-container{display:none!important}
@keyframes pulse{0%{transform:scale(0.55);opacity:1}100%{transform:scale(2.5);opacity:0}}
.fab{position:fixed;right:14px;width:54px;height:54px;border-radius:50%;background:#fff;border:none;outline:none;box-shadow:0 3px 16px rgba(0,0,0,0.22);font-size:22px;z-index:9000;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;transition:transform 0.1s ease}
.fab:active{transform:scale(0.86)}
#btnLocate{bottom:88px}
.dirArrow{transition:transform 0.2s linear}
</style>
</head>
<body>
<div id="map"></div>
<button class="fab" id="btnLocate" onclick="locateMe()">&#127919;</button>
<script>
var map=L.map('map',{
  zoomControl:true,attributionControl:true,
  tap:true,tapTolerance:30,touchZoom:true,pinchZoom:true,
  bounceAtZoomLimits:false,zoomSnap:0.1,zoomDelta:0.5,
  wheelPxPerZoomLevel:40,wheelDebounceTime:15,
  maxZoom:21,minZoom:4,preferCanvas:true,
  renderer:L.canvas({padding:0.6,tolerance:12})
}).setView([26.9124,75.7873],15);
map.zoomControl.setPosition('bottomleft');

L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en&scale=2',{
  subdomains:['0','1','2','3'],maxZoom:21,
  updateWhenIdle:false,updateWhenZooming:false,
  keepBuffer:8,detectRetina:true,attribution:'\u00a9 Google Maps'
}).addTo(map);

var stopsLayer=L.layerGroup().addTo(map);
var routeLayer=L.layerGroup().addTo(map);
var arrowsLayer=L.layerGroup().addTo(map);
var driverToFirstLayer=L.layerGroup().addTo(map);

// ── bearing between two lat/lng points, in degrees (0=N,90=E,180=S,270=W) ──
function bearingDeg(lat1,lng1,lat2,lng2){
  var toRad=function(d){return d*Math.PI/180;};
  var toDeg=function(r){return r*180/Math.PI;};
  var y=Math.sin(toRad(lng2-lng1))*Math.cos(toRad(lat2));
  var x=Math.cos(toRad(lat1))*Math.sin(toRad(lat2))-Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lng2-lng1));
  return (toDeg(Math.atan2(y,x))+360)%360;
}

// ── draws Google-Maps style chevron/turn arrows along the route,
// spaced by real-world distance so long straight stretches get more
// arrows and short turns still get at least one. Rotated to match
// the bus's actual travel direction stop-to-stop (left/right turns
// show automatically because bearing changes at each stop). ──
function drawRouteArrows(coords){
  arrowsLayer.clearLayers();
  if(!coords||coords.length<2) return;
  for(var i=0;i<coords.length-1;i++){
    var a=coords[i], b=coords[i+1];
    var brng=bearingDeg(a[0],a[1],b[0],b[1]);
    var segDist=map.distance(a,b); // meters
    var arrowCount=Math.max(1,Math.min(5,Math.floor(segDist/110)));
    for(var k=1;k<=arrowCount;k++){
      var f=k/(arrowCount+1);
      var lat=a[0]+(b[0]-a[0])*f;
      var lng=a[1]+(b[1]-a[1])*f;
      var icon=L.divIcon({
        html:'<div class="dirArrow" style="width:24px;height:24px;transform:rotate('+brng+'deg)">'
          +'<svg width="24" height="24" viewBox="0 0 24 24">'
          +'<path d="M12 3 L19 19 L12 15 L5 19 Z" fill="#1A73E8" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>'
          +'<\/svg><\/div>',
        className:'',iconSize:[24,24],iconAnchor:[12,12]
      });
      L.marker([lat,lng],{icon:icon,interactive:false,zIndexOffset:250}).addTo(arrowsLayer);
    }
  }
}

window.initStops=function(stopsJson){
  stopsLayer.clearLayers(); routeLayer.clearLayers(); arrowsLayer.clearLayers();
  var stops=JSON.parse(stopsJson);
  if(!stops||!stops.length) return;
  if(stops.length>1){
    var coords=stops.map(function(s){return[parseFloat(s.lat),parseFloat(s.lng)];});
    L.polyline(coords,{color:'#a8c7fa',weight:14,opacity:0.35,lineJoin:'round',lineCap:'round'}).addTo(routeLayer);
    L.polyline(coords,{color:'#1A73E8',weight:6,opacity:0.95,lineJoin:'round',lineCap:'round',smoothFactor:1.5}).addTo(routeLayer);
    drawRouteArrows(coords);
    try {
      var bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } catch(err){}
  }
  stops.forEach(function(s,i){
    var isFirst=(i===0),isLast=(i===stops.length-1);
    var col=isFirst?'#34A853':isLast?'#EA4335':'#1A73E8', r=isFirst?12:isLast?13:8;
    L.circleMarker([parseFloat(s.lat),parseFloat(s.lng)],{radius:r,fillColor:col,color:'#fff',weight:3,fillOpacity:1,pane:'markerPane'})
     .addTo(stopsLayer).bindPopup('<div style="padding:9px 13px;font-size:14px;font-weight:bold;color:'+col+'">'+(isFirst?'\u{1F7E2} ':isLast?'\u{1F3EB} ':'\u{1F4CD} ')+s.name+'</div>',{closeButton:false,offset:[0,-6]});
    if(isFirst){
      L.marker([parseFloat(s.lat),parseFloat(s.lng)],{icon:L.divIcon({html:'<div style="background:#34A853;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 8px rgba(52,168,83,0.45);margin-top:18px">START<\/div>',className:'',iconSize:[52,22],iconAnchor:[26,-5]}),interactive:false,zIndexOffset:400}).addTo(stopsLayer);
    }
  });
};

window.drawDriverToFirst=function(dLat,dLng,fLat,fLng){
  driverToFirstLayer.clearLayers();
  L.polyline([[dLat,dLng],[fLat,fLng]],{color:'#00D4AA',weight:4,opacity:0.85,dashArray:'10,8',lineJoin:'round',lineCap:'round'}).addTo(driverToFirstLayer);
};
window.clearDriverToFirst=function(){ driverToFirstLayer.clearLayers(); };

var driverIcon=L.divIcon({
  html:'<div style="position:relative;width:46px;height:46px">'
    +'<div style="position:absolute;width:68px;height:68px;border-radius:50%;background:rgba(0,212,170,0.2);margin-left:-11px;margin-top:-11px;animation:pulse 2s ease-out infinite;pointer-events:none"></div>'
    +'<div id="busWrap" style="background:#0A0F1C;border:3.5px solid #00D4AA;border-radius:50%;width:46px;height:46px;display:flex;align-items:center;justify-content:center;box-shadow:0 5px 20px rgba(0,212,170,0.5);position:relative;z-index:2;font-size:23px;transition:transform 0.5s ease">\u{1F68C}<\/div>'
    +'<div id="spd" style="position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);background:#00D4AA;color:#0A0F1C;font-size:10px;font-weight:700;border-radius:7px;padding:2px 7px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,212,170,0.4);transition:background 0.3s">Stopped<\/div>'
    +'</div>',
  className:'',iconSize:[46,70],iconAnchor:[23,23]
});

var curLat=26.9124,curLng=75.7873;
var driverMarker=L.marker([curLat,curLng],{icon:driverIcon,zIndexOffset:3000,keyboard:false})
  .addTo(map).bindPopup('<div style="padding:9px 13px"><div style="font-size:14px;font-weight:bold;color:#00D4AA">\u{1F68C} Your Location<\/div><\/div>',{closeButton:false,offset:[0,-48]});

var animId=null,tgtLat=curLat,tgtLng=curLng,following=true;
function easeLinear(t){return t;}
function animDriver(){
  if(animId){cancelAnimationFrame(animId);animId=null;}
  var sLat=curLat,sLng=curLng,eLat=tgtLat,eLng=tgtLng;
  var dist=Math.sqrt(Math.pow(eLat-sLat,2)+Math.pow(eLng-sLng,2));
  if(dist>0.02){curLat=eLat;curLng=eLng;driverMarker.setLatLng([curLat,curLng]);if(following)map.panTo([curLat,curLng],{animate:false});return;}
  var t0=null,dur=950;
  function step(ts){
    if(!t0)t0=ts;
    var p=Math.min((ts-t0)/dur,1),e=easeLinear(p);
    curLat=sLat+(eLat-sLat)*e;curLng=sLng+(eLng-sLng)*e;
    driverMarker.setLatLng([curLat,curLng]);
    if(p<1){animId=requestAnimationFrame(step);}
    else{curLat=eLat;curLng=eLng;animId=null;}
  }
  animId=requestAnimationFrame(step);
  if(following)map.panTo([eLat,eLng],{animate:true,duration:0.95,easeLinearity:0.1,noMoveStart:true});
}
map.on('dragstart',function(){following=false;});
function locateMe(){following=true;map.flyTo([curLat,curLng],17,{animate:true,duration:0.8});}

window.driverMove=function(lat,lng,spd,heading){
  tgtLat=parseFloat(lat);tgtLng=parseFloat(lng);
  var s=Math.max(0,parseInt(spd)||0);
  var el=document.getElementById('spd');
  if(el){el.textContent=s>0?s+' km\/h':'Stopped';el.style.background=s>60?'#F44336':s>40?'#FF9800':'#00D4AA';el.style.color=s>40?'#fff':'#0A0F1C';}
  if(heading!=null&&!isNaN(heading)&&s>2){var w=document.getElementById('busWrap');if(w)w.style.transform='rotate('+heading+'deg)';}
  animDriver();
};
map.whenReady(function(){setTimeout(function(){map.invalidateSize({animate:false});},250);});
<\/script>
</body>
</html>`;

export default function DriverScreen({ user, onLogout }) {
  const [tripStarted,  setTripStarted]  = useState(false);
  const [startingTrip, setStartingTrip] = useState(false); // double tap block
  const [speed,        setSpeed]        = useState(0);
  const [sosActive,    setSosActive]    = useState(false);
  const [connected,    setConnected]    = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tripTime,     setTripTime]     = useState(0);
  const [accuracy,     setAccuracy]     = useState(null);
  const [updateCount,  setUpdateCount]  = useState(0);
  const [bgActive,     setBgActive]     = useState(false);
  const [route,        setRoute]        = useState(null);   // { id, name, stops:[...] }
  const [routeFetchFailed, setRouteFetchFailed] = useState(false);

  // ── busId (internal identifier, used for API/socket calls) vs
  // busNo (human-readable, e.g. "RJ 37 PE 5505" — used for DISPLAY only).
  // Never render busId to the user — that was the earlier bug
  // ("shows UUID / always No Bus Assigned"). ──
  const busId = user?.busId || null;   // real DB id, or null if none assigned
  const busNo = user?.busNo || null;   // human-readable plate number

  const stops = route?.stops || [];

  // ── Three independent states, so a bus-assigned-but-route-not-yet-
  // created driver still sees their bus number instead of a scary
  // "No Bus Assigned" warning: ──
  // hasBus   → driver has a busId from login (Admin linked them to a bus)
  // hasRoute → that bus additionally has a Route+Stops set up
  const hasBus   = !!busId;
  const hasRoute = !!(route && stops.length);

  console.log('[DRIVER] busId:', busId, 'busNo:', busNo, 'hasRoute:', hasRoute);

  const socketRef     = useRef(null);
  const locationSub   = useRef(null);
  const timerRef       = useRef(null);
  const webViewRef    = useRef(null);
  const fsWebViewRef  = useRef(null);
  const lastPos       = useRef({ lat: 26.9124, lng: 75.7873, speed: 0 });
  const appStateRef   = useRef(AppState.currentState);
  const stopsRef       = useRef([]);
  const tripActiveRef  = useRef(false);
  const busIdRef       = useRef(busId);

  useEffect(() => { busIdRef.current = busId; _bgBusId = busId; }, [busId]);

  // ── Socket ──
  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionAttempts: Infinity,
    });
    socketRef.current.on('connect', () => {
      setConnected(true);
      // ✅ Driver apne bus ke room mein join karta hai (agar bus assigned hai)
      if (busIdRef.current) {
        socketRef.current.emit('joinAsDriver', { busId: busIdRef.current });
        console.log('Driver joined room for bus:', busIdRef.current);
      }
    });
    socketRef.current.on('disconnect', () => setConnected(false));
    _bgSocket = socketRef.current;
    _bgBusId  = busIdRef.current;
    if (busIdRef.current) fetchRoute();
    return () => {
      _bgSocket = null;
      socketRef.current?.disconnect();
    };
  }, []);

  // ── Fetch Route (Bus → Route → Stops) for THIS driver's bus ──
  const fetchRoute = useCallback(async () => {
    if (!busIdRef.current) return;
    try {
      const token = await getToken();
      const r = await getRouteByBus(busIdRef.current, token);
      setRoute(r);
      setRouteFetchFailed(false);
      const stopsArr = r?.stops || [];
      stopsRef.current = stopsArr;
      if (stopsArr.length) {
        const js = `window.initStops(${JSON.stringify(JSON.stringify(stopsArr))}); true;`;
        webViewRef.current?.injectJavaScript(js);
        fsWebViewRef.current?.injectJavaScript(js);
      }
    } catch (e) {
      console.log('route err:', e);
      setRoute(null);
      setRouteFetchFailed(true);
    }
  }, []);

  // ── AppState listener ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (!tripActiveRef.current) return;

      if (prev === 'active' && nextState === 'background') {
        console.log('[AppState] → Background');
        if (locationSub.current) {
          locationSub.current.remove();
          locationSub.current = null;
        }
        setBgActive(true);
      } else if (prev.match(/inactive|background/) && nextState === 'active') {
        console.log('[AppState] → Foreground');
        setBgActive(false);
        startForegroundWatcher();
      }
    });
    return () => sub.remove();
  }, []);

  // ── Start foreground GPS watcher ──
  const startForegroundWatcher = useCallback(async () => {
    if (locationSub.current) return;
    try {
      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy        : Location.Accuracy.BestForNavigation,
          timeInterval    : 1000,
          distanceInterval: 0,
        },
        (loc) => {
          const { latitude, longitude, speed: spd, heading, accuracy: acc } = loc.coords;
          const kmh = spd != null && spd >= 0 ? Math.round(spd * 3.6) : 0;
          setSpeed(kmh);
          setAccuracy(acc ? Math.round(acc) : null);
          setUpdateCount(c => c + 1);
          lastPos.current = { lat: latitude, lng: longitude, speed: kmh };
          inject(latitude, longitude, kmh, heading);
          drawDriverToFirst(latitude, longitude);
          socketRef.current?.emit('sendLocation', {
            busId: busIdRef.current, lat: latitude, lng: longitude, speed: kmh, heading,
          });
        }
      );
    } catch (e) {
      console.log('[FG Watcher] Error:', e.message);
    }
  }, []);

  // ── Start background task — app band hone pe bhi chale ──
  const startBgTask = async () => {
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
      if (isRunning) return;
      _bgBusId = busIdRef.current;
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy          : Location.Accuracy.BestForNavigation,
        timeInterval      : 2000,
        distanceInterval  : 0,
        deferredUpdatesInterval: 2000,
        deferredUpdatesDistance: 0,
        foregroundService : {
          notificationTitle  : '🚌 Where Is My Bus — Live Tracking Active',
          notificationBody   : `Sharing live location for ${busNo || busIdRef.current}`,
          notificationColor  : '#00D4AA',
          sticky: true,
        },
        pausesUpdatesAutomatically      : false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.AutomotiveNavigation,
      });
      console.log('[BG Task] Started ✅ for', busIdRef.current);
    } catch (e) {
      console.log('[BG Task] Start failed:', e.message);
    }
  };

  // ── Stop background task ──
  const stopBgTask = async () => {
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
        console.log('[BG Task] Stopped ✅');
      }
    } catch (e) {
      console.log('[BG Task] Stop failed:', e.message);
    }
  };

  // ── Inject to both WebViews ──
  const inject = useCallback((lat, lng, spd, heading) => {
    const hdg = (heading != null && !isNaN(heading)) ? heading : 'null';
    const js  = `window.driverMove(${lat},${lng},${spd},${hdg}); true;`;
    webViewRef.current?.injectJavaScript(js);
    fsWebViewRef.current?.injectJavaScript(js);
  }, []);

  const drawDriverToFirst = useCallback((lat, lng) => {
    if (!stopsRef.current.length) return;
    const first = stopsRef.current[0];
    const js = `window.drawDriverToFirst(${lat},${lng},${parseFloat(first.lat)},${parseFloat(first.lng)}); true;`;
    webViewRef.current?.injectJavaScript(js);
    fsWebViewRef.current?.injectJavaScript(js);
  }, []);

  const onMapLoad = useCallback(() => {
    const { lat, lng, speed: spd } = lastPos.current;
    setTimeout(() => {
      webViewRef.current?.injectJavaScript(`window.driverMove(${lat},${lng},${spd},null); true;`);
      if (stopsRef.current.length) {
        webViewRef.current?.injectJavaScript(`window.initStops(${JSON.stringify(JSON.stringify(stopsRef.current))}); true;`);
      }
    }, 700);
  }, []);

  const onFsMapLoad = useCallback(() => {
    const { lat, lng, speed: spd } = lastPos.current;
    setTimeout(() => {
      fsWebViewRef.current?.injectJavaScript(`window.driverMove(${lat},${lng},${spd},null); true;`);
      if (stopsRef.current.length) {
        fsWebViewRef.current?.injectJavaScript(`window.initStops(${JSON.stringify(JSON.stringify(stopsRef.current))}); true;`);
      }
    }, 700);
  }, []);

  // ── START TRIP ──
  const startTrip = useCallback(async () => {
    if (startingTrip || tripStarted) return; // double tap block
    if (!busIdRef.current) {
      Alert.alert('No Bus Assigned', 'Admin ne abhi tak aapko koi bus assign nahi kiya hai.');
      return;
    }
    setStartingTrip(true);

    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Permission Required', 'Location permission is required to start trip.');
      setStartingTrip(false);
      return;
    }

    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert(
        '⚠️ Important!',
        'Background location chahiye taaki app band hone pe bhi tracking ho.\n\nSettings → Apps → Where Is My Bus → Permissions → Location → "Allow all the time" select karo',
        [{ text: 'OK' }]
      );
    }

    setTripStarted(true);
    setTripTime(0);
    setUpdateCount(0);
    setBgActive(false);
    tripActiveRef.current = true;
    setStartingTrip(false);

    timerRef.current = setInterval(() => setTripTime(t => t + 1), 1000);

    // Backend ko batao trip start hui — Bus status ON_TRIP ho jaaye
    try {
      const token = await getToken();
      await axios.post(`${API}/api/trips/start`,
        { busId: busIdRef.current },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (e) { console.log('trip start api:', e.message); }

    await startBgTask();
    await startForegroundWatcher();

  }, [startingTrip, tripStarted, startForegroundWatcher]);

  // ── STOP TRIP ──
  const stopTrip = useCallback(async () => {
    tripActiveRef.current = false;
    setTripStarted(false);
    setSosActive(false);
    setSpeed(0);
    setTripTime(0);
    setAccuracy(null);
    setUpdateCount(0);
    setBgActive(false);

    webViewRef.current?.injectJavaScript(`window.clearDriverToFirst(); true;`);
    fsWebViewRef.current?.injectJavaScript(`window.clearDriverToFirst(); true;`);

    if (locationSub.current) {
      locationSub.current.remove();
      locationSub.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    await stopBgTask();

    try {
      const token = await getToken();
      await axios.post(`${API}/api/trips/end`,
        { busId: busIdRef.current },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (e) { console.log('trip end api:', e.message); }
  }, []);

  // ── SOS — Notification bhi bhejo ──
  const triggerSOS = useCallback(async () => {
    const next = !sosActive;
    setSosActive(next);

    socketRef.current?.emit('sos', {
      busId: busIdRef.current, driverName: user?.name || 'Driver', message: 'SOS Emergency!',
    });

    if (next) {
      try {
        await axios.post(`${API}/api/test-sos`, { busId: busIdRef.current });
        console.log('SOS notification sent to all parents ✅');
      } catch (err) {
        console.log('SOS notification error:', err.message);
      }
    }

    Alert.alert('SOS', next ? '🚨 Emergency sent to all parents!' : 'SOS cancelled');
  }, [sosActive, user]);

  const formatTime = s => {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const speedColor = speed > 60 ? '#F44336' : speed > 40 ? '#FF9800' : '#00D4AA';

  const DriverMapView = useCallback(({ wvRef, onLoad }) => (
    <View style={StyleSheet.absoluteFill}
      onStartShouldSetResponder={() => false}
      onMoveShouldSetResponder={() => false}>
      <WebView
        ref={wvRef}
        source={{ html: DRIVER_MAP_HTML }}
        style={{ flex: 1 }}
        javaScriptEnabled domStorageEnabled
        scrollEnabled={false} nestedScrollEnabled={false}
        originWhitelist={['*']} mixedContentMode="always"
        allowsInlineMediaPlayback androidLayerType="hardware"
        androidHardwareAccelerationDisabled={false}
        startInLoadingState={false} bounces={false} overScrollMode="never"
        onLoadEnd={onLoad}
        onError={e => console.log('MapErr:', e.nativeEvent)}
      />
    </View>
  ), []);

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0F1C" />

      {/* FULLSCREEN MODAL */}
      <Modal visible={isFullscreen} animationType="fade" statusBarTranslucent onRequestClose={() => setIsFullscreen(false)}>
        <View style={s.fsContainer}>
          <DriverMapView wvRef={fsWebViewRef} onLoad={onFsMapLoad} />
          <TouchableOpacity style={s.fsClose} onPress={() => setIsFullscreen(false)}>
            <Text style={s.fsCloseTxt}>✕</Text>
          </TouchableOpacity>
          <View style={[s.speedBadge, { borderColor: speedColor }]}>
            <Text style={[s.speedBadgeTxt, { color: speedColor }]}>⚡ {speed} km/h</Text>
          </View>
        </View>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* HEADER */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Good Morning 👋</Text>
            <Text style={s.driverName}>{user?.name || 'Driver'}</Text>
            {hasBus && (
              <Text style={s.headerBusLine}>🚌 {busNo || 'Bus Assigned'}</Text>
            )}
            {!hasBus && (
              <Text style={[s.headerBusLine, { color: '#F59E0B' }]}>⚠ No Bus Assigned</Text>
            )}
          </View>
          <View style={[s.connBadge, {
            backgroundColor: connected ? '#00D4AA15' : '#EF444415',
            borderColor     : connected ? '#00D4AA'   : '#EF4444',
          }]}>
            <View style={[s.connDot, { backgroundColor: connected ? '#00D4AA' : '#EF4444' }]} />
            <Text style={[s.connTxt, { color: connected ? '#00D4AA' : '#EF4444' }]}>
              {connected ? 'LIVE' : 'OFFLINE'}
            </Text>
          </View>
        </View>

        {/* GPS STATUS BANNER */}
        {tripStarted && (
          <View style={[s.gpsBanner, {
            backgroundColor: bgActive ? '#00D4AA18' : '#1A73E818',
            borderColor    : bgActive ? '#00D4AA50' : '#1A73E850',
          }]}>
            <Text style={{ fontSize: 18 }}>{bgActive ? '📡' : '🟢'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.gpsBannerTitle, { color: bgActive ? '#00D4AA' : '#1A73E8' }]}>
                {bgActive ? 'Background GPS Active' : 'GPS Active'}
              </Text>
              <Text style={s.gpsBannerSub}>
                {bgActive
                  ? 'App band hone pe bhi location ja rahi hai ✓'
                  : `Parents ko location mil rahi hai • ${updateCount} updates`}
              </Text>
            </View>
            <View style={[s.pingBadge, { backgroundColor: bgActive ? '#00D4AA' : '#1A73E8' }]}>
              <Text style={s.pingTxt}>{updateCount}</Text>
            </View>
          </View>
        )}

        {/* MAP */}
        <View style={s.mapBox}>
          <DriverMapView wvRef={webViewRef} onLoad={onMapLoad} />

          <View style={[s.speedBadge, { borderColor: speedColor }]}>
            <Text style={[s.speedBadgeTxt, { color: speedColor }]}>⚡ {speed} km/h</Text>
          </View>

          {tripStarted && accuracy != null && (
            <View style={s.accBadge}>
              <Text style={s.accTxt}>📡 ±{accuracy}m</Text>
            </View>
          )}

          {tripStarted && (
            <View style={[s.tripBadge, {
              backgroundColor: bgActive ? 'rgba(0,212,170,0.15)' : 'rgba(26,115,232,0.15)',
              borderColor    : bgActive ? '#00D4AA' : '#1A73E8'
            }]}>
              <View style={[s.tripDot, { backgroundColor: bgActive ? '#00D4AA' : '#1A73E8' }]} />
              <Text style={[s.tripBadgeTxt, { color: bgActive ? '#00D4AA' : '#1A73E8' }]}>
                {bgActive ? 'BG ACTIVE' : 'TRIP ACTIVE'}
              </Text>
            </View>
          )}

          <TouchableOpacity style={s.fsBtn} onPress={() => setIsFullscreen(true)} activeOpacity={0.85}>
            <Text style={s.fsBtnTxt}>⛶</Text>
          </TouchableOpacity>
        </View>

        {/* BUS INFO */}
        <View style={s.infoCard}>
          <Text style={s.infoLbl}>ASSIGNED BUS</Text>
          {hasBus ? (
            <>
              <Text style={s.busNo}>{busNo || 'Bus Assigned'}{route?.name ? ` • ${route.name}` : ''}</Text>
              <Text style={s.busSub}>
                {hasRoute
                  ? `${stops.length} Stops`
                  : routeFetchFailed
                    ? 'Route load nahi ho payi — dobara try karo'
                    : 'Admin ne abhi route/stops assign nahi kiye'}
              </Text>
            </>
          ) : (
            <>
              <Text style={[s.busNo, { color: '#F59E0B' }]}>⚠ No Bus Assigned</Text>
              <Text style={s.busSub}>
                Admin ko batao apna account ({user?.phone || 'is number'}) se ek bus link karwane ke liye.
              </Text>
            </>
          )}
        </View>

        {/* TRIP UI */}
        {tripStarted ? (
          <View style={s.tripActive}>
            <View style={[s.speedometer, { borderColor: speedColor + '55' }]}>
              <Text style={[s.speedNum, { color: speedColor }]}>{speed}</Text>
              <Text style={s.speedUnit}>km/h</Text>
              <View style={[s.speedBar, { backgroundColor: speedColor }]} />
            </View>
            <View style={[s.speedLabel, { backgroundColor: speedColor + '22' }]}>
              <Text style={[s.speedLabelTxt, { color: speedColor }]}>
                {speed > 60 ? '🔴 OVERSPEED! Slow Down!' : speed > 40 ? '🟡 Moderate Speed' : '🟢 Safe Speed'}
              </Text>
            </View>
            <View style={s.statsRow}>
              <View style={s.statCard}>
                <Text style={s.statVal}>{formatTime(tripTime)}</Text>
                <Text style={s.statLbl}>Trip Time</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statVal}>{updateCount}</Text>
                <Text style={s.statLbl}>GPS Pings</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statVal}>{accuracy ? `±${accuracy}m` : '--'}</Text>
                <Text style={s.statLbl}>Accuracy</Text>
              </View>
            </View>
            <TouchableOpacity style={s.endBtn} onPress={stopTrip} activeOpacity={0.85}>
              <Text style={s.endBtnTxt}>⏹  End Trip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.sosBtn, sosActive && s.sosBtnActive]} onPress={triggerSOS} activeOpacity={0.85}>
              <Text style={[s.sosTxt, sosActive && { color: '#fff' }]}>
                🆘 {sosActive ? 'SOS ACTIVE — Tap to Cancel' : 'SOS Emergency'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.preTrip}>
            <Text style={s.busBig}>🚌</Text>
            <Text style={s.readyTitle}>Ready to start?</Text>
            <Text style={s.readySub}>
              Ek baar START dabao{'\n'}
              App band hone pe bhi location chalti rahegi 📡
            </Text>
            <TouchableOpacity
              style={[s.startBtn, (startingTrip || !hasBus) && { opacity: 0.6 }]}
              onPress={startTrip}
              disabled={startingTrip || !hasBus}
              activeOpacity={0.85}
            >
              <Text style={s.startBtnTxt}>
                {startingTrip ? '⏳ Starting...' : !hasBus ? '🚫 No Bus Assigned' : '▶  START TRIP'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={s.logoutBtn} onPress={async () => { await stopTrip(); await logout(); onLogout(); }}>
          <Text style={s.logoutTxt}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container    : { flex: 1, backgroundColor: '#0A0F1C' },
  header       : { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, paddingTop: 44 },
  greeting     : { fontSize: 13, color: '#8892A4' },
  driverName   : { fontSize: 22, fontWeight: 'bold', color: '#F9FAFB', marginTop: 2 },
  headerBusLine: { fontSize: 13, color: '#00D4AA', fontWeight: '600', marginTop: 4 },
  connBadge    : { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, gap: 6 },
  connDot      : { width: 8, height: 8, borderRadius: 4 },
  connTxt      : { fontSize: 10, fontWeight: 'bold' },
  gpsBanner    : { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1 },
  gpsBannerTitle: { fontSize: 13, fontWeight: 'bold' },
  gpsBannerSub : { fontSize: 11, color: '#8892A4', marginTop: 2 },
  pingBadge    : { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, minWidth: 32, alignItems: 'center' },
  pingTxt      : { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  mapBox       : { height: SCREEN_HEIGHT * 0.42, position: 'relative', backgroundColor: '#e8eaf0' },
  speedBadge   : { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(10,15,28,0.92)', borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, zIndex: 100, elevation: 5 },
  speedBadgeTxt: { fontSize: 12, fontWeight: 'bold' },
  accBadge     : { position: 'absolute', top: 46, left: 10, backgroundColor: 'rgba(10,15,28,0.8)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, zIndex: 100 },
  accTxt       : { fontSize: 10, color: '#00D4AA' },
  tripBadge    : { position: 'absolute', bottom: 14, left: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, gap: 6, zIndex: 100 },
  tripDot      : { width: 7, height: 7, borderRadius: 4 },
  tripBadgeTxt : { fontSize: 11, fontWeight: 'bold' },
  fsBtn        : { position: 'absolute', bottom: 14, right: 14, width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.92)', justifyContent: 'center', alignItems: 'center', elevation: 6, zIndex: 100 },
  fsBtnTxt     : { fontSize: 22, color: '#444' },
  fsContainer  : { flex: 1, backgroundColor: '#000' },
  fsClose      : { position: 'absolute', top: 50, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 99999 },
  fsCloseTxt   : { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  infoCard     : { margin: 16, backgroundColor: '#111827', borderRadius: 16, borderWidth: 1, borderColor: '#1E2D45', padding: 16 },
  infoLbl      : { fontSize: 10, color: '#8892A4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  busNo        : { fontSize: 20, fontWeight: 'bold', color: '#F9FAFB' },
  busSub       : { fontSize: 13, color: '#8892A4', marginTop: 4 },
  tripActive   : { alignItems: 'center', paddingHorizontal: 16 },
  speedometer  : { width: 180, height: 180, borderRadius: 90, backgroundColor: '#111827', borderWidth: 4, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  speedNum     : { fontSize: 56, fontWeight: 'bold' },
  speedUnit    : { fontSize: 14, color: '#8892A4' },
  speedBar     : { width: 54, height: 4, borderRadius: 2, marginTop: 8 },
  speedLabel   : { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, marginBottom: 14 },
  speedLabelTxt: { fontWeight: 'bold', fontSize: 14 },
  statsRow     : { flexDirection: 'row', gap: 10, marginBottom: 14, width: '100%' },
  statCard     : { flex: 1, backgroundColor: '#111827', borderRadius: 12, borderWidth: 1, borderColor: '#1E2D45', padding: 14, alignItems: 'center' },
  statVal      : { fontSize: 16, fontWeight: 'bold', color: '#F9FAFB' },
  statLbl      : { fontSize: 11, color: '#8892A4', marginTop: 4 },
  endBtn       : { backgroundColor: '#EF4444', borderRadius: 14, padding: 16, alignItems: 'center', width: '100%', marginBottom: 12 },
  endBtnTxt    : { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  sosBtn       : { backgroundColor: '#EF444418', borderRadius: 14, borderWidth: 2, borderColor: '#EF4444', padding: 16, alignItems: 'center', width: '100%' },
  sosBtnActive : { backgroundColor: '#EF4444' },
  sosTxt       : { color: '#EF4444', fontWeight: 'bold', fontSize: 15 },
  preTrip      : { alignItems: 'center', padding: 24 },
  busBig       : { fontSize: 80, marginBottom: 12 },
  readyTitle   : { fontSize: 20, fontWeight: 'bold', color: '#F9FAFB', marginBottom: 6 },
  readySub     : { fontSize: 13, color: '#8892A4', marginBottom: 28, textAlign: 'center', lineHeight: 20 },
  startBtn     : { backgroundColor: '#00D4AA', borderRadius: 16, padding: 20, alignItems: 'center', width: '100%' },
  startBtnTxt  : { color: '#000', fontWeight: 'bold', fontSize: 18 },
  logoutBtn    : { padding: 16, alignItems: 'center', marginTop: 8 },
  logoutTxt    : { color: '#8892A4', fontSize: 14 },
});

