// The graph view's drawing: cytoscape.js with the fcose layout (both MIT), served by this worker like the chart library, so pages
// need nothing from outside. The server writes the graph (src/refs.ts) into the page as json; this script lays it out and then:
//   box      as tall as the drawing needs, up to 600px (75% of the screen)
//   layout   fcose, which packs many small parts (a person and their company) into one tight round cluster, and spaces nodes
//            by the size of their labels, so no two names overlap
//   labels   a fixed size in the graph, so they grow and shrink with the zoom; too small to read, they hide
//   hover    a node lights up what it links to and fades the rest, as in obsidian's graph
//   click    the same, held, and below the graph what the node holds and what it links to; the background lets go
//   drag     a node moves it; dragging the background pans
//   zoom     the wheel or a pinch, straight away, like the charts
// Each tab gets a shape (people circles, companies squares, events diamonds). Colours come from base.css's variables at
// runtime, on the page's own black, so the graph follows the one design.
import { escape } from "../../../design/html.ts";
import cytoscape from "../node_modules/cytoscape/dist/cytoscape.min.js?raw";
import layoutBase from "../node_modules/layout-base/layout-base.js?raw";
import coseBase from "../node_modules/cose-base/cose-base.js?raw";
import fcose from "../node_modules/cytoscape-fcose/cytoscape-fcose.js?raw";
import type { Graph } from "./refs.ts";

// fcose needs cose-base, which needs layout-base: their browser builds, in that order, as one file
const lib = [cytoscape, layoutBase, coseBase, fcose].join(";\n");
export const GRAPH_PATH = "/_graph-3.35.0-fcose-2.2.0.js"; // the versions are in the path, so browsers may cache it forever
export const graphAsset = () => new Response(lib, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });

export const SHAPES = ["ellipse", "round-rectangle", "diamond", "triangle", "hexagon"];
const GLYPHS = ["●", "■", "◆", "▲", "⬢"];

/** The graph's placeholder, with its json for the script and a key to the shapes. */
export const graphBox = (g: Graph) => `<div class="graph" data-graph="${escape(JSON.stringify(g))}"></div>
<p class="graph-key">${g.tabs.map((t, i) => `<span>${GLYPHS[i % GLYPHS.length]} ${escape(t.label)}</span>`).join("")}</p>
<div class="graph-info" hidden></div>`;

export const GRAPH_CSS = `
  .graph { height: min(600px, 75vh); margin-top: 12px; }
  .graph-key { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--faint); font-size: var(--fs-tiny); margin-top: 8px; }
  .graph-info { margin-top: 24px; }
  .graph-info h3 { font-size: var(--fs-body); font-weight: 450; display: flex; gap: 10px; align-items: baseline; }
  .graph-info dl { margin-top: 12px; }
  .graph-info .linked { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--fs-small); }
  .graph-info .linked span { color: var(--faint); }
  .graph-info .linked a { color: var(--muted); cursor: pointer; }
`;

const SCRIPT = `(()=>{try{cytoscape.use(cytoscapeFcose)}catch{} // registered once per page
const css=getComputedStyle(document.documentElement),c=n=>css.getPropertyValue(n).trim(),font=getComputedStyle(document.body).fontFamily;
const esc=s=>String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[ch]);
const shapes=${JSON.stringify(SHAPES)};
for(const box of document.querySelectorAll("[data-graph]")){
const g=JSON.parse(box.dataset.graph),info=box.parentElement.querySelector(".graph-info"),label=Object.fromEntries(g.tabs.map(t=>[t.slug,t.label]));
const cy=cytoscape({container:box,boxSelectionEnabled:false,minZoom:.1,maxZoom:3,
elements:[...g.nodes.map(n=>({data:{id:n.id,label:n.label,tab:n.tab},classes:"t"+g.tabs.findIndex(t=>t.slug===n.tab)})),
...g.edges.map((e,i)=>({data:{id:"e"+i,source:e.from,target:e.to,field:e.field}}))],
style:[{selector:"node",style:{"background-color":c("--faint"),label:"data(label)",color:c("--muted"),"font-family":font,"font-size":11,
"text-valign":"bottom","text-margin-y":4,"text-wrap":"wrap","text-max-width":100,"min-zoomed-font-size":6,width:6,height:6}},
...shapes.map((s,i)=>({selector:".t"+i,style:{shape:s}})),{selector:".t2",style:{width:9,height:9}},
{selector:".t0",style:{"background-color":c("--text"),color:c("--text"),"font-size":12,width:8,height:8}},
{selector:"edge",style:{width:.8,"line-color":c("--ghost"),"curve-style":"straight"}},
{selector:"node.near",style:{color:c("--bright")}},{selector:"edge.near",style:{"line-color":c("--muted")}},
{selector:"node:selected",style:{"background-color":c("--bright")}},{selector:".faded",style:{opacity:.12}}],
layout:{name:"fcose",animate:false,padding:20,randomize:true,nodeDimensionsIncludeLabels:true,packComponents:true,
nodeRepulsion:()=>1000,idealEdgeLength:()=>12,nodeSeparation:8,componentSpacing:6}});
if(cy.zoom()>1.5){cy.zoom(1.5);cy.center();} // a few nodes stay at their size instead of filling the box
// the box hugs the drawing: a graph wider than tall is fitted to the width, so the box gives up the height it doesn't use
{const h=Math.ceil(cy.elements().renderedBoundingBox().h)+40;if(h<box.clientHeight){box.style.height=h+"px";cy.resize();cy.center();}}
const byId=new Map(g.nodes.map(n=>[n.id,n]));
const value=v=>Array.isArray(v)?esc(v.join(", ")):/^https?:\\/\\//.test(v)?'<a href="'+esc(v)+'" target="_blank" rel="noopener noreferrer">'+esc(String(v).replace(/^https?:\\/\\/(www\\.)?/,"").replace(/\\/$/,""))+"</a>":esc(v);
let held=null; // the clicked node, if any: hovering others doesn't move the light off it
const light=node=>{cy.batch(()=>{cy.elements().removeClass("near").addClass("faded");node.closedNeighborhood().removeClass("faded").addClass("near");});};
const dark=()=>cy.batch(()=>cy.elements().removeClass("faded near"));
const pick=node=>{held=node;light(node);const n=byId.get(node.id());
const fields=Object.entries(n.data).map(([k,v])=>"<dt>"+esc(k.replaceAll("_"," "))+"</dt><dd>"+value(v)+"</dd>").join("");
const linked=node.neighborhood("node").map(m=>'<a data-id="'+esc(m.id())+'">'+esc(m.data("label"))+"</a>").join("");
info.innerHTML='<h3><a href="/'+esc(n.tab)+"/"+n.row+'">'+esc(n.label)+'</a><span class="pill">'+esc(label[n.tab])+"</span></h3>"+(fields?"<dl>"+fields+"</dl>":"")+(linked?'<p class="linked"><span>linked</span>'+linked+"</p>":"");
info.hidden=false;};
cy.on("mouseover","node",e=>{if(!held)light(e.target);});
cy.on("mouseout","node",()=>{if(!held)dark();});
cy.on("tap",e=>{if(e.target===cy){held=null;dark();info.hidden=true;cy.$(":selected").unselect();}});
cy.on("tap","node",e=>pick(e.target));
info.addEventListener("click",e=>{const a=e.target.closest("a[data-id]");if(!a)return;const m=cy.getElementById(a.dataset.id);cy.$(":selected").unselect();m.select();pick(m);cy.animate({center:{eles:m}},{duration:200});});
}})();`;

/** The page's body plus the graph library and its drawing script, when it has a graph. */
export function withGraph(body: string): string {
  return body.includes("data-graph=") ? `${body}\n<script src="${GRAPH_PATH}"></script><script>${SCRIPT}</script>` : body;
}
