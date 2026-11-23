// Charts: TradingView's lightweight-charts (Apache-2.0), served by this worker so pages need nothing from outside.
// The server writes each chart's days into the page as json (date, value, row id); one small script draws them all.
//   mini   a glance: the newest day's stream where there is one (heart rate every 2 min), else the last 10 days; no zoom;
//          a click opens the metric's full page
//   full   like a stock chart: 1d / 3d of the streams, then 10d / 1m / 3m / 1y / all of days as dots on a scale fitted to
//          them, your usual band as two dashed lines; pinch, wheel and drag zoom and pan; the crosshair shows the time and
//          value; a click opens that day
// Colours come from base.css's variables at runtime, so the charts follow the one design.
import { escape } from "../../../design/html.ts";
// the browser build (a global LightweightCharts), read by path: the package's exports field only lists its module builds
import lib from "../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js?raw";

export const CHARTS_PATH = "/_charts-5.2.1.js"; // the version is in the path, so browsers may cache it forever
export const chartsAsset = () => new Response(lib, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });

/** One day: date, value, row id. */
export type ChartPoint = [date: string, value: number, id: number];
/** One day's stream: minutes from that day's local midnight (negative = the evening before) and values. */
export type ChartStream = { date: string; id: number; points: [number, number][] };
export type Chart = {
  points: ChartPoint[]; // oldest first, one per day
  streams?: ChartStream[]; // the newest days' streams, oldest first: the mini shows the newest, the full chart opens on them
  mini?: boolean;
  href?: string; // mini: where a click goes
  base: string; // a dot (or any point of a day's stream) opens base + that day's row id
  unit?: string; // "min" reads 7h 40m
  int?: boolean; // whole numbers
  best?: [from: string, to: string]; // drawn in green over the line
  usual?: [low: number, high: number]; // your usual band, as two dashed lines
};

/** One chart's placeholder: its data as json for the script to draw; a full chart gets its range buttons
 * (1d and 3d when it has streams, then the daily ranges). */
export function chart(c: Chart): string {
  const data = escape(JSON.stringify(c));
  if (c.mini) return `<div class="lw mini" data-chart="${data}"></div>`;
  const ranges = [...(c.streams?.length ? [["1d", "1d"], ["3d", "3d"]] : []), ["10", "10d"], ["30", "1m"], ["91", "3m"], ["365", "1y"], ["all", "all"]]
    .map(([d, l]) => `<button type="button" data-range="${d}">${l}</button>`).join("");
  return `<div class="lw-wrap"><div class="ranges">${ranges}</div><div class="lw full" data-chart="${data}"></div></div>`;
}

export const CHART_CSS = `
  .lw.mini { height: 56px; margin-top: 8px; grid-column: 1 / -1; cursor: pointer; }
  .lw-wrap { margin-top: 24px; }
  .lw.full { height: 280px; margin-top: 10px; }
  .ranges { display: flex; gap: 16px; flex-wrap: wrap; }
  .ranges button { background: none; border: 0; padding: 0; font: inherit; font-size: var(--fs-small); color: var(--muted); cursor: pointer; }
  .ranges button[aria-pressed="true"] { color: var(--bright); text-decoration: underline; text-underline-offset: 2px; }
  .ranges button:hover { color: var(--hover); }
`;

// The drawing script. Every time is a utc timestamp of local wall time (a day at its midnight, a stream point at midnight plus
// its minutes), so the axis reads in your own day without a timezone to get wrong. The chart spaces points by index, not time,
// so days and 2-minute points can't share an axis: the buttons switch between them, pinch and drag zoom within one.
const SCRIPT = `(()=>{const L=window.LightweightCharts;if(!L)return;
const css=getComputedStyle(document.documentElement),v=n=>css.getPropertyValue(n).trim(),font=getComputedStyle(document.body).fontFamily;
const fmt=(c,y)=>{if(c.unit==="min"&&y>=60){const h=Math.floor(y/60),m=Math.round(y%60);return h+"h"+(m?" "+m+"m":"")}
const n=Math.abs(y)>=100||c.int?Math.round(y).toLocaleString("en-US"):String(Math.round(y*10)/10);return c.unit?n+(c.unit==="%"?"":" "+c.unit):n};
const day=s=>Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10))/1e3,D=86400;
for(const el of document.querySelectorAll("[data-chart]")){const c=JSON.parse(el.dataset.chart);
if(!c.points.length&&!(c.streams&&c.streams.length))continue;
const chart=L.createChart(el,{autoSize:true,
 layout:{background:{color:"transparent"},textColor:v("--faint"),fontSize:12,fontFamily:font,attributionLogo:false},
 grid:{vertLines:{visible:false},horzLines:{visible:!c.mini,color:v("--line")}},
 rightPriceScale:{visible:!c.mini,borderVisible:false,scaleMargins:{top:.12,bottom:.08}},leftPriceScale:{visible:false},
 timeScale:{visible:!c.mini,borderVisible:false,fixLeftEdge:true,fixRightEdge:true},
 crosshair:{mode:c.mini?L.CrosshairMode.Hidden:L.CrosshairMode.Magnet,vertLine:{color:v("--ghost"),labelBackgroundColor:v("--raised")},horzLine:{color:v("--ghost"),labelBackgroundColor:v("--raised")}},
 handleScroll:!c.mini,handleScale:!c.mini,localization:{priceFormatter:y=>fmt(c,y)}});
const common={priceLineVisible:false,lastValueVisible:false,priceFormat:{type:"custom",formatter:y=>fmt(c,y),minMove:c.int?1:.1}};
const ids=new Map(c.points.map(p=>[day(p[0]),p[2]]));for(const s of c.streams||[])ids.set(day(s.date),s.id);
let series=[];const add=(type,opts,data)=>{const s=chart.addSeries(type,{...common,...opts});s.setData(data);series.push(s);return s};
const clear=()=>{for(const s of series)chart.removeSeries(s);series=[]};
const line=(data,opts={})=>add(L.LineSeries,{color:v("--muted"),lineWidth:1.5,pointMarkersVisible:!c.mini||data.length<15,pointMarkersRadius:c.mini?2:2.5,crosshairMarkerRadius:5,crosshairMarkerBackgroundColor:v("--bright"),...opts},data);
// a day's streams, as one line through the chosen days; a gap of over 20 minutes (watch off) leaves the line open
const drawStreams=n=>{const days=(c.streams||[]).slice(-n),pts=[];
 for(const s of days){for(const[m,y]of s.points)pts.push({time:day(s.date)+m*60,value:y})}
 pts.sort((a,b)=>a.time-b.time);const data=[];for(let i=0;i<pts.length;i++){if(i&&pts[i].time-pts[i-1].time>1200)data.push({time:pts[i-1].time+60});data.push(pts[i])}
 line(data.filter((p,i,a)=>!i||p.time>a[i-1].time),{pointMarkersVisible:false,lineWidth:1.5})};
const drawDays=()=>{const t=p=>day(p[0]),s=line(c.points.map(p=>({time:t(p),value:p[1]})));
 if(c.usual)for(const[y,label]of[[c.usual[1],"usual"],[c.usual[0],""]])s.createPriceLine({price:y,color:v("--muted"),lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:true,title:label});
 if(c.best)add(L.LineSeries,{color:v("--good"),lineWidth:3,pointMarkersVisible:true,pointMarkersRadius:3.5,crosshairMarkerVisible:false},c.points.filter(p=>p[0]>=c.best[0]&&p[0]<=c.best[1]).map(p=>({time:t(p),value:p[1]})))};
chart.subscribeClick(p=>{if(c.mini){if(c.href)location.href=c.href;return}if(typeof p.time!=="number")return;const id=ids.get(p.time-((p.time%D)+D)%D);if(id)location.href=c.base+id});
if(c.mini){c.streams&&c.streams.length?drawStreams(1):drawDays();chart.timeScale().fitContent();continue}
const buttons=el.parentElement.querySelectorAll("[data-range]");
const show=r=>{buttons.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.range===r)));clear();
 const intraday=r==="1d"||r==="3d";chart.applyOptions({timeScale:{timeVisible:intraday,secondsVisible:false}});
 if(intraday){drawStreams(r==="1d"?1:3);chart.timeScale().fitContent();return}
 drawDays();if(!c.points.length)return;const last=day(c.points.at(-1)[0]),first=day(c.points[0][0]);
 if(r==="all"||last-(+r-1)*D<=first){chart.timeScale().fitContent();return}
 chart.timeScale().setVisibleRange({from:last-(+r-1)*D,to:last})};
buttons.forEach(b=>b.addEventListener("click",()=>show(b.dataset.range)));
show(c.streams&&c.streams.length?"1d":c.points.length&&day(c.points.at(-1)[0])-day(c.points[0][0])>91*D?"91":"all")}})()`;

/** The page's body plus the chart library and drawing script, when it has a chart. */
export function withCharts(body: string): string {
  return body.includes("data-chart=") ? `${body}\n<script src="${CHARTS_PATH}"></script><script>${SCRIPT}</script>` : body;
}
