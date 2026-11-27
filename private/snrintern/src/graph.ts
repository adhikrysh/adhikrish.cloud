// The graph view's drawing: cytoscape.js (MIT), served by this worker like the chart library, so pages need nothing from outside.
// The server writes the graph (src/refs.ts) into the page as json; this script lays it out by force (cose), and then:
//   drag     a node moves it; dragging the background pans
//   zoom     the wheel or a pinch zooms once you've clicked into the graph, so scrolling past it still scrolls the page
//   click    a node shows what it holds and what it links to, and fades everything else; the background clears it
// Each tab gets a shape (people circles, companies squares, events diamonds), sized by how many links a node has.
// Colours come from base.css's variables at runtime, so the graph follows the one design.
import { escape } from "../../../design/html.ts";
import lib from "../node_modules/cytoscape/dist/cytoscape.min.js?raw";
import type { Graph } from "./refs.ts";

export const GRAPH_PATH = "/_graph-3.35.0.js"; // the version is in the path, so browsers may cache it forever
export const graphAsset = () => new Response(lib, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });

export const SHAPES = ["ellipse", "round-rectangle", "diamond", "triangle", "hexagon"];
const GLYPHS = ["●", "■", "◆", "▲", "⬢"];

/** The graph's placeholder, with its json for the script and a key to the shapes. */
export const graphBox = (g: Graph) => `<div class="graph" data-graph="${escape(JSON.stringify(g))}"></div>
<p class="graph-key">${g.tabs.map((t, i) => `<span>${GLYPHS[i % GLYPHS.length]} ${escape(t.label)}</span>`).join("")}</p>
<div class="graph-info" hidden></div>`;

export const GRAPH_CSS = `
  .graph { height: min(520px, 70vh); margin-top: 12px; background: var(--surface); border-radius: 8px; }
  .graph-key { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--faint); font-size: var(--fs-tiny); margin-top: 8px; }
  .graph-info { margin-top: 20px; }
  .graph-info h3 { font-size: var(--fs-body); font-weight: 450; display: flex; gap: 10px; align-items: baseline; }
  .graph-info dl { margin-top: 12px; }
  .graph-info .linked { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--fs-small); }
  .graph-info .linked span { color: var(--faint); }
  .graph-info .linked a { color: var(--muted); cursor: pointer; }
`;

const SCRIPT = `(()=>{const css=getComputedStyle(document.documentElement),c=n=>css.getPropertyValue(n).trim(),font=getComputedStyle(document.body).fontFamily;
const esc=s=>String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[ch]);
const shapes=${JSON.stringify(SHAPES)};
for(const box of document.querySelectorAll("[data-graph]")){
const g=JSON.parse(box.dataset.graph),info=box.parentElement.querySelector(".graph-info"),label=Object.fromEntries(g.tabs.map(t=>[t.slug,t.label]));
const cy=cytoscape({container:box,userZoomingEnabled:false,boxSelectionEnabled:false,minZoom:.2,maxZoom:3,
elements:[...g.nodes.map(n=>({data:{id:n.id,label:n.label,tab:n.tab},classes:"t"+g.tabs.findIndex(t=>t.slug===n.tab)})),
...g.edges.map((e,i)=>({data:{id:"e"+i,source:e.from,target:e.to,field:e.field}}))],
style:[{selector:"node",style:{"background-color":c("--muted"),label:"data(label)",color:c("--faint"),"font-family":font,"font-size":11,
"text-valign":"bottom",width:e=>10+5*Math.sqrt(e.degree()),height:e=>10+5*Math.sqrt(e.degree())}},
...shapes.map((s,i)=>({selector:".t"+i,style:{shape:s}})),{selector:".t0",style:{"background-color":c("--text")}},
{selector:"edge",style:{width:1,"line-color":c("--ghost"),"curve-style":"straight"}},
{selector:".near",style:{color:c("--text")}},{selector:"edge.near",style:{"line-color":c("--muted")}},
{selector:"node:selected",style:{"background-color":c("--bright"),color:c("--bright")}},{selector:".faded",style:{opacity:.15}}],
layout:{name:"cose",animate:false,padding:24,nodeRepulsion:()=>400000,idealEdgeLength:()=>100,edgeElasticity:()=>100,componentSpacing:90,nodeOverlap:20,randomize:true}});
if(cy.zoom()>1.5){cy.zoom(1.5);cy.center();} // a few nodes stay at their size instead of filling the box
const steady=()=>{const z=cy.zoom();cy.style().selector("node").style({"font-size":12/z,"text-margin-y":4/z}).selector("edge").style({width:1/z}).update();};
steady();cy.on("zoom",steady); // labels and lines keep their size at any zoom; nodes grow and shrink with it
const byId=new Map(g.nodes.map(n=>[n.id,n]));
const value=v=>Array.isArray(v)?esc(v.join(", ")):/^https?:\\/\\//.test(v)?'<a href="'+esc(v)+'" target="_blank" rel="noopener noreferrer">'+esc(String(v).replace(/^https?:\\/\\/(www\\.)?/,"").replace(/\\/$/,""))+"</a>":esc(v);
const clear=()=>{cy.elements().removeClass("faded near");info.hidden=true;};
const pick=node=>{const n=byId.get(node.id()),hood=node.closedNeighborhood();cy.elements().addClass("faded").removeClass("near");hood.removeClass("faded").addClass("near");
const fields=Object.entries(n.data).map(([k,v])=>"<dt>"+esc(k.replaceAll("_"," "))+"</dt><dd>"+value(v)+"</dd>").join("");
const linked=node.neighborhood("node").map(m=>'<a data-id="'+esc(m.id())+'">'+esc(m.data("label"))+"</a>").join("");
info.innerHTML='<h3><a href="/'+esc(n.tab)+"/"+n.row+'">'+esc(n.label)+'</a><span class="pill">'+esc(label[n.tab])+"</span></h3>"+(fields?"<dl>"+fields+"</dl>":"")+(linked?'<p class="linked"><span>linked</span>'+linked+"</p>":"");
info.hidden=false;};
cy.on("tap",e=>{cy.userZoomingEnabled(true);if(e.target===cy){clear();cy.$(":selected").unselect();}});
cy.on("tap","node",e=>pick(e.target));
box.addEventListener("mouseleave",()=>cy.userZoomingEnabled(false));
info.addEventListener("click",e=>{const a=e.target.closest("a[data-id]");if(!a)return;const m=cy.getElementById(a.dataset.id);cy.$(":selected").unselect();m.select();pick(m);cy.animate({center:{eles:m}},{duration:200});});
}})();`;

/** The page's body plus the graph library and its drawing script, when it has a graph. */
export function withGraph(body: string): string {
  return body.includes("data-graph=") ? `${body}\n<script src="${GRAPH_PATH}"></script><script>${SCRIPT}</script>` : body;
}
