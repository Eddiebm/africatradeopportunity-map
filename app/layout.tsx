import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./live.css";
import "./responsive.css";
import "./portal.css";
import "./intelligence.css";
import "./supply.css";
import "./build-status.css";
import "./finder.css";
import "./admin.css";
import "./built.css";
import "./marketplace.css";
import "./prices.css";
export const metadata:Metadata={title:"Africa Trade Opportunity Map",description:"Explore intra-African imports, exports, trade corridors, profit estimates and legal hurdles across 54 countries."};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#153d2d"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/></head><body>{children}</body></html>}
