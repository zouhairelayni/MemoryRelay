import { version } from "react";

// The `inert` attribute is a boolean in React 19 but a plain string attribute in React 18.
const modern = parseInt(version, 10) >= 19;
export const inertProps = (on) => ({ inert: modern ? !!on : on ? "" : undefined });
