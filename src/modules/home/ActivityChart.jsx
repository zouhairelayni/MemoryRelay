import {useEffect,useRef} from 'react';
import {Chart,LineController,BarController,LineElement,BarElement,PointElement,CategoryScale,LinearScale,Tooltip} from 'chart.js';

// Register only the two chart types we use; avoid the larger chart.js/auto bundle.
Chart.register(LineController,BarController,LineElement,BarElement,PointElement,CategoryScale,LinearScale,Tooltip);

const css=(styles,name,fallback)=>styles.getPropertyValue(name).trim()||fallback;
export default function ActivityChart({type='line',labels=[],values=[],label,unit='calls'}){
  const canvas=useRef(null);
  useEffect(()=>{
    if(!canvas.current||!labels.length||!values.length)return;
    const colors=getComputedStyle(canvas.current);
    const ink=css(colors,'--ink2','#9aa8bb');
    const muted=css(colors,'--muted','#8091a4');
    const grid=css(colors,'--hair','rgba(120,140,160,.12)');
    const accent=css(colors,'--cobalt','#95aaff');
    const bar=css(colors,'--ink2','#8399ae');
    const isBar=type==='bar';
    const chart=new Chart(canvas.current,{
      type,
      data:{labels,datasets:[{
        label,data:values.map(x=>Number(x)||0),
        borderColor:accent,backgroundColor:isBar?bar:accent,
        borderWidth:isBar?0:2,pointRadius:isBar?0:values.length>45?0:2,
        pointHoverRadius:4,tension:0.23,fill:false,
        borderRadius:isBar?4:0,maxBarThickness:24,
      }]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        indexAxis:isBar?'y':'x',
        interaction:{intersect:false,mode:isBar?'nearest':'index'},
        plugins:{legend:{display:false},tooltip:{
          backgroundColor:css(colors,'--card','#152232'),titleColor:css(colors,'--ink','#fff'),bodyColor:ink,
          borderColor:css(colors,'--line','#2c3d51'),borderWidth:1,displayColors:false,
          callbacks:{label:context=>`${context.formattedValue} ${unit}`},
        }},
        scales:{
          x:isBar?{beginAtZero:true,grid:{color:grid,drawTicks:false},border:{display:false},ticks:{color:muted,precision:0,font:{size:11},maxTicksLimit:5}}:
            {grid:{display:false},border:{color:grid},ticks:{color:muted,maxTicksLimit:6,maxRotation:0,autoSkip:true,font:{size:11}}},
          y:isBar?{grid:{display:false},border:{display:false},ticks:{color:ink,font:{size:11},autoSkip:false}}:
            {beginAtZero:true,suggestedMax:values.every(x=>!x)?1:undefined,grid:{color:grid,drawTicks:false},border:{display:false},ticks:{color:muted,precision:0,maxTicksLimit:5,font:{size:11}}},
        },
      },
    });
    return()=>chart.destroy();
  },[type,labels,values,label,unit]);
  return <div className={`activity-chart ${type==='bar'?'activity-chart-bar':''}`} role="img" aria-label={`${label}. ${values.reduce((s,x)=>s+(Number(x)||0),0).toLocaleString()} ${unit} over ${labels.length} intervals`}>
    {labels.length?<canvas ref={canvas}/>:<p className="muted small">No recorded activity for this period.</p>}
  </div>;
}
