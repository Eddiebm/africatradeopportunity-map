import type { Metadata } from "next";
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
import "./quote.css";
export const metadata:Metadata={title:"Africa Trade Opportunity Map",description:"Explore intra-African imports, exports, trade corridors, profit estimates and legal hurdles across 54 countries."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
