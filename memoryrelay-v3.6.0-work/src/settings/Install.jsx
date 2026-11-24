import { useInstallPrompt } from "../hooks/useInstallPrompt.js";
import InstallChooser from "../components/InstallChooser.jsx";
import Section from "./Section.jsx";
export default function Install(){
  const {installed,brave}=useInstallPrompt();
  return <Section title="Install the app"><div className="appearance-stack">
    {installed ? <p className="small ok">MemoryRelay is installed.</p> : <InstallChooser variant="section"/>}
    {!installed ? <p className="muted small">{brave ? "Use Chrome or another install-capable browser for a PWA launcher icon." : "Pick your accent before installing. Your browser may require installation from its menu."}</p> : null}
  </div></Section>;
}
