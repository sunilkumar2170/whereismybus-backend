import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity,
  SafeAreaView, ScrollView, Dimensions, StatusBar,
  Platform, RefreshControl, Modal, Linking, Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { io } from 'socket.io-client';
import { SOCKET_URL, logout, getBusFullInfo, getToken, getUser } from '../services/api';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PRIMARY = '#1A73E8';
const ARRIVE_THRESHOLD_KM = 0.12; // ~120m — same threshold the Driver app uses for "reached"

const toRad = v => (v * Math.PI) / 180;
const getDistKm = (a, b, c, d) => {
  const R = 6371, dL = toRad(c-a), dN = toRad(d-b);
  const x = Math.sin(dL/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dN/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
};
const getETA = (km, spd) => {
  if (!spd || spd < 2) return '-- min';
  const m = Math.round((km/spd)*60);
  return m < 1 ? '< 1 min' : `${m} min`;
};
const bearingDeg = (lat1, lng1, lat2, lng2) => {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};
const turnAngle = (b1, b2) => (((b2 - b1 + 540) % 360) - 180);

// FIX (fake-location removal): bus marker/pulse is now created LAZILY —
// only the first time a real 'updateBus' postMessage arrives. Nothing
// is drawn on the map claiming to be "the bus" until real GPS shows up.
// (lat,lng) passed in here is only the map's initial CENTER (real: bus
// location if we already have it, else the route's first stop) — never
// a fake default coordinate.
const buildMapHtml = (lat, lng, stops, myStopId) => `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=10.0,minimum-scale=0.5,user-scalable=yes">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;width:100%;overflow:hidden;background:#e8eaf0;-webkit-user-select:none;user-select:none}
#map{position:absolute;top:0;left:0;right:0;bottom:0;touch-action:pan-x pan-y pinch-zoom}
.leaflet-bottom.leaflet-left{bottom:80px!important;left:12px!important}
.leaflet-control-zoom{border:none!important;box-shadow:0 3px 18px rgba(0,0,0,0.22)!important;border-radius:16px!important;margin:0!important;overflow:hidden}
.leaflet-control-zoom-in,.leaflet-control-zoom-out{
  width:56px!important;height:56px!important;line-height:56px!important;
  font-size:32px!important;color:#444!important;background:#fff!important;
  border:none!important;display:block!important;text-align:center!important;
}
.leaflet-control-zoom-in:active,.leaflet-control-zoom-out:active{background:#EEF4FF!important}
.leaflet-control-zoom-in{border-bottom:1px solid #eee!important}
.leaflet-control-attribution{font-size:8px!important;opacity:0.3}
.leaflet-popup-content-wrapper{border-radius:12px!important;border:none!important;box-shadow:0 4px 18px rgba(0,0,0,0.15)!important;padding:0!important}
.leaflet-popup-content{margin:0!important}
.leaflet-popup-tip-container{display:none!important}
.pulse-ring{position:absolute;width:60px;height:60px;border-radius:50%;background:rgba(26,115,232,0.25);margin-left:-9px;margin-top:-9px;animation:pulse 2.2s ease-out infinite;pointer-events:none}
@keyframes pulse{0%{transform:scale(0.6);opacity:1}100%{transform:scale(2.2);opacity:0}}
.my-pulse{position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(255,152,0,0.35);margin-left:-13px;margin-top:-13px;animation:mypulse 1.8s ease-out infinite;pointer-events:none}
@keyframes mypulse{0%{transform:scale(0.5);opacity:1}100%{transform:scale(2.4);opacity:0}}
.fab{position:fixed;right:14px;width:54px;height:54px;border-radius:50%;background:#fff;border:none;outline:none;box-shadow:0 3px 16px rgba(0,0,0,0.22);font-size:22px;z-index:9000;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:transform 0.1s ease,box-shadow 0.1s ease}
.fab:active{transform:scale(0.86);box-shadow:0 1px 6px rgba(0,0,0,0.14)}
#btnLocate{bottom:88px}
.dirArrow{transition:transform 0.2s linear}
</style>
</head>
<body>
<div id="map"></div>
<button class="fab" id="btnLocate" onclick="locateBus()" title="Locate Bus">&#127919;</button>
<script>
var map=L.map('map',{
  zoomControl:true,attributionControl:true,
  tap:true,tapTolerance:30,
  touchZoom:true,pinchZoom:true,
  bounceAtZoomLimits:false,
  zoomSnap:0.25,zoomDelta:1,
  wheelPxPerZoomLevel:60,wheelDebounceTime:20,
  maxZoom:21,minZoom:4,
  preferCanvas:true,
  renderer:L.canvas({padding:0.5,tolerance:10})
}).setView([${lat},${lng}],16);
map.zoomControl.setPosition('bottomleft');

L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en&scale=2',{
  subdomains:['0','1','2','3'],maxZoom:21,
  updateWhenIdle:false,updateWhenZooming:false,
  keepBuffer:8,detectRetina:true,attribution:'© Google Maps'
}).addTo(map);

var stopsData=${JSON.stringify(stops)};
var myStopId=${JSON.stringify(myStopId || null)};

function bearingDeg(lat1,lng1,lat2,lng2){
  var toRad=function(d){return d*Math.PI/180;};
  var toDeg=function(r){return r*180/Math.PI;};
  var y=Math.sin(toRad(lng2-lng1))*Math.cos(toRad(lat2));
  var x=Math.cos(toRad(lat1))*Math.sin(toRad(lat2))-Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lng2-lng1));
  return (toDeg(Math.atan2(y,x))+360)%360;
}
function turnAngle(b1,b2){ return (b2-b1+540)%360-180; }

function drawTurnMarkers(stops){
  if(!stops||stops.length<3) return;
  for(var i=1;i<stops.length-1;i++){
    var p=stops[i-1], c=stops[i], n=stops[i+1];
    var b1=bearingDeg(p.lat,p.lng,c.lat,c.lng);
    var b2=bearingDeg(c.lat,c.lng,n.lat,n.lng);
    var diff=turnAngle(b1,b2);
    if(Math.abs(diff)<20) continue;
    var dir=diff>0?'right':'left';
    var label=dir==='right'?'RIGHT \u27A1':'\u2B05 LEFT';
    var col=dir==='right'?'#FF9800':'#8B5CF6';
    var icon=L.divIcon({
      html:'<div style="background:'+col+';color:#fff;font-size:11px;font-weight:800;padding:5px 10px;border-radius:10px;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.4);border:2px solid #fff">'+label+'<\/div>',
      className:'',iconSize:[80,28],iconAnchor:[40,48]
    });
    L.marker([c.lat,c.lng],{icon:icon,interactive:false,zIndexOffset:600}).addTo(map);
  }
}

function drawRouteArrows(coords){
  if(!coords||coords.length<2) return;
  for(var i=0;i<coords.length-1;i++){
    var a=coords[i], b=coords[i+1];
    var brng=bearingDeg(a[0],a[1],b[0],b[1]);
    var segDist=map.distance(a,b);
    var arrowCount=Math.max(1,Math.min(5,Math.floor(segDist/110)));
    for(var k=1;k<=arrowCount;k++){
      var f=k/(arrowCount+1);
      var lat=a[0]+(b[0]-a[0])*f;
      var lng=a[1]+(b[1]-a[1])*f;
      var icon=L.divIcon({
        html:'<div class="dirArrow" style="width:22px;height:22px;transform:rotate('+brng+'deg)">'
          +'<svg width="22" height="22" viewBox="0 0 24 24">'
          +'<path d="M12 3 L19 19 L12 15 L5 19 Z" fill="#1A73E8" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>'
          +'<\/svg><\/div>',
        className:'',iconSize:[22,22],iconAnchor:[11,11]
      });
      L.marker([lat,lng],{icon:icon,interactive:false,zIndexOffset:250}).addTo(map);
    }
  }
}

if(stopsData.length>0){
  var c=stopsData.map(function(s){ return [parseFloat(s.lat), parseFloat(s.lng)]; });
  if(c.length>1){
    L.polyline(c,{color:'#BDD5FA',weight:14,opacity:0.45,lineJoin:'round',lineCap:'round'}).addTo(map);
    L.polyline(c,{color:'#1A73E8',weight:7,opacity:0.95,lineJoin:'round',lineCap:'round',smoothFactor:1.5}).addTo(map);
    drawRouteArrows(c);
    drawTurnMarkers(stopsData);

    try {
      var bounds = L.latLngBounds(c);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } catch(err){}
  }
}

stopsData.forEach(function(s,i){
  var lat = parseFloat(s.lat), lng = parseFloat(s.lng);
  var isFirst=i===0,isLast=i===stopsData.length-1;
  var isMine = myStopId && (s.id===myStopId);
  var col=isFirst?'#34A853':isLast?'#EA4335':'#1A73E8';
  var r=isFirst?12:isLast?14:9;

  if(isMine){
    L.marker([lat,lng],{
      icon:L.divIcon({
        html:'<div style="position:relative;width:26px;height:26px">'+
          '<div class="my-pulse"><\/div>'+
          '<div style="width:26px;height:26px;border-radius:50%;background:'+col+';border:4px solid #FF9800;box-shadow:0 3px 10px rgba(255,152,0,0.6);position:relative;z-index:2"><\/div>'+
        '<\/div>',
        className:'',iconSize:[26,26],iconAnchor:[13,13]
      }),
      zIndexOffset:1500
    }).addTo(map).bindPopup('<div style="padding:9px 13px;font-size:14px;font-weight:bold;color:#FF9800">📍 '+s.name+'<br><span style="font-size:11px;color:#777;font-weight:normal">Your Stop<\/span><\/div>',{closeButton:false,offset:[0,-10]});
  } else {
    L.circleMarker([s.lat,s.lng],{radius:r,fillColor:col,color:'#fff',weight:3,fillOpacity:1,pane:'markerPane'})
     .addTo(map).bindPopup('<div style="padding:9px 13px;font-size:14px;font-weight:bold;color:'+col+'">'+(isFirst?'🟢 ':isLast?'🏫 ':'📍 ')+s.name+'<\/div>',{closeButton:false,offset:[0,-6]});
  }

  if(isFirst){
    L.marker([s.lat,s.lng],{icon:L.divIcon({
      html:'<div style="background:#34A853;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 8px rgba(52,168,83,0.5);margin-top:18px">START<\/div>',
      className:'',iconSize:[52,22],iconAnchor:[26,-5]
    }),interactive:false,zIndexOffset:400}).addTo(map);
  }
});

// ── FIX: bus icon is DEFINED but NOT placed on the map yet. busMarker
// stays null until a real GPS fix arrives via postMessage — see onMsg
// below. This is what removes the "fake default location" bug: no bus
// icon appears anywhere until real coordinates exist. ──
var busIcon=L.divIcon({
  html:'<div style="position:relative;width:42px;height:42px">'+
    '<div class="pulse-ring"><\/div>'+
    '<div style="background:#fff;border:3px solid #1A73E8;border-radius:50%;width:42px;height:42px;'+
    'display:flex;align-items:center;justify-content:center;'+
    'box-shadow:0 4px 16px rgba(26,115,232,0.45);position:relative;z-index:2">'+
    '<span style="font-size:20px">&#x1F68C;<\/span><\/div>'+
    '<div id="spd" style="position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);'+
    'background:#1A73E8;color:#fff;font-size:10px;font-weight:700;'+
    'border-radius:7px;padding:2px 7px;white-space:nowrap;'+
    'box-shadow:0 2px 6px rgba(26,115,232,0.4);transition:background 0.3s">0 km\/h<\/div>'+
  '<\/div>',
  className:'',iconSize:[42,62],iconAnchor:[21,21]
});
var busMarker=null;
var animId=null,curLat=null,curLng=null,tgtLat=null,tgtLng=null,following=true;

function ensureBusMarker(lat,lng){
  if(busMarker) return;
  curLat=lat;curLng=lng;tgtLat=lat;tgtLng=lng;
  busMarker=L.marker([lat,lng],{icon:busIcon,zIndexOffset:3000,keyboard:false}).addTo(map)
    .bindPopup('<div style="padding:9px 13px"><div style="font-size:14px;font-weight:bold;color:#1A73E8">&#x1F68C; Live Bus<\/div><div style="font-size:12px;color:#777;margin-top:3px">Live GPS Tracking<\/div><\/div>',{closeButton:false,offset:[0,-44]});
  map.setView([lat,lng], Math.max(map.getZoom(),16), { animate:true });
}

function easeLinear(t){return t}
function animBus(){
  if(!busMarker) return; // FIX: nothing to animate until real GPS created it
  if(animId){cancelAnimationFrame(animId);animId=null}
  var sLat=curLat,sLng=curLng,eLat=tgtLat,eLng=tgtLng;
  var d=Math.sqrt(Math.pow(eLat-sLat,2)+Math.pow(eLng-sLng,2));
  if(d>0.015){curLat=eLat;curLng=eLng;busMarker.setLatLng([curLat,curLng]);if(following)map.panTo([curLat,curLng],{animate:false});return}
  var t0=null,dur=950;
  function step(ts){
    if(!t0)t0=ts;
    var p=Math.min((ts-t0)/dur,1),e=easeLinear(p);
    curLat=sLat+(eLat-sLat)*e;curLng=sLng+(eLng-sLng)*e;
    busMarker.setLatLng([curLat,curLng]);
    if(p<1){animId=requestAnimationFrame(step)}else{curLat=eLat;curLng=eLng;animId=null}
  }
  animId=requestAnimationFrame(step);
  if(following)map.panTo([eLat,eLng],{animate:true,duration:0.95,easeLinearity:0.1,noMoveStart:true});
}
map.on('dragstart',function(){following=false});

function locateBus(){
  if(curLat==null) return; // FIX: nothing real to fly to yet
  following=true;
  map.flyTo([curLat,curLng],17,{animate:true,duration:1.0,easeLinearity:0.25});
}
function onMsg(e){
  try{
    var d=JSON.parse(typeof e.data==='string'?e.data:JSON.stringify(e.data));
    if(d.type==='updateBus'){
      var lat=parseFloat(d.lat),lng=parseFloat(d.lng);
      if(Number.isNaN(lat)||Number.isNaN(lng)) return;
      if(!busMarker){ ensureBusMarker(lat,lng); }
      tgtLat=lat;tgtLng=lng;
      var spd=Math.round(parseFloat(d.speed)||0);
      var el=document.getElementById('spd');
      if(el){el.textContent=spd+' km/h';el.style.background=spd>60?'#F44336':spd>40?'#FF9800':'#1A73E8'}
      animBus();
    }
  }catch(err){}
}
document.addEventListener('message',onMsg);
window.addEventListener('message',onMsg);
map.whenReady(function(){setTimeout(function(){map.invalidateSize({animate:false})},300)});

window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
<\/script>
</body>
</html>`;

const StopRow = ({ stop, index, currentIndex, isLast, myStopId }) => {
  const isDone   = index < currentIndex;
  const isActive = index === currentIndex;
  const isFirst  = index === 0;
  const isMine   = myStopId && stop.id === myStopId;
  const statusIcon = isDone ? '✓' : isActive ? '●' : '○';
  const dotColor = isMine ? '#FF9800' : isFirst ? '#34A853' : isLast ? '#EA4335' : isDone || isActive ? PRIMARY : '#DDD';
  return (
    <View style={styles.stopItem}>
      <View style={styles.timeline}>
        <View style={[styles.dot,{
          backgroundColor: dotColor,
          width:  isActive || isMine ? 16 : 12,
          height: isActive || isMine ? 16 : 12,
          borderRadius: 8,
          borderWidth: isActive || isMine ? 3 : 0,
          borderColor: isMine ? '#FFE0B2' : '#D2E3FC',
        }]}/>
        {!isLast && <View style={[styles.line,{ backgroundColor: isDone ? PRIMARY : '#DDD' }]}/>}
      </View>
      <View style={styles.stopTextContent}>
        <Text style={[
          styles.stopName,
          isDone && styles.textDone,
          isActive && styles.textActive,
          isMine && { color:'#FF9800', fontWeight:'bold' },
        ]}>
          {statusIcon} {isFirst ? '🟢 ' : isLast ? '🏫 ' : ''}
          {stop.name}
          {isActive ? ' 🚌' : ''}
          {isMine ? ' 📍 (Your Stop)' : ''}
        </Text>
      </View>
      {isActive && (
        <View style={styles.hereTag}>
          <Text style={styles.hereText}>BUS HERE</Text>
        </View>
      )}
      {!isActive && isMine && (
        <View style={[styles.hereTag,{ backgroundColor:'#FFF3E0' }]}>
          <Text style={[styles.hereText,{ color:'#FF9800' }]}>YOUR STOP</Text>
        </View>
      )}
    </View>
  );
};

const NavBtn = ({ icon, label, active, onPress }) => (
  <TouchableOpacity style={styles.navItem} onPress={onPress}>
    <Text style={[styles.navIcon, active && { color: PRIMARY }]}>{icon}</Text>
    <Text style={[styles.navText, active && { color: PRIMARY, fontWeight:'bold' }]}>{label}</Text>
  </TouchableOpacity>
);

const MapWebView = React.memo(function MapWebView({ wvRef, mapHtml, onReady }) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      onStartShouldSetResponder={() => false}
      onMoveShouldSetResponder={() => false}
    >
      <WebView
        ref={wvRef}
        source={{ html: mapHtml }}
        style={{ flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        nestedScrollEnabled={false}
        originWhitelist={['*']}
        mixedContentMode="always"
        allowsInlineMediaPlayback
        androidLayerType="software"
        startInLoadingState={false}
        bounces={false}
        overScrollMode="never"
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (d.type === 'ready') onReady?.();
          } catch {}
        }}
        onError={e => console.log('MapErr:', e.nativeEvent)}
      />
    </View>
  );
});

export default function HomeScreen({ user, onLogout }) {
  const hasBus = !!user?.busId;

  // FIX (fake-location removal): lat/lng start as null — NOT a hardcoded
  // Jaipur/anywhere coordinate. Nothing on screen may claim this is the
  // bus's position until hasLiveGPS is true.
  const [busData,          setBusData]          = useState({ lat: null, lng: null, speed: 0, busId: user?.busId || null });
  const [busInfo,          setBusInfo]          = useState(null);
  const [connected,        setConnected]        = useState(false);
  const [hasLiveGPS,        setHasLiveGPS]        = useState(false);
  const [busAddress,       setBusAddress]       = useState('Locating...');
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [refreshing,       setRefreshing]       = useState(false);
  const [isFullscreen,     setIsFullscreen]     = useState(false);
  const [myStopId,         setMyStopId]         = useState(user?.stopId || user?.studentStopId || null);
  const [roadTurn,         setRoadTurn]         = useState(null);

  const socketRef      = useRef(null);
  const webViewRef      = useRef(null);
  const fsWebViewRef    = useRef(null);
  const stopsRef        = useRef([]);
  const lastGeocodeRef  = useRef(0);
  const busIdRef        = useRef(user?.busId || null);
  const currentStopIdxRef = useRef(0);
  const lastTurnFetchRef  = useRef(0);
  const lastTurnStopIdRef = useRef(null);

  const busDataRef = useRef(busData);
  useEffect(() => { busDataRef.current = busData; }, [busData]);

  const busNo = busInfo?.busNo || user?.busNo || null;

  // FIX: polished with the actual road/street name from OSRM (when it
  // returns one), so it reads like "TURN LEFT onto Utai Road" instead of
  // just "TURN LEFT" — closer to a Google-Maps-style instruction. Turn
  // logic itself already came from real road-network data (OSRM), not
  // a naive lat/lng bearing — that part just needed this polish.
  const fetchRoadTurn = useCallback(async (lat, lng, stop) => {
    if (!stop) return null;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${stop.lng},${stop.lat}?steps=true&overview=false`;
      const res = await fetch(url);
      const data = await res.json();
      const steps = data?.routes?.[0]?.legs?.[0]?.steps;
      if (!steps || steps.length < 2) return null;

      const distToTurnM = Math.round(steps[0].distance);
      const modifier = steps[1]?.maneuver?.modifier || '';
      const roadName  = steps[1]?.name || null;
      if (!modifier || modifier.includes('straight') || modifier === 'uturn') return null;

      const dir = modifier.includes('left') ? 'LEFT' : modifier.includes('right') ? 'RIGHT' : null;
      if (!dir) return null;

      return { dir, arrow: dir === 'LEFT' ? '←' : '→', meters: distToTurnM, modifier, road: roadName };
    } catch (e) {
      console.log('[PARENT] road turn fetch error:', e.message);
      return null;
    }
  }, []);

  const fetchRoute = useCallback(async () => {
    if (!hasBus) return;
    try {
      const token = await getToken();
      const myBusId = user?.busId || busIdRef.current;
      const info = await getBusFullInfo(myBusId, token);
      setBusInfo(info);
      const stopsArr = info?.stops || [];
      stopsRef.current = stopsArr;

      console.log('[PARENT] assigned busId:', myBusId);
      console.log('[PARENT] busInfo:', info);
      console.log('[PARENT] ADMIN STOPS:', stopsArr.map(s => s.name));
      console.log('[PARENT] Driver:', info?.driver);

      // FIX: this is the ONLY place initial coordinates are ever set —
      // and only from a real DB row (info.liveLocation). If there is no
      // liveLocation yet, busData.lat/lng correctly stay null and
      // hasLiveGPS stays false — no fallback coordinate is invented.
      if (info?.liveLocation) {
        setHasLiveGPS(true);
        setBusData(prev => ({
          ...prev,
          lat: info.liveLocation.lat,
          lng: info.liveLocation.lng,
          speed: Math.round(info.liveLocation.speed || 0),
          busId: myBusId,
        }));
      }

      if (!myStopId && user?.studentStopName) {
        const match = stopsArr.find(s => s.name === user.studentStopName);
        if (match) setMyStopId(match.id);
      }
    } catch (e) { console.log('[PARENT] route fetch error:', e.message); }
  }, [user, myStopId, hasBus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRoute();
    setRefreshing(false);
  }, [fetchRoute]);

  useEffect(() => { fetchRoute(); }, [fetchRoute]);

  useEffect(() => {
    if (!hasBus) return;
    socketRef.current = io(SOCKET_URL, { transports:['websocket'], reconnection:true, reconnectionDelay:1000 });

    socketRef.current.on('connect', () => {
      setConnected(true);
      const myBusId = user?.busId || busIdRef.current;
      if (myBusId) {
        socketRef.current.emit('joinBus', { busId: myBusId });
        console.log('Joined room for bus:', myBusId);
      }
    });

    socketRef.current.on('disconnect', () => setConnected(false));
    socketRef.current.on('connect_error', (err) => console.log('⚠️ socket:', err.message));

    socketRef.current.on('locationUpdate', (data) => {
      const lat   = parseFloat(data.lat);
      const lng   = parseFloat(data.lng);
      const speed = Math.round(parseFloat(data.speed) || 0);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;
      const now = Date.now();

      if (data.busId && busIdRef.current && data.busId !== busIdRef.current) return;

      setHasLiveGPS(true);
      setBusData({ lat, lng, speed, busId: data.busId || busIdRef.current });

      // FIX (map freeze): live position updates go ONLY through
      // postMessage — the marker glides via the WebView's own onMsg/
      // animBus JS, and the map's HTML is never regenerated here. See
      // the mapHtml/mapCenter useMemo below for the other half of the fix.
      const msg = JSON.stringify({ type:'updateBus', lat, lng, speed });
      webViewRef.current?.postMessage(msg);
      fsWebViewRef.current?.postMessage(msg);

      const currentStops = stopsRef.current;
      if (currentStops.length) {
        let idx = currentStopIdxRef.current;
        while (idx < currentStops.length - 1) {
          const d = getDistKm(lat, lng, currentStops[idx].lat, currentStops[idx].lng);
          if (d <= ARRIVE_THRESHOLD_KM) idx += 1;
          else break;
        }
        currentStopIdxRef.current = idx;
        setCurrentStopIndex(idx);

        const targetStop = currentStops[idx] || currentStops[currentStops.length - 1];
        const stopChanged = targetStop?.id !== lastTurnStopIdRef.current;
        if (targetStop && (stopChanged || now - lastTurnFetchRef.current > 10000)) {
          lastTurnFetchRef.current = now;
          lastTurnStopIdRef.current = targetStop.id;
          fetchRoadTurn(lat, lng, targetStop).then(t => setRoadTurn(t));
        }
      }

      if (now - lastGeocodeRef.current > 25000) {
        lastGeocodeRef.current = now;
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
          .then(res => res.json())
          .then(addr => setBusAddress(addr.address?.road || addr.address?.suburb || addr.address?.city || 'Locating...'))
          .catch(() => setBusAddress('Location updating...'));
      }
    });

    // 🚨 Real-time SOS Alert Listener for Parent
    socketRef.current.on('sosAlert', (data) => {
      Alert.alert(
        '🚨 EMERGENCY SOS ALERT!',
        `Aapki bus mein emergency alert trigger hua hai!\n\nDriver: ${data.driverName || 'Driver'}\nTime: ${new Date(data.timestamp || Date.now()).toLocaleTimeString()}`,
        [{ text: 'OK / ACKNOWLEDGE', style: 'destructive' }]
      );
    });

    // 🚌 Trip Started Alert Listener
    socketRef.current.on('tripStarted', () => {
      Alert.alert('🚌 Bus Trip Started', 'Aapki school bus ne apna safar shuru kar diya hai.');
    });

    // ✅ Trip Ended Alert Listener
    socketRef.current.on('tripEnded', () => {
      Alert.alert('✅ Trip Completed', 'Aapki school bus ka safar samapt ho gaya hai.');
    });

    return () => socketRef.current?.disconnect();
  }, [hasBus]);

  const stops = busInfo?.stops || [];
  const nextStop = stops[currentStopIndex] || stops[stops.length - 1];
  const distToNextStop = useMemo(() => {
    if (!nextStop || !hasLiveGPS) return null;
    return getDistKm(busData.lat, busData.lng, nextStop.lat, nextStop.lng);
  }, [busData.lat, busData.lng, nextStop, hasLiveGPS]);

  const eta        = distToNextStop != null ? getETA(distToNextStop, busData.speed) : '-- min';
  const speedColor = busData.speed>60?'#F44336':busData.speed>40?'#FF9800':'#1E8E3E';

  const bearingFallbackTurn = useMemo(() => {
    if (!hasLiveGPS || !nextStop || currentStopIndex < 1 || !stops[currentStopIndex - 1]) return null;
    const prev = stops[currentStopIndex - 1];
    const b1 = bearingDeg(prev.lat, prev.lng, busData.lat, busData.lng);
    const b2 = bearingDeg(busData.lat, busData.lng, nextStop.lat, nextStop.lng);
    const diff = turnAngle(b1, b2);
    if (Math.abs(diff) < 20) return null;
    return {
      dir: diff > 0 ? 'RIGHT' : 'LEFT',
      arrow: diff > 0 ? '→' : '←',
      meters: distToNextStop != null ? Math.round(distToNextStop * 1000) : null,
    };
  }, [nextStop, currentStopIndex, stops, busData.lat, busData.lng, distToNextStop, hasLiveGPS]);

  const displayTurn = roadTurn || bearingFallbackTurn;

  const hasDriver   = !!busInfo?.driver;
  const driverName  = busInfo?.driver?.name  || null;
  const driverPhone = busInfo?.driver?.phone || null;

  const tripStatusText = busInfo?.tripActive
    ? '🟢 Trip Active'
    : "Trip hasn't started yet";

  const callDriver = useCallback(() => {
    if (!driverPhone) {
      Alert.alert('Number not available', 'Driver ka contact number abhi backend me save nahi hai.');
      return;
    }
    const cleanPhone = String(driverPhone).replace(/[^\d+]/g, '');
    const url = `tel:${cleanPhone}`;
    Linking.openURL(url).catch((err) => {
      console.log('Call error:', err.message);
      Alert.alert('Cannot place call', `Driver number: ${cleanPhone}`);
    });
  }, [driverPhone]);

  // ══════════════════════════════════════════════════════════════════
  // FIX (THE MAP-FREEZE BUG): mapCenter used to be a useMemo that
  // depended on [hasLiveGPS, busData.lat, busData.lng, stops] — i.e. it
  // recalculated on EVERY single GPS ping from the socket (every 1-3
  // seconds). Each recalculation produced a brand-new mapHtml string,
  // and since MapWebView's source is {html: mapHtml}, react-native-webview
  // treated every GPS update as "load a whole new page" — reloading the
  // ENTIRE map from scratch, repeatedly, forever. That's exactly what
  // was hanging/freezing the screen right when live location started
  // coming in (i.e. right after the driver presses START).
  //
  // The fix: capture the initial center EXACTLY ONCE (in a ref, so
  // setting it doesn't even trigger a re-render) the first moment we
  // have a real coordinate — either the first live GPS fix, or the
  // route's first stop as a fallback if GPS hasn't arrived yet. After
  // that, mapCenter never changes again for the lifetime of this screen.
  // All subsequent position updates flow ONLY through the postMessage
  // calls above, which just glide the existing marker — no reload.
  // ══════════════════════════════════════════════════════════════════
  const initialCenterRef = useRef(null);
  const [mapCenterReady, setMapCenterReady] = useState(false);

  useEffect(() => {
    if (initialCenterRef.current) return; // set exactly once, ever
    if (hasLiveGPS && busData.lat != null && busData.lng != null) {
      initialCenterRef.current = { lat: busData.lat, lng: busData.lng };
      setMapCenterReady(true);
    } else if (stops[0]) {
      initialCenterRef.current = { lat: stops[0].lat, lng: stops[0].lng };
      setMapCenterReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveGPS, busData.lat, busData.lng, stops.length]);

  const mapCenter = initialCenterRef.current;

  const mapHtml = useMemo(() => {
    if (!mapCenter) return null;
    return buildMapHtml(mapCenter.lat, mapCenter.lng, stops, myStopId);
    // Deliberately NOT depending on busData/hasLiveGPS — see fix note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCenterReady, stops, myStopId]);

  const syncWebView = useCallback((ref) => {
    const { lat, lng, speed } = busDataRef.current;
    if (lat == null || lng == null) return; // FIX: never push a fake/null coord into the map
    const msg = JSON.stringify({ type: 'updateBus', lat, lng, speed });
    ref.current?.postMessage(msg);
  }, []);

  if (!hasBus) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content"/>
        <View style={styles.emptyStateWrap}>
          <Text style={{ fontSize: 56, marginBottom: 12 }}>🚌</Text>
          <Text style={styles.emptyStateTitle}>No Bus Assigned</Text>
          <Text style={styles.emptyStateSub}>
            Aapke bachche ka pickup abhi kisi bus se link nahi hua hai. School/Admin se sampark karein.
          </Text>
        </View>
        <View style={styles.bottomNav}>
          <NavBtn icon="🏠" label="Home" active/>
          <NavBtn icon="👤" label="Profile" onPress={() => { logout(); onLogout(); }}/>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content"/>

      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsFullscreen(false)}
      >
        <View style={styles.fsContainer}>
          {mapHtml ? (
            <MapWebView
              wvRef={fsWebViewRef}
              mapHtml={mapHtml}
              onReady={() => syncWebView(fsWebViewRef)}
            />
          ) : (
            <View style={styles.mapLoadingWrap}><Text style={styles.mapLoadingTxt}>Loading map...</Text></View>
          )}
          <TouchableOpacity
            style={styles.fsCloseBtn}
            onPress={() => setIsFullscreen(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.fsCloseTxt}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Where Is My Bus</Text>
        <View style={[styles.liveBadge,{ backgroundColor:connected?'#E6F4EA':'#FEE8E6' }]}>
          <View style={[styles.pulseDot,{ backgroundColor:connected?'#34A853':'#EA4335' }]}/>
          <Text style={[styles.liveBadgeText,{ color:connected?'#1E8E3E':'#C5221F' }]}>
            {connected?'LIVE':'OFFLINE'}
          </Text>
        </View>
      </View>

      <View style={styles.driverCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.busCardBusNo}>🚌 {busNo || 'Bus'}</Text>
          <Text style={styles.driverCardLbl}>Driver</Text>
          <Text style={styles.driverName}>
            {hasDriver ? driverName : 'Driver not assigned'}
          </Text>
          <Text style={[styles.tripStatusTxt, busInfo?.tripActive && { color: '#1E8E3E' }]}>
            {tripStatusText}
          </Text>
        </View>
        {driverPhone ? (
          <TouchableOpacity style={styles.callBtn} onPress={callDriver} activeOpacity={0.85}>
            <Text style={styles.callBtnText}>📞 Call</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.callBtn, styles.callBtnDisabled]}>
            <Text style={styles.callBtnDisabledText}>{hasDriver ? 'Phone unavailable' : '—'}</Text>
          </View>
        )}
      </View>

      <View style={styles.mapContainer}>
        {!hasLiveGPS && (
          <View style={styles.noGpsOverlay} pointerEvents="none">
            <Text style={styles.noGpsText}>📡 Location unavailable</Text>
          </View>
        )}
        {!mapCenter ? (
          <View style={styles.mapLoadingWrap}>
            <Text style={styles.mapLoadingTxt}>Loading map...</Text>
          </View>
        ) : Platform.OS === 'web' ? (
          (() => {
            const L = require('leaflet');
            const { MapContainer, TileLayer, Marker:LM, Popup, Polyline:LP, useMap } = require('react-leaflet');
            require('leaflet/dist/leaflet.css');
            function AutoCenter({ lat, lng }){
              const m=useMap();
              useEffect(()=>{ m.setView([lat,lng],m.getZoom(),{animate:true,duration:1}); },[lat,lng]);
              return null;
            }
            const bi=L.divIcon({ html:`<div style="background:#fff;border:3px solid ${PRIMARY};border-radius:50%;width:42px;height:42px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(26,115,232,0.4);font-size:20px">🚌</div>`, className:'', iconSize:[42,42], iconAnchor:[21,21] });
            const si=(mine)=>L.divIcon({ html:mine
              ? `<div style="width:20px;height:20px;background:#1A73E8;border-radius:50%;border:4px solid #FF9800;box-shadow:0 2px 8px rgba(255,152,0,0.6)"></div>`
              : `<div style="width:12px;height:12px;background:${PRIMARY};border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.22)"></div>`,
              className:'', iconSize:mine?[20,20]:[12,12], iconAnchor:mine?[10,10]:[6,6] });
            const sci=L.divIcon({ html:`<div style="width:18px;height:18px;background:#EA4335;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28)"></div>`, className:'', iconSize:[18,18], iconAnchor:[9,9] });
            // NOTE: unlike the mobile WebView path, react-leaflet's <Marker>
            // and this AutoCenter component are lightweight DOM/state
            // updates, not a full page reload — so it's safe (and desired)
            // for this web-only branch to keep following live busData
            // directly, instead of the frozen mapCenter used for mobile.
            const followLat = hasLiveGPS ? busData.lat : mapCenter.lat;
            const followLng = hasLiveGPS ? busData.lng : mapCenter.lng;
            return (
              <div style={{ height:'100%', width:'100%' }}>
                <MapContainer center={[mapCenter.lat,mapCenter.lng]} zoom={16} style={{ height:'100%',width:'100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
                  <AutoCenter lat={followLat} lng={followLng}/>
                  {stops.length>1 && <LP positions={stops.map(s=>[s.lat,s.lng])} color={PRIMARY} weight={5} opacity={0.92}/>}
                  {stops.map((s,i)=>(
                    <LM key={s.id||i} position={[s.lat,s.lng]} icon={i===stops.length-1?sci:si(myStopId && s.id===myStopId)}>
                      <Popup><b>{i===stops.length-1?'🏫 ':myStopId===s.id?'📍 Your Stop — ':'📍 '}{s.name}</b></Popup>
                    </LM>
                  ))}
                  {hasLiveGPS && (
                    <LM position={[busData.lat,busData.lng]} icon={bi}>
                      <Popup>🚌 Bus {busNo || '—'} | {busData.speed} km/h</Popup>
                    </LM>
                  )}
                </MapContainer>
              </div>
            );
          })()
        ) : (
          <MapWebView
            wvRef={webViewRef}
            mapHtml={mapHtml}
            onReady={() => syncWebView(webViewRef)}
          />
        )}

        {hasLiveGPS && (
          <View style={[styles.speedBadge,{ borderColor:speedColor }]}>
            <Text style={[styles.speedBadgeText,{ color:speedColor }]}>⚡ {busData.speed} km/h</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.fsBtn}
          onPress={() => setIsFullscreen(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.fsBtnTxt}>⛶</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.detailsContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom:100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={[PRIMARY]} tintColor={PRIMARY}/>
        }
      >
        <View style={styles.dragHandle}/>

        <View style={styles.statsCard}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>📍 Near</Text>
            <Text style={styles.statValue} numberOfLines={1}>{hasLiveGPS ? busAddress : '—'}</Text>
          </View>
          <View style={styles.statDivider}/>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>🚩 Next Stop</Text>
            <Text style={styles.statValue}>{stops.length ? (nextStop?.name || 'School') : '—'}</Text>
          </View>
          <View style={styles.statDivider}/>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>🕐 ETA</Text>
            <Text style={[styles.statValue,{ color:PRIMARY }]}>{eta}</Text>
          </View>
        </View>

        {displayTurn && (
          <View style={styles.turnCard}>
            <Text style={styles.turnText}>
              {displayTurn.arrow} TURN {displayTurn.dir}{displayTurn.road ? ` onto ${displayTurn.road}` : ''} {displayTurn.meters != null ? `IN ${displayTurn.meters} m` : ''}
            </Text>
          </View>
        )}

        <View style={styles.statusRow}>
          <View style={[styles.statusPill,{ borderColor:speedColor }]}>
            <Text style={[styles.statusPillText,{ color:speedColor }]}>⚡ {hasLiveGPS ? `${busData.speed} km/h` : '--'}</Text>
          </View>
          <View style={[styles.statusPill,{ borderColor:'#666' }]}>
            <Text style={[styles.statusPillText,{ color:'#666' }]}>
              📏 {distToNextStop!=null?`${distToNextStop.toFixed(1)} km`:'--'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Route Progress</Text>
          {stops.map((stop, i) => (
            <StopRow key={stop.id||i} stop={stop} index={i}
              currentIndex={currentStopIndex} isLast={i===stops.length-1}
              myStopId={myStopId}/>
          ))}
          {!stops.length && (
            <Text style={{ color:'#aaa', textAlign:'center', padding:16 }}>Admin ne abhi is bus ke stops set nahi kiye</Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.bottomNav}>
        <NavBtn icon="🏠" label="Home" active/>
        <NavBtn icon="📍" label="Map"/>
        <NavBtn icon="🔔" label="Alerts"/>
        <NavBtn icon="👤" label="Profile" onPress={() => { logout(); onLogout(); }}/>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container       : { flex:1, backgroundColor:'#FFF' },
  header          : { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                      paddingHorizontal:16, paddingVertical:12,
                      backgroundColor:'#FFF', borderBottomWidth:1, borderBottomColor:'#EEE' },
  headerTitle     : { fontSize:18, fontWeight:'bold', color:'#111' },
  liveBadge       : { flexDirection:'row', alignItems:'center',
                      paddingHorizontal:10, paddingVertical:5, borderRadius:12 },
  liveBadgeText   : { fontSize:10, fontWeight:'bold' },
  pulseDot        : { width:7, height:7, borderRadius:4, marginRight:5 },

  emptyStateWrap  : { flex:1, justifyContent:'center', alignItems:'center', padding:32 },
  emptyStateTitle : { fontSize:18, fontWeight:'bold', color:'#111', marginBottom:8 },
  emptyStateSub   : { fontSize:13, color:'#888', textAlign:'center', lineHeight:20 },

  mapContainer    : { height:SCREEN_HEIGHT*0.38, width:'100%', position:'relative', backgroundColor:'#e8eaf0' },
  mapLoadingWrap  : { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#e8eaf0' },
  mapLoadingTxt   : { color:'#888', fontSize:13, fontWeight:'600' },
  noGpsOverlay    : { position:'absolute', top:10, alignSelf:'center', backgroundColor:'rgba(17,24,39,0.85)',
                      borderRadius:16, paddingHorizontal:12, paddingVertical:6, zIndex:200 },
  noGpsText       : { color:'#fff', fontSize:12, fontWeight:'bold' },
  speedBadge      : { position:'absolute', top:10, left:10,
                      backgroundColor:'rgba(255,255,255,0.95)',
                      borderWidth:1.5, borderRadius:20,
                      paddingHorizontal:10, paddingVertical:5 },
  speedBadgeText  : { fontSize:12, fontWeight:'bold' },

  fsBtn           : { position:'absolute', bottom:16, right:16,
                      width:52, height:52, borderRadius:26,
                      backgroundColor:'#fff',
                      justifyContent:'center', alignItems:'center',
                      elevation:6,
                      shadowColor:'#000', shadowOffset:{width:0,height:3},
                      shadowOpacity:0.22, shadowRadius:6 },
  fsBtnTxt        : { fontSize:24, color:'#444' },

  fsContainer     : { flex:1, backgroundColor:'#000' },
  fsCloseBtn      : { position:'absolute', top:48, right:16,
                      width:44, height:44, borderRadius:22,
                      backgroundColor:'rgba(0,0,0,0.65)',
                      justifyContent:'center', alignItems:'center',
                      zIndex:99999 },
  fsCloseTxt      : { fontSize:20, color:'#fff', fontWeight:'bold' },

  detailsContainer: { flex:1, backgroundColor:'#F5F7FA',
                      marginTop:0, borderTopLeftRadius:24, borderTopRightRadius:24,
                      paddingHorizontal:16 },
  dragHandle      : { width:42, height:5, backgroundColor:'#DDD', borderRadius:3,
                      alignSelf:'center', marginVertical:10 },

  statsCard       : { flexDirection:'row', alignItems:'center',
                      backgroundColor:'#FFF', padding:14, borderRadius:16,
                      elevation:3, shadowColor:'#000', shadowOffset:{width:0,height:2},
                      shadowOpacity:0.08, shadowRadius:6, marginBottom:12 },
  statBox         : { flex:1, alignItems:'center' },
  statDivider     : { width:1, height:32, backgroundColor:'#EEE' },
  statLabel       : { fontSize:10, color:'#888', marginBottom:3 },
  statValue       : { fontSize:13, fontWeight:'bold', color:'#111', textAlign:'center' },

  turnCard        : { backgroundColor:'#111827', borderRadius:12, padding:12, alignItems:'center', marginBottom:12 },
  turnText        : { color:'#00D4AA', fontWeight:'bold', fontSize:15 },

  statusRow       : { flexDirection:'row', gap:8, marginBottom:12 },
  statusPill      : { borderWidth:1.5, borderRadius:20, paddingHorizontal:10, paddingVertical:5 },
  statusPillText  : { fontSize:11, fontWeight:'bold' },

  section         : { backgroundColor:'#FFF', padding:16, borderRadius:16,
                      elevation:2, shadowColor:'#000', shadowOffset:{width:0,height:1},
                      shadowOpacity:0.07, shadowRadius:4, marginBottom:12 },
  sectionTitle    : { fontSize:15, fontWeight:'bold', color:'#111', marginBottom:14 },

  stopItem        : { flexDirection:'row', minHeight:44, alignItems:'flex-start' },
  timeline        : { width:28, alignItems:'center' },
  dot             : { zIndex:2 },
  line            : { width:2, flex:1, marginTop:3 },
  stopTextContent : { flex:1, marginLeft:12, paddingBottom:8 },
  stopName        : { fontSize:15, color:'#333' },
  textDone        : { color:'#BBB' },
  textActive      : { fontWeight:'bold', color:PRIMARY },
  hereTag         : { backgroundColor:'#E8F0FE', paddingHorizontal:8,
                      paddingVertical:3, borderRadius:8, alignSelf:'flex-start' },
  hereText        : { fontSize:10, color:PRIMARY, fontWeight:'bold' },

  driverCard      : { backgroundColor:'#FFF', paddingHorizontal:16, paddingVertical:14,
                      flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start',
                      borderBottomWidth:1, borderBottomColor:'#EEE' },
  busCardBusNo    : { fontSize:16, fontWeight:'bold', color:'#111', marginBottom:6 },
  driverCardLbl   : { fontSize:10, color:'#888', textTransform:'uppercase', letterSpacing:0.5 },
  driverName      : { fontSize:15, fontWeight:'bold', color:'#111', marginTop:2 },
  tripStatusTxt   : { fontSize:12, color:'#888', marginTop:6, fontWeight:'600' },
  callBtn         : { backgroundColor:PRIMARY, paddingHorizontal:18,
                      paddingVertical:10, borderRadius:22, marginTop:4 },
  callBtnText     : { color:'#FFF', fontWeight:'bold', fontSize:13 },
  callBtnDisabled : { backgroundColor:'#E5E7EB', paddingHorizontal:12 },
  callBtnDisabledText: { color:'#9CA3AF', fontWeight:'600', fontSize:11 },

  bottomNav       : { position:'absolute', bottom:0, flexDirection:'row',
                      backgroundColor:'#FFF', height:70, width:'100%',
                      borderTopWidth:1, borderTopColor:'#EEE', elevation:10 },
  navItem         : { flex:1, justifyContent:'center', alignItems:'center', paddingBottom:8 },
  navIcon         : { fontSize:22, color:'#888' },
  navText         : { fontSize:11, color:'#888', marginTop:2 },
});


