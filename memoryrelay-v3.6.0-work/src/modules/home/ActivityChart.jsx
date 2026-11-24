import {useEffect,useRef} from 'react';
import {Chart,LineController,BarController,LineElement,BarElement,PointElement,CategoryScale,LinearScale,Tooltip,Filler} from 'chart.js';

// Register only the two chart types we use; avoid the larger chart.js/auto bundle.
Chart.register(LineController,BarController,LineElement,BarElement,PointElement,CategoryScale,LinearScale,Tooltip,Filler);

const css=(styles,name,fallback)=>styles.getPropertyValue(name).trim()||fallback;
export default function ActivityChart({type='line',labels=[],values=[],label,unit='calls',color}){
  const canvas=useRef(null);
  useEffect(()=>{
    if(!canvas.current||!labels.length||!values.length)return;
    const colors=getComputedStyle(canvas.current);
    const ink=css(colors,'--ink2','#9aa8bb');
    const muted=css(colors,'--muted','#8091a4');
    const grid=css(colors,'--hair','rgba(120,140,160,.12)');
    const accent=color||css(colors,'--cobalt','#95aaff');
    const canvasContext=canvas.current.getContext('2d');
    const gradient=canvasContext.createLinearGradient(0,0,0,canvas.current.clientHeight||210);
    // Chart.js Filler plugin uses the canvas gradient below the line; never a flat block.
    const rgb=/^#([0-9a-f]{6})$/i.exec(accent);
    const channels=rgb?[1,3,5].map(i=>parseInt(rgb[1].slice(i-1,i+1),16)):[170,165,255];
    const rgba=(opacity)=>`rgba(${channels.join(',')},${opacity})`;
    gradient.addColorStop(0,rgba(.49));gradient.addColorStop(.55,rgba(.25));gradient.addColorStop(1,rgba(.045));
    const bar=accent;
    const isBar=type==='bar';
    const chart=new Chart(canvas.current,{
      type,
      data:{labels,datasets:[{
        label,data:values.map(x=>Number(x)||0),
        borderColor:accent,backgroundColor:isBar?bar:gradient,
        borderWidth:isBar?0:3,pointRadius:isBar?0:values.length>45?0:1.6,
        pointHoverRadius:5,pointHoverBackgroundColor:accent,pointHoverBorderWidth:2,pointHoverBorderColor:css(colors,"--card","#152232"),tension:0.36,fill:isBar?false:"origin",
        borderRadius:isBar?6:0,maxBarThickness:16,
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
  },[type,labels,values,label,unit,color]);
  return <div className={`activity-chart ${type==='bar'?'activity-chart-bar':''}`} role="img" aria-label={`${label}. ${values.reduce((s,x)=>s+(Number(x)||0),0).toLocaleString()} ${unit} over ${labels.length} intervals`}>
    {labels.length?<canvas ref={canvas}/>:<p className="muted small">No recorded activity for this period.</p>}
  </div>;
}
