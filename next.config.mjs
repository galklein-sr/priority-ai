import dns from "dns";

// Force IPv4 — IPv6 is not routable on this network
dns.setDefaultResultOrder("ipv4first");

/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
