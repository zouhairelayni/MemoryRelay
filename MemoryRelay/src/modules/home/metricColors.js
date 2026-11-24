// Semantic series colors. Every selectable metric has a stable, distinct identity.
// Function series use their category color so unknown labels don't receive random hues.
export const METRIC_COLORS = Object.freeze({
  mcp:"#A99BFF", skill:"#F5B963", delegate:"#9BD989", memory:"#E78DCF",
  provider:"#72AFFF", api:"#63D8E8", tokens:"#51D4B3", errors:"#FF8199",
  all:"#9AB6FF", functions:"#789FEF",
});
function functionSeriesColor(id){
  // Stable hue per function, rather than reusing one color for every endpoint.
  let hash=2166136261;
  for(const char of id){hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;}
  const h=(hash%360)/60,s=.74,l=.68;
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
  const [r,g,b]=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
  return '#'+[r,g,b].map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
export function colorForMetric(id){
  if(id?.startsWith("fn:")) return functionSeriesColor(id);
  return METRIC_COLORS[id]||METRIC_COLORS.all;
}
